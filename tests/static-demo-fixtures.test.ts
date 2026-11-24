import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {fixture,type Fixture,s,eq,randomUUID,subjectKey} from './workflow-fixture';
import {populateDemoWork,type DemoActors} from '../scripts/static-demo-fixtures';
import {UiReads} from '../src/server/ui-reads';

let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
function actors(value=f):DemoActors {
  return {editor:value.editor.token,reviewer:value.reviewer.token,reviewer2:value.reviewer2.token,mission_lead:value.lead.token,security_auditor:value.auditor.token,finance_link_manager:value.finance.token};
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
  const reads=new UiReads(f.core);
  const pending=await reads.notifications(f.lead.token,'pending',0);
  expect(pending.items).toHaveLength(1);
  expect(pending.items[0]).toMatchObject({status:'pending',attempts:0,retryEligible:true});
  expect((await reads.notifications(f.lead.token,'sent',0)).items).toEqual([expect.objectContaining({status:'failed',attempts:1,errorCode:'permanent'})]);
  expect((await new UiReads(f.core).donations(f.finance.token)).requests).toHaveLength(1);
  expect(await f.governance.cta()).toBeNull();
  expect((await f.db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'monthly_notification_quota')))[0].value).toBe(0);
  expect((await f.delivery.dispatch()).status).toBe('paused');
});
it('replaces pending work even when dispatch cancels an ineligible seed job',async()=>{
  const demo=await fixture();
  try {
    const letter=await demo.published();
    const [other]=await demo.db.insert(s.users).values({}).returning();
    const [original]=await demo.db.insert(s.deliveryJobs).values({letterId:letter.id,revision:letter.revision,userId:other.id,idempotencyKey:randomUUID(),scheduledAt:demo.clock.now}).returning();
    expect(original.status).toBe('pending');
    expect(await demo.delivery.eligible(demo.db,original)).toBeNull();
    await populateDemoWork(demo.core,demo.member,actors(demo),demo.a.id,subjectKey);
    expect((await demo.db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.id,original.id)))[0]).toMatchObject({status:'cancelled',errorCode:'ineligible'});
    const reads=new UiReads(demo.core);
    expect((await reads.notifications(demo.lead.token,'pending',0)).items).toEqual([expect.objectContaining({status:'pending',attempts:0,retryEligible:true})]);
    expect((await reads.notifications(demo.lead.token,'sent',0)).items).toContainEqual(expect.objectContaining({status:'failed',errorCode:'permanent'}));
    expect((await demo.delivery.dispatch()).status).toBe('paused');
  } finally {await demo.pg.close();}
});
