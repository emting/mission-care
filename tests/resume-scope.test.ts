import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,type Fixture,s,randomUUID,eq} from './workflow-fixture';
import {UiReads} from '../src/server/ui-reads';
import {AdminSettings,AdminSecurity} from '../src/ui/admin-panels';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
it('scoped auditors see no resume form, matching the server church-wide assignment check',async()=>{
  const scoped=await f.staff(['security_auditor'],f.a.id);
  await expect(f.governance.resumeNotifications(scoped.token,{reasonCode:'other',confirmed:true},randomUUID())).rejects.toMatchObject({status:403});
  const identity=await new UiReads(f.core).identity(scoped.token);
  const html=renderToStaticMarkup(createElement(AdminSettings,{identity,health:null}));
  expect(html).not.toContain('確認恢復通知');
  expect(identity.permissions).not.toContain('notification_resume');
  expect(renderToStaticMarkup(createElement(AdminSecurity,{incidents:{items:[],count:0,next_offset:null},canLockdown:true,canResume:identity.permissions.includes('notification_resume')}))).not.toContain('前往教會設定恢復全域通知');
});
it('only live church-wide owner/auditor assignments expose the resume control, not revoked or expired ones',async()=>{
  for(const staff of [f.owner,f.auditor]) {
    const identity=await new UiReads(f.core).identity(staff.token);
    expect(renderToStaticMarkup(createElement(AdminSettings,{identity,health:null}))).toContain('確認恢復通知');
  }
  const scoped=await f.staff(['security_auditor'],f.a.id);
  for(const extra of [{revokedAt:f.clock.now,expiresAt:new Date(+f.clock.now+86400000)},{revokedAt:null,expiresAt:new Date(+f.clock.now-1)}]) {
    const [assignment]=await f.db.insert(s.staffAssignments).values({adminId:scoped.id,role:'security_auditor',missionaryId:null,...extra}).returning();
    const identity=await new UiReads(f.core).identity(scoped.token);
    expect(identity.permissions).not.toContain('notification_resume');
    await f.db.delete(s.staffAssignments).where(eq(s.staffAssignments.id,assignment.id));
  }
});
