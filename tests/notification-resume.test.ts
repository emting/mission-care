import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,type Fixture,s,randomUUID,eq} from './workflow-fixture';
import {ResumeNotifications} from '../src/ui/admin-panels';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
it('requires owner/auditor, recent MFA, explicit reason and confirmation and audits denials',async()=>{
  for(const body of [{confirmed:true},{reasonCode:'',confirmed:true},{reasonCode:'other',confirmed:false}]) {
    expect((await f.route(f.request('admin/security/resume-notifications',{...body,request_id:randomUUID()},f.owner.token))).status).toBe(400);
  }
  const denied=await f.route(f.request('admin/security/resume-notifications',{reasonCode:'other',confirmed:true,request_id:randomUUID()},f.editor.token));
  expect(denied.status).toBe(403);
  const [audit]=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,(await denied.json()).request_id));
  expect(audit).toMatchObject({actorId:f.editor.id,action:'api.denied',outcome:'403'});
  expect(renderToStaticMarkup(createElement(ResumeNotifications,{recentMfa:false}))).toMatch(/disabled=""/);
  const now=f.clock.now;
  f.clock.now=new Date(+now+6*60000);
  await expect(f.governance.resumeNotifications(f.owner.token,{reasonCode:'other',confirmed:true},randomUUID())).rejects.toMatchObject({code:'recent_mfa_required'});
  f.clock.now=now;
});
it('owner and auditor can resume with an audited receipt without bypassing zero quota',async()=>{
  await f.members.subscribe(f.member,f.a.id,true,true,randomUUID());
  await f.published();
  for(const admin of [f.owner,f.auditor]) {
    await f.db.update(s.systemSettings).set({enabled:true}).where(eq(s.systemSettings.key,'global_notification_pause'));
    const id=randomUUID();
    expect((await f.route(f.request('admin/security/resume-notifications',{reasonCode:'other',confirmed:true,request_id:id},admin.token))).status).toBe(200);
    const [audit]=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,id));
    expect(audit).toMatchObject({actorId:admin.id,action:'notification.resume',outcome:'success'});
    expect(await f.delivery.dispatch()).toMatchObject({status:'quota',processed:0});
  }
  expect(f.sent).toHaveLength(0);
});
