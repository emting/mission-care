import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { fixture,type Fixture,s,w,randomUUID,content,eq,origin } from './workflow-fixture';
import { officialUrl } from '../src/server/workflows/governance';
import { AdminReads } from '../src/server/workflows/reads';
import { createWorkflowHandler } from '../src/server/workflow-http';
import { MemoryRateLimiter } from '../src/server/security';
let f:Fixture;
beforeAll(async()=>{f=await fixture();});afterAll(async()=>f.pg.close());
it('PRD §12.14 未核准網域或未獲雙人核准不顯示奉獻 CTA；admin §16.7 different accounts',async()=>{
  expect(await f.governance.cta()).toBeNull();
  for(const value of ['http://revival.eoffering.org.tw','https://evil.test','https://revival.eoffering.org.tw.evil.test','https://u:p@revival.eoffering.org.tw','https://revival.eoffering.org.tw:444']) expect(()=>officialUrl(value,['revival.eoffering.org.tw'])).toThrow();
  const action=await f.governance.propose(f.finance.token,'donation.change',undefined,1,{url:'https://revival.eoffering.org.tw/'},randomUUID());
  await expect(f.governance.approve(f.finance.token,action.id,randomUUID())).rejects.toMatchObject({status:403});expect(await f.governance.cta()).toBeNull();
  await f.governance.approve(f.finance2.token,action.id,randomUUID());expect(await f.governance.cta()).toEqual({url:'https://revival.eoffering.org.tw/',external:true});
});
it('admin §16.7 降低 restricted 需不同 proposer/approver、當事人同意與重審',async()=>{
  await f.db.update(s.missionaries).set({governance:'public'}).where(eq(s.missionaries.id,f.a.id));const l=await f.draft();
  const action=await f.governance.propose(f.editor.token,'letter.public',l.id,1,{consent:true},randomUUID());
  await expect(f.governance.approve(f.editor.token,action.id,randomUUID())).rejects.toMatchObject({status:403});await f.governance.approve(f.owner.token,action.id,randomUUID());
  const [letter]=await f.db.select().from(s.letters).where(eq(s.letters.id,l.id));expect(letter).toMatchObject({visibility:'public',revision:2,status:'draft',consentAt:null});
  await expect(f.editorial.publish(f.lead.token,l.id,2,randomUUID())).rejects.toMatchObject({status:409});
  await f.db.update(s.missionaries).set({governance:'invite_only'}).where(eq(s.missionaries.id,f.a.id));
});
it('admin §16.4 scope filters search/pagination/count/errors and blocks forged missionary IDs',async()=>{
  const other=await f.staff(['editor'],f.b.id);const b=await f.editorial.create(other.token,undefined,f.b.id,{...content,title:'Hidden Fiction B'},randomUUID());await f.draft();
  const list=await f.reads.list(f.editor.token,'letters',0,1,'',randomUUID());expect(list.items).toHaveLength(1);expect(JSON.stringify(list)).not.toContain(b.id);
  const search=await f.reads.list(f.editor.token,'letters',0,50,'Hidden Fiction B',randomUUID());expect(search).toMatchObject({items:[],count:0,next_offset:null});
  await expect(f.reads.letter(f.editor.token,b.id,randomUUID())).rejects.toMatchObject({status:404});
  const response=await f.route(f.request('admin/letters/'+b.id,undefined,f.editor.token));expect(response.status).toBe(404);expect(await response.text()).not.toContain('Hidden Fiction B');
  expect((await f.route(f.request('admin/letters',{request_id:randomUUID(),missionaryId:f.b.id,content,role:'church_owner'},f.editor.token))).status).toBe(400);
});
it('admin §16.12 source errors return unavailable, never false 0',async()=>{
  const reads=new AdminReads(f.core);const spy=vi.spyOn(reads,'list').mockRejectedValue(new Error('secret database stack'));
  const overview=await reads.overview(f.lead.token,randomUUID());expect(overview.tasks).toEqual({status:'unavailable'});expect(JSON.stringify(overview)).not.toContain('secret');spy.mockRestore();
});
it('PRD §12.15 and admin §16.15 lockdown reduces visibility, pauses sending, disables AI, revokes sessions and records review',async()=>{
  const l=await f.published();await f.members.subscribe(f.member,f.a.id,true,true,randomUUID());
  await f.governance.lockdown(f.auditor.token,{letterId:l.id,grantId:f.grant.id,adminId:f.editor.id,pauseNotifications:true,disableAi:true,reasonCode:'emergency_lockdown'},randomUUID());
  await expect(f.auth.adminSession(f.editor.token)).rejects.toMatchObject({status:401});await expect(f.auth.letter(f.member,l.id)).rejects.toMatchObject({status:404});
  expect((await f.delivery.dispatch()).status).toBe('paused');const flags=await f.db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'ai_import_disabled'));expect(flags[0].enabled).toBe(true);
  expect(await f.db.select().from(s.adminAlerts)).toHaveLength(1);
  const response=await f.route(f.request('admin/security/lockdown',{request_id:randomUUID(),pauseNotifications:false,reasonCode:'other'},f.auditor.token));expect(response.status).toBe(400);
});
it('admin §16.14 security logs contain metadata only, no raw content, subject, path or token; incidents controlled codes',async()=>{
  const incident=await f.governance.incident(f.auditor.token,undefined,{category:'suspected_disclosure',reasonCode:'suspected_disclosure',severity:'high',status:'open'},randomUUID());
  await f.governance.incident(f.auditor.token,incident.id,{category:'suspected_disclosure',reasonCode:'other',severity:'medium',status:'closed'},randomUUID());
  const response=await f.route(f.request('admin/incidents',{request_id:randomUUID(),category:'raw private original',reasonCode:'other',severity:'high',status:'open'},f.auditor.token));expect(response.status).toBe(400);
  const audit=JSON.stringify(await f.db.select().from(s.auditEvents));for(const value of [content.raw,'fictional-line-subject',f.member,f.editor.token,'privateStorageKey'])expect(audit).not.toContain(value);
  await expect(f.db.update(s.auditEvents).set({outcome:'tampered'})).rejects.toThrow();
});
it('PRD §12.16 privacy request is trackable and disables account/consent/grants/queued notifications',async()=>{
  const response=await f.route(f.request('privacy/delete-request',{request_id:randomUUID()}));expect(response.status).toBe(202);expect((await response.json()).data).toMatchObject({status:'pending'});
  await expect(f.auth.member(f.member)).rejects.toMatchObject({status:401});const [user]=await f.db.select().from(s.users).where(eq(s.users.id,f.user.id));expect(user.enabled).toBe(false);
  const [request]=await f.db.select().from(s.privacyRequests);expect(request.deleteAfter).toBeInstanceOf(Date);
});
it('access request cannot enumerate resources, is rate-limited, and approvals are scoped/expiring',async()=>{
  const member=randomUUID();const [u]=await f.db.insert(s.users).values({}).returning();const {hash}=await import('../src/server/security');await f.db.insert(s.sessions).values({userId:u.id,tokenHash:hash(member),expiresAt:new Date(+f.clock.now+86400000)});
  await f.db.insert(s.accessGrants).values({userId:u.id,missionaryId:f.b.id,revokedAt:f.clock.now,expiresAt:f.clock.now});
  const requestId=randomUUID();expect(await f.members.requestAccess(member,f.b.id,requestId)).toEqual({accepted:true});expect(await f.members.requestAccess(member,randomUUID(),randomUUID())).toEqual({accepted:true});
  const [request]=await f.db.select().from(s.accessRequests).where(eq(s.accessRequests.userId,u.id));
  await expect(f.members.decideAccess(f.lead.token,request.id,true,new Date(+f.clock.now+1000),randomUUID())).rejects.toMatchObject({status:404});
  const scoped=await f.staff(['access_reviewer'],f.b.id);await expect(f.members.decideAccess(scoped.token,request.id,true,new Date(0),randomUUID())).rejects.toMatchObject({status:400});
  await f.members.decideAccess(scoped.token,request.id,true,new Date(+f.clock.now+1000),randomUUID());
  const limit=createWorkflowHandler(()=>({core:f.core,editorial:f.editorial,members:f.members,delivery:f.delivery,governance:f.governance,reads:f.reads,media:f.media}),origin,'secret',new MemoryRateLimiter(1));
  await limit(f.request('grants/request',{request_id:randomUUID(),missionaryId:f.a.id},undefined,member));expect((await limit(f.request('grants/request',{request_id:randomUUID(),missionaryId:f.a.id},undefined,member))).status).toBe(429);
});
