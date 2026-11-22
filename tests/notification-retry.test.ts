import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,type Fixture,s,randomUUID,eq} from './workflow-fixture';
import {UiReads} from '../src/server/ui-reads';
import {AdminNotifications} from '../src/ui/admin-panels';
import {canRetryNotification} from '../src/server/policy';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
it('queue renders retry exactly for eligible pending/failed jobs under the server predicate',async()=>{
  await f.members.subscribe(f.member,f.a.id,true,true,randomUUID());
  const letter=await f.published();
  const [original]=await f.db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.letterId,letter.id));
  for(const state of [
    {status:'failed',attempts:1,errorCode:'permanent',expected:false},
    {status:'failed',attempts:1,errorCode:'retryable',expected:true},
    {status:'pending',attempts:1,errorCode:'retryable',expected:true},
    {status:'accepted',attempts:1,errorCode:null,expected:false},
    {status:'failed',attempts:3,errorCode:'retryable',expected:false},
  ]) {
    const {expected,...patch}=state;
    await f.db.update(s.deliveryJobs).set(patch).where(eq(s.deliveryJobs.id,original.id));
    const tab=state.status==='pending'?'pending':'sent';
    const value=await new UiReads(f.core).notifications(f.lead.token,tab,0);
    expect(canRetryNotification(value.items[0],value.items[0].retryEligible)).toBe(expected);
    const html=renderToStaticMarkup(createElement(AdminNotifications,{value,tab,pause:false,offset:0}));
    expect(html.includes('>重試</button>')).toBe(expected);
    const attempt=f.delivery.retry(f.lead.token,original.id,randomUUID());
    if(expected) await expect(attempt).resolves.toMatchObject({queued:true});
    else await expect(attempt).rejects.toMatchObject({status:409});
  }
  await f.db.update(s.deliveryJobs).set({status:'pending',attempts:1,errorCode:'retryable'}).where(eq(s.deliveryJobs.id,original.id));
  await f.db.update(s.accessGrants).set({revokedAt:f.clock.now}).where(eq(s.accessGrants.id,f.grant.id));
  const value=await new UiReads(f.core).notifications(f.lead.token,'pending',0);
  expect(value.items[0].retryEligible).toBe(false);
  await expect(f.delivery.retry(f.lead.token,original.id,randomUUID())).rejects.toMatchObject({status:409});
  expect(renderToStaticMarkup(createElement(AdminNotifications,{value:{items:[],count:0,next_offset:null},tab:'pending',pause:false,offset:0}))).not.toContain('>重試</button>');
});
