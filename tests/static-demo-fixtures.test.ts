import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {fixture,type Fixture,s,eq,randomUUID,subjectKey} from './workflow-fixture';
import {populateDemoWork,type DemoActors} from '../scripts/static-demo-fixtures';
import {UiReads} from '../src/server/ui-reads';

let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
function actors():DemoActors {
  return {editor:f.editor.token,reviewer:f.reviewer.token,reviewer2:f.reviewer2.token,mission_lead:f.lead.token,security_auditor:f.auditor.token,finance_link_manager:f.finance.token};
}
it('does not write demo work for a missing member session',async()=>{
  await expect(populateDemoWork(f.core,'',actors(),f.a.id,subjectKey)).rejects.toMatchObject({status:401});
  expect(await f.db.select().from(s.letters)).toHaveLength(0);
  expect(await f.db.select().from(s.adminActionRequests)).toHaveLength(0);
});
it('fills authorized work queues from an empty fixture without network access or broader permissions',async()=>{
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Demo must not call the network'));
  try {
    await populateDemoWork(f.core,f.member,actors(),f.a.id,subjectKey);
    expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();}
  const overview=await f.reads.overview(f.lead.token,randomUUID());
  for(const key of ['tasks','access_requests','notification_jobs'] as const) expect(overview[key]).toEqual({status:'available',count:1});
  expect(overview.incidents).toEqual({status:'not_authorized'});
  const security=await f.reads.overview(f.auditor.token,randomUUID());
  expect(security.incidents).toEqual({status:'available',count:1});
  const owner=await f.reads.overview(f.owner.token,randomUUID());
  for(const key of ['tasks','access_requests','notification_jobs','incidents'] as const) expect(owner[key]).toEqual({status:'not_authorized'});
  const [job]=await f.db.select().from(s.deliveryJobs);
  expect(job).toMatchObject({status:'failed',attempts:1,errorCode:'permanent'});
  expect((await new UiReads(f.core).donations(f.finance.token)).requests).toHaveLength(1);
  expect(await f.governance.cta()).toBeNull();
  expect((await f.db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'monthly_notification_quota')))[0].value).toBe(0);
  expect((await f.delivery.dispatch()).status).toBe('paused');
});
