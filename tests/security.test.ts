import { beforeAll,afterAll,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { authenticator } from 'otplib';
import { eq } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import { Services } from '../src/server/services';
import { createHandler,memberCookie,adminCookie } from '../src/server/http';
import { hash,hashPassword,encryptSecret,MemoryRateLimiter } from '../src/server/security';
const pg = new PGlite(); const db = drizzle(pg,{schema});
const key = 'ab'.repeat(32); const origin = 'https://care.example';
let claims: Record<string,unknown>; let svc: Services; let member: string; let adminId: string; let secret: string;
const req = (body: unknown, cookie = '', extra: Record<string,string> = {}) => new Request(origin,{method:'POST',headers:{origin,'content-type':'application/json','x-mc-csrf':'1',cookie,...extra},body:JSON.stringify(body)});
const call = (endpoint: Parameters<typeof createHandler>[0], request: Request,id?:string) => createHandler(endpoint,()=>svc,origin,new MemoryRateLimiter(100))(request,id);
beforeAll(async()=>{
  await migrate(db,{migrationsFolder:'./drizzle'});
  claims = {iss:'https://access.line.me',aud:'channel',exp:Date.now()/1000+3600,sub:'fictional-subject'};
  svc = new Services(db,async(token,nonce)=>{if(token==='fake') throw Error('secret stack'); return {...claims,nonce:claims.nonce ?? nonce};},'channel',key);
  const nonce = await svc.challenge(); member = await svc.loginLine('valid',nonce);
  secret = authenticator.generateSecret();
  const [admin] = await db.insert(schema.admins).values({email:'staff@example.test',passwordHash:await hashPassword('fictional-password'),totpSecretEncrypted:encryptSecret(secret,key),enabled:true}).returning(); adminId=admin.id;
  await db.insert(schema.staffAssignments).values({adminId,role:'support',expiresAt:new Date(Date.now()+3600000)});
});
afterAll(async()=>pg.close());
it('rejects fake, expired, wrong issuer/channel/nonce and replayed identities',async()=>{
  for (const patch of [{exp:1},{aud:'wrong'},{iss:'evil'},{nonce:'wrong'}]) {
    const previous={...claims}; Object.assign(claims,patch); await expect(svc.loginLine('valid',await svc.challenge())).rejects.toMatchObject({status:401}); claims=previous;
  }
  await expect(svc.loginLine('fake',await svc.challenge())).rejects.toMatchObject({status:401});
  const nonce=await svc.challenge(); await svc.loginLine('valid',nonce); await expect(svc.loginLine('valid',nonce)).rejects.toMatchObject({status:401});
  const identities=await db.select().from(schema.lineIdentities); expect(identities).toHaveLength(1); expect(identities[0].subHash).toBe(hash('fictional-subject'));
});
it('binds login nonce to browser, rejects forged roles and applies CSRF and rate limits',async()=>{
  const nonce=await svc.challenge();
  expect((await call('line',req({idToken:'valid',nonce}))).status).toBe(401);
  for (const field of ['role','user_id','missionary_id']) expect((await call('line',req({idToken:'valid',nonce,[field]:'forged'},`__Host-mc_nonce=${nonce}`))).status).toBe(400);
  expect((await call('line',req({idToken:'valid',nonce},'',{origin:'https://evil.example'}))).status).toBe(403);
  const limited=createHandler('challenge',()=>svc,origin,new MemoryRateLimiter(1)); await limited(req({})); expect((await limited(req({}))).status).toBe(429);
  const response=await call('line',req({idToken:'valid',nonce},`__Host-mc_nonce=${nonce}`)); expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  expect(JSON.stringify(await response.json())).not.toContain('fictional-subject');
});
it('grant A never exposes B through detail/list/count and expires immediately',async()=>{
  const user=await svc.member(member);
  const [a,b]=await db.insert(schema.missionaries).values([{code:'Fiction-A',active:true},{code:'Fiction-B',active:true}]).returning();
  await db.insert(schema.accessGrants).values({userId:user.id,missionaryId:a.id,expiresAt:new Date(Date.now()+3600000)});
  const [la,lb]=await db.insert(schema.letters).values([{missionaryId:a.id,authorId:adminId,title:'Fiction A',status:'published'},{missionaryId:b.id,authorId:adminId,title:'Fiction B',status:'published'}]).returning();
  expect(await svc.visibleMissionaries(member)).toEqual([expect.objectContaining({id:a.id})]);
  const response=await call('letters',new Request(origin,{headers:{cookie:`${memberCookie}=${member}`}}));
  expect((await response.json()).data).toMatchObject({count:1,items:[{id:la.id}]});
  await expect(svc.letter(member,lb.id)).rejects.toMatchObject({status:404});
  const missing=await call('letter',new Request(origin,{headers:{cookie:`${memberCookie}=${member}`}}),lb.id); expect(missing.status).toBe(404); expect(await missing.text()).not.toContain('Fiction B');
  await db.update(schema.accessGrants).set({revokedAt:new Date()}).where(eq(schema.accessGrants.missionaryId,a.id)); expect(await svc.visibleLetters(member)).toEqual([]);
});
it('staff auth requires password, MFA, live assignments and enabled identity; LINE cannot substitute',async()=>{
  expect((await call('overview',new Request(origin))).status).toBe(401);
  expect((await call('overview',new Request(origin,{headers:{cookie:`${memberCookie}=${member}`}}))).status).toBe(401);
  await expect(svc.passwordLogin('staff@example.test','wrong')).rejects.toMatchObject({status:401});
  const aal1=await svc.passwordLogin('staff@example.test','fictional-password');
  await expect(svc.staff(aal1,'overview')).rejects.toMatchObject({status:403});
  await expect(svc.mfa(aal1,'000000')).rejects.toMatchObject({status:401});
  const aal2=await svc.mfa(aal1,authenticator.generate(secret)); await svc.staff(aal2,'overview');
  await expect(svc.adminSession(aal1)).rejects.toMatchObject({status:401});
  const second=await svc.passwordLogin('staff@example.test','fictional-password'); await expect(svc.mfa(second,authenticator.generate(secret))).rejects.toMatchObject({status:401});
  await expect(svc.staff(aal2,'draft_edit','11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({status:404});
  const response=await call('overview',new Request(origin,{headers:{cookie:`${adminCookie}=${aal2}`}})); expect(response.status).toBe(200);
  await db.update(schema.staffAssignments).set({expiresAt:new Date(0)}).where(eq(schema.staffAssignments.adminId,adminId)); await expect(svc.staff(aal2,'overview')).rejects.toMatchObject({status:403});
  await svc.invalidateAdmin(adminId); await expect(svc.adminSession(aal2)).rejects.toMatchObject({status:401});
  const current=await svc.passwordLogin('staff@example.test','fictional-password'); await svc.invalidateAdmin(adminId,true); await expect(svc.adminSession(current,false)).rejects.toMatchObject({status:401});
});
it('migration defaults closed and prohibits offline detail storage',async()=>{
  const [m]=await db.insert(schema.missionaries).values({code:'Offline',governance:'offline'}).returning(); expect(m.active).toBe(false);
  await expect(db.insert(schema.missionarySecrets).values({missionaryId:m.id,encryptedDetails:'forbidden',deleteAfter:new Date()})).rejects.toThrow();
  const [pause]=await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key,'global_notification_pause')); expect(pause.enabled).toBe(true);
});
it('logout revokes member cookie and safe errors include request IDs',async()=>{
  await svc.logout(member); await expect(svc.member(member)).rejects.toMatchObject({status:401});
  const response=await call('letters',new Request(origin)); const data=await response.json(); expect(response.status).toBe(401); expect(data.request_id).toBeTruthy(); expect(data.error).toEqual({code:'unauthenticated'});
});
it('admin §16.14 audit storage failure never leaks a stack or raw database error',async()=>{
  const broken={async challenge(){return 'fictional-nonce';},db:{insert(){throw new Error('private database stack and secret');}}} as unknown as Services;
  const route=createHandler('challenge',()=>broken,origin,new MemoryRateLimiter());
  const response=await route(req({}));expect(response.status).toBe(500);const body=await response.json();expect(body.error).toEqual({code:'internal_error'});expect(body.request_id).toBeTruthy();expect(JSON.stringify(body)).not.toContain('private');
});
