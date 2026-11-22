import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from './db';
import { Services, ApiError, fail } from './services';
import { verifyLine } from './line';
import { MemoryRateLimiter, type RateLimiter } from './security';
import { auditEvents } from './db/schema';
import { loginLiff, verifyLiff, type LiffVerifier } from './liff-auth';
export const memberCookie = '__Host-mc_member';
export const adminCookie = '__Host-mc_admin';
export function cookie(req: Request, name: string) { return req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1); }
const setCookie = (name: string,value: string, ttl: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
export function mutationGuard(req: Request, origin: string) { if (req.headers.get('origin') !== origin || req.headers.get('x-mc-csrf') !== '1' || !req.headers.get('content-type')?.startsWith('application/json')) fail(403,'invalid_origin_or_csrf'); }
const schemas = {
  line:z.object({idToken:z.string().min(1).max(10000),nonce:z.string().min(16).max(256)}).strict(),
  password:z.object({email:z.email().max(254),password:z.string().min(1).max(1024)}).strict(),
  mfa:z.object({code:z.string().regex(/^\d{6}$/)}).strict(),
};
export type Endpoint = 'challenge'|'line'|'liff'|'logout'|'password'|'mfa'|'adminLogout'|'overview'|'missionaries'|'letters'|'letter';
export function createHandler(endpoint: Endpoint, service: () => Services, origin: string, limiter: RateLimiter, liff = {verifier:verifyLiff as LiffVerifier,channel:process.env.LINE_LIFF_CHANNEL_ID ?? process.env.LINE_LOGIN_CHANNEL_ID ?? '',key:process.env.LINE_SUBJECT_ENC_KEY ?? ''}) {
  return async (req: Request, id?: string) => {
    const request_id = randomUUID(); const headers = new Headers({'Cache-Control':'no-store','Content-Type':'application/json','X-Request-Id':request_id});
    let actorId:string|undefined; let actorType='request';
    const respond = async (data: unknown,status=200) => {
      try { await service().db.insert(auditEvents).values({actorId,actorType,action:'api.'+endpoint,requestId:request_id,outcome:'success'}); }
      catch { return new Response(JSON.stringify({error:{code:'internal_error'},request_id}),{status:500,headers}); }
      return new Response(JSON.stringify({data,request_id}),{status,headers});
    };
    try {
      const mutating = req.method !== 'GET';
      if (mutating) mutationGuard(req,origin);
      // Proxy headers are deliberately not trusted; replace limiter with a trusted-edge implementation in production.
      const memberEndpoint=['logout','missionaries','letters','letter'].includes(endpoint);
      if (!memberEndpoint && !limiter.consume(endpoint)) return fail(429,'rate_limited');
      const svc = service(); const member = cookie(req,memberCookie); const admin = cookie(req,adminCookie);
      if(['mfa','adminLogout','overview'].includes(endpoint)) {actorId=(await svc.adminSession(admin,endpoint==='overview')).admin.id; actorType='staff';}
      else if(memberEndpoint) {
        try { actorId=(await svc.member(member)).id; }
        catch(error) {
          if(!limiter.consume(endpoint+':anonymous')) return fail(429,'rate_limited');
          throw error;
        }
        actorType='member';
        if(!limiter.consume(endpoint+':member:'+actorId)) return fail(429,'rate_limited');
      }
      const body = mutating ? await req.json().catch(()=>fail(400,'invalid_input')) : {};
      switch(endpoint) {
        case 'challenge': { const nonce = await svc.challenge(); headers.set('Set-Cookie',setCookie('__Host-mc_nonce',nonce,300)); return respond({nonce}); }
        case 'line': { const b = schemas.line.parse(body); if (cookie(req,'__Host-mc_nonce') !== b.nonce) return fail(401,'invalid_identity'); const token = await svc.loginLine(b.idToken,b.nonce); actorId=(await svc.member(token)).id; actorType='member'; headers.set('Set-Cookie',setCookie(memberCookie,token,3600)); return respond({authenticated:true}); }
        case 'liff': { const b = schemas.line.parse(body); if (cookie(req,'__Host-mc_nonce') !== b.nonce) return fail(401,'invalid_identity'); const token = await loginLiff(svc,b.idToken,b.nonce,liff.channel,liff.key,liff.verifier); actorId=(await svc.member(token)).id; actorType='member'; headers.append('Set-Cookie',setCookie('__Host-mc_nonce','',0)); headers.append('Set-Cookie',setCookie(memberCookie,token,3600)); return respond({authenticated:true}); }
        case 'logout': await svc.logout(member ?? ''); headers.set('Set-Cookie',setCookie(memberCookie,'',0)); return respond({authenticated:false});
        case 'password': { const b = schemas.password.parse(body); const token = await svc.passwordLogin(b.email,b.password); actorId=(await svc.adminSession(token,false)).admin.id; actorType='staff'; headers.set('Set-Cookie',setCookie(adminCookie,token,300)); return respond({aal:'aal1',mfa_required:true}); }
        case 'mfa': { const b = schemas.mfa.parse(body); const token = await svc.mfa(admin,b.code); headers.set('Set-Cookie',setCookie(adminCookie,token,1800)); return respond({aal:'aal2'}); }
        case 'adminLogout': { const {admin:a} = await svc.adminSession(admin,false); await svc.invalidateAdmin(a.id); headers.set('Set-Cookie',setCookie(adminCookie,'',0)); return respond({authenticated:false}); }
        case 'overview': await svc.staff(admin,'overview'); return respond({status:'foundation_only'});
        case 'missionaries': return respond(await svc.visibleMissionaries(member));
        case 'letters': { const letters = await svc.visibleLetters(member); return respond({items:letters,count:letters.length}); }
        case 'letter': return respond(await svc.letter(member,z.uuid().parse(id)));
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : 500;
      try { await service().db.insert(auditEvents).values({actorId,actorType,action:'api.denied',requestId:request_id,outcome:String(status)}); } catch { /* Do not expose database failures. */ }
      return new Response(JSON.stringify({error:{code:error instanceof ApiError ? error.code : status === 400 ? 'invalid_input' : 'internal_error'},request_id}),{status,headers});
    }
  };
}
const limiter = new MemoryRateLimiter();
export const handler = (endpoint: Endpoint, id?: string) => (req: Request) => createHandler(endpoint,()=>new Services(getDatabase(),verifyLine,process.env.LINE_LOGIN_CHANNEL_ID ?? '',process.env.AUTH_ENCRYPTION_KEY ?? '',()=>new Date(),process.env.LINE_SUBJECT_ENC_KEY??''),process.env.APP_ORIGIN ?? 'https://localhost:3000',limiter)(req,id);
