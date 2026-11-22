import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from './db';
import { Services,ApiError,fail } from './services';
import { verifyLine } from './line';
import { cookie,memberCookie,adminCookie,mutationGuard } from './http';
import { MemoryRateLimiter,type RateLimiter } from './security';
import { WorkflowCore,contentInput } from './workflows/core';
import { Editorial } from './workflows/editorial';
import { Members } from './workflows/members';
import { Delivery,LineMessagingClient,secretMatches } from './workflows/delivery';
import { Governance,securityReasonInput } from './workflows/governance';
import { AdminReads,type ReadKind } from './workflows/reads';
import { Media } from './workflows/media';
import { LocalPrivateStorage } from './storage';
import { auditEvents } from './db/schema';
const revision={request_id:z.uuid(),expected_revision:z.number().int().positive()};
const requestId={request_id:z.uuid().default(()=>randomUUID())};
const code=securityReasonInput;
const incidentInput=z.object({...requestId,missionaryId:z.uuid().optional(),category:code,severity:z.enum(['low','medium','high']),reasonCode:code,status:z.enum(['open','investigating','closed'])}).strict();
const limitInput=z.coerce.number().int().min(1).max(50).default(20);
const offsetInput=z.coerce.number().int().min(0).max(10000).default(0);
export type WorkflowDependencies={core:WorkflowCore;editorial:Editorial;members:Members;delivery:Delivery;governance:Governance;reads:AdminReads;media:Media};
export function createWorkflowHandler(deps:()=>WorkflowDependencies,origin:string,dispatchSecret:string,limiter:RateLimiter) {
  return async(req:Request)=>{
    const request_id=randomUUID(); const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json','X-Request-Id':request_id});
    const respond=async(data:unknown,status=200)=>{
      if(d) {
        try { await d.core.db.insert(auditEvents).values({actorType:'request',action:'api.workflow.'+parts[0],requestId:request_id,outcome:'success'}); }
        catch { return new Response(JSON.stringify({error:{code:'internal_error'},request_id}),{status:500,headers}); }
      }
      return new Response(JSON.stringify({data,request_id}),{status,headers});
    };
    const path=new URL(req.url).pathname.replace(/^\/api\//,''); const parts=path.split('/'); const method=req.method;
    let d:WorkflowDependencies|undefined;
    try {
      if(!limiter.consume(path.startsWith('grants/request')?'grants/request':parts.slice(0,2).join('/'))) return fail(429,'rate_limited');
      if(path==='internal/dispatch') {
        if(method!=='POST') return fail(404,'not_found');
        if(!secretMatches(req.headers.get('x-mc-dispatch-secret'),dispatchSecret)) return fail(401,'unauthenticated');
        d=deps(); return respond(await d.delivery.dispatch());
      }
      if(path==='line/webhook') {
        if(method!=='POST') return fail(404,'not_found');
        const raw=Buffer.from(await req.arrayBuffer()); if(raw.length>1024*1024) return fail(413,'payload_too_large');
        d=deps(); return respond(await d.delivery.webhook(raw,req.headers.get('x-line-signature')));
      }
      if(method!=='GET') mutationGuard(req,origin);
      const length=Number(req.headers.get('content-length')??0); if(length>8*1024*1024) return fail(413,'payload_too_large');
      const raw=method==='GET' ? '' : await req.text(); if(raw.length>8*1024*1024) return fail(413,'payload_too_large');
      let body:unknown={}; if(raw) {try{body=JSON.parse(raw);}catch{return fail(400,'invalid_input');}}
      d=deps(); const {core:c,editorial:e,members:m,delivery:delivery,governance:g,reads:r,media}=d;
      const member=cookie(req,memberCookie),admin=cookie(req,adminCookie);
      if(parts[0]==='admin') await c.auth.adminSession(admin);
      else if(path!=='donations/cta' && parts[0]!=='media') await c.auth.member(member);
      if(path==='letters' && method==='POST') {
        const b=z.object({...requestId,missionaryId:z.uuid(),content:contentInput}).strict().parse(body); return respond(await e.create(undefined,member,b.missionaryId,b.content,b.request_id),201);
      }
      if(parts[0]==='letters' && parts[2]==='ai-draft' && parts.length===3 && method==='POST') {
        const b=z.object(revision).strict().parse(body); return respond(await e.aiDraft(undefined,member,z.uuid().parse(parts[1]),b.expected_revision,b.request_id));
      }
      if(path==='prayers' && method==='POST') {const b=z.object({...requestId,letterId:z.uuid()}).strict().parse(body); return respond(await m.pray(member,b.letterId,b.request_id));}
      if(parts[0]==='letters' && parts[2]==='prayer-stats' && method==='GET') return respond(await m.weekly(member,z.uuid().parse(parts[1])));
      if(path==='subscriptions' && method==='POST') {
        const b=z.object({...requestId,missionaryId:z.uuid(),following:z.boolean().optional(),pushOptIn:z.boolean().optional()}).strict().refine(b=>b.following!==undefined || b.pushOptIn!==undefined).parse(body); return respond(await m.subscribe(member,b.missionaryId,b.following,b.pushOptIn,b.request_id));
      }
      if(path==='grants/request' && method==='POST') {const b=z.object({...requestId,missionaryId:z.uuid()}).strict().parse(body); return respond(await m.requestAccess(member,b.missionaryId,b.request_id));}
      if(path==='privacy/delete-request' && method==='POST') {const b=z.object(requestId).strict().parse(body); return respond(await m.privacy(member,b.request_id),202);}
      if(path==='donations/cta' && method==='GET') return respond(await g.cta());
      if(parts[0]==='media' && parts.length===2 && method==='GET') {
        const bytes=await media.read(member,admin,z.uuid().parse(parts[1]),request_id);
        headers.set('Content-Type','image/webp'); headers.set('X-Content-Type-Options','nosniff'); return new Response(new Uint8Array(bytes),{headers});
      }
      if(parts[0]!=='admin') return fail(404,'not_found');
      if(path==='admin/letters' && method==='POST') {
        const b=z.object({...requestId,missionaryId:z.uuid(),content:contentInput}).strict().parse(body); return respond(await e.create(admin,undefined,b.missionaryId,b.content,b.request_id),201);
      }
      if(parts[1]==='letters' && parts[2]) {
        const id=z.uuid().parse(parts[2]);
        if(parts.length===3 && method==='GET') return respond(await r.letter(admin,id,request_id));
        if(parts.length===3 && method==='PATCH') {const b=z.object({...revision,content:contentInput}).strict().parse(body); return respond(await e.edit(admin,id,b.expected_revision,b.content,b.request_id));}
        if(parts[3]==='assets' && method==='POST') {const b=z.object({...revision,base64:z.string().max(7*1024*1024)}).strict().parse(body); return respond(await media.upload(admin,id,b.expected_revision,Buffer.from(b.base64,'base64'),b.request_id));}
        if(parts[3]==='public-change-request' && method==='POST') {const b=z.object({...revision,consent:z.literal(true)}).strict().parse(body); return respond(await g.propose(admin,'letter.public',id,b.expected_revision,{consent:b.consent},b.request_id));}
        if(method==='POST') {
          const b=z.object(revision).strict().parse(body);
          if(parts[3]==='submit-review') return respond(await e.submit(admin,id,b.expected_revision,b.request_id));
          if(parts[3]==='publish') return respond(await e.publish(admin,id,b.expected_revision,b.request_id));
          if(parts[3]==='archive') return respond(await e.archive(admin,id,b.expected_revision,b.request_id));
          if(parts[3]==='ai-draft') return respond(await e.aiDraft(admin,undefined,id,b.expected_revision,b.request_id));
        }
      }
      if(parts[1]==='reviews' && parts[3]==='decision' && method==='POST') {
        const b=z.object({...revision,decision:z.enum(['approve','reject']),consent:z.boolean()}).strict().parse(body); return respond(await e.decide(admin,z.uuid().parse(parts[2]),b.expected_revision,b.decision,b.consent,b.request_id));
      }
      if(parts[1]==='access-requests' && parts[3]==='decision' && method==='POST') {
        const b=z.object({...requestId,approve:z.boolean(),expiresAt:z.iso.datetime()}).strict().parse(body); return respond(await m.decideAccess(admin,z.uuid().parse(parts[2]),b.approve,new Date(b.expiresAt),b.request_id));
      }
      if(parts[1]==='access-grants' && parts[3]==='revoke' && method==='POST') {const b=z.object(requestId).strict().parse(body); return respond(await m.revoke(admin,z.uuid().parse(parts[2]),b.request_id));}
      if(parts[1]==='notification-jobs' && parts[3]==='retry' && method==='POST') {const b=z.object(requestId).strict().parse(body); return respond(await delivery.retry(admin,z.uuid().parse(parts[2]),b.request_id));}
      if(path==='admin/donation-links/change-request' && method==='POST') {const b=z.object({...revision,url:z.string().max(2048)}).strict().parse(body); return respond(await g.propose(admin,'donation.change',undefined,b.expected_revision,{url:b.url},b.request_id));}
      if(parts[1]==='action-requests' && parts[3]==='approve' && method==='POST') {const b=z.object(requestId).strict().parse(body); return respond(await g.approve(admin,z.uuid().parse(parts[2]),b.request_id));}
      if(path==='admin/security/lockdown' && method==='POST') {
        const b=z.object({...requestId,letterId:z.uuid().optional(),grantId:z.uuid().optional(),adminId:z.uuid().optional(),pauseNotifications:z.literal(true).optional(),disableAi:z.literal(true).optional(),reasonCode:code}).strict().refine(b=>b.letterId || b.grantId || b.adminId || b.pauseNotifications || b.disableAi).parse(body);
        return respond(await g.lockdown(admin,b,b.request_id));
      }
      if(parts[1]==='incidents' && (method==='POST' || method==='PATCH' || method==='DELETE')) {
        const b=incidentInput.parse(body); const id=parts[2]?z.uuid().parse(parts[2]):undefined;
        return respond(await g.incident(admin,id,{...b,status:method==='DELETE'?'closed':b.status},b.request_id));
      }
      if(method==='GET') {
        if(path==='admin/overview') return respond(await r.overview(admin,request_id));
        if(path==='admin/health') return respond(await r.health(admin,request_id));
        if(['tasks','missionaries','letters','access-requests','audit','notification-jobs','incidents'].includes(parts[1]) && parts.length===2) {
          const query=new URL(req.url).searchParams;
          return respond(await r.list(admin,parts[1] as ReadKind,offsetInput.parse(query.get('offset')??undefined),limitInput.parse(query.get('limit')??undefined),z.string().max(100).parse(query.get('search')??''),request_id));
        }
      }
      return fail(404,'not_found');
    } catch(error) {
      const status=error instanceof ApiError?error.status:error instanceof z.ZodError?400:500;
      if(d) {try{await d.core.db.insert(auditEvents).values({actorType:'request',action:'api.denied',requestId:request_id,outcome:String(status)});}catch{/* Preserve the original safe response if audit storage is unavailable. */}}
      return new Response(JSON.stringify({error:{code:error instanceof ApiError?error.code:status===400?'invalid_input':'internal_error'},request_id}),{status,headers});
    }
  };
}
const limiter=new MemoryRateLimiter(60);
export function workflowDependencies():WorkflowDependencies {
  const auth=new Services(getDatabase(),verifyLine,process.env.LINE_LOGIN_CHANNEL_ID??'',process.env.AUTH_ENCRYPTION_KEY??'',()=>new Date(),process.env.LINE_SUBJECT_ENC_KEY??'');
  const core=new WorkflowCore(auth,process.env.AUTH_ENCRYPTION_KEY??'');
  return {core,editorial:new Editorial(core),members:new Members(core,Number(process.env.PRAYER_SUPPRESSION_THRESHOLD??5)),delivery:new Delivery(core,new LineMessagingClient(process.env.LINE_MESSAGING_ACCESS_TOKEN??''),process.env.LINE_SUBJECT_ENC_KEY??'',process.env.LINE_MESSAGING_CHANNEL_SECRET??''),governance:new Governance(core,(process.env.DONATION_ALLOWED_DOMAINS??'revival.eoffering.org.tw').split(',')),reads:new AdminReads(core),media:new Media(core,new LocalPrivateStorage())};
}
export const workflowHandler=(req:Request)=>createWorkflowHandler(workflowDependencies,process.env.APP_ORIGIN??'https://localhost:3000',process.env.DISPATCH_SECRET??'',limiter)(req);
