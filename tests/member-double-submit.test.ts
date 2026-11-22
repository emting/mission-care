import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,type Fixture,s,randomUUID,eq} from './workflow-fixture';
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
it('concurrent access requests with different transport/action IDs create only one pending request per member/missionary',async()=>{
  await Promise.all(Array.from({length:8},()=>f.members.requestAccess(f.member,f.a.id,randomUUID())));
  expect(await f.db.select().from(s.accessRequests)).toHaveLength(1);
  await f.db.update(s.accessRequests).set({status:'rejected'}).where(eq(s.accessRequests.userId,f.user.id));
  await Promise.all(Array.from({length:4},()=>f.members.requestAccess(f.member,f.a.id,randomUUID())));
  const rows=await f.db.select().from(s.accessRequests);
  expect(rows.filter(r=>r.status==='pending')).toHaveLength(1);
  expect(rows.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(await f.members.requestAccess(f.member,randomUUID(),randomUUID())).toEqual({accepted:true});
  await expect(f.members.requestAccess(undefined,f.a.id,randomUUID())).rejects.toMatchObject({status:401});
});
it('preference responses return authoritative independent state, including failed updates',async()=>{
  expect(await f.members.subscribe(f.member,f.a.id,true,false,randomUUID())).toMatchObject({following:true,pushOptIn:false});
  expect(await f.members.subscribe(f.member,f.a.id,undefined,true,randomUUID())).toMatchObject({following:true,pushOptIn:true});
  await expect(f.members.subscribe(f.member,randomUUID(),false,false,randomUUID())).rejects.toMatchObject({status:404});
  const [saved]=await f.db.select().from(s.subscriptions).where(eq(s.subscriptions.userId,f.user.id));
  expect(saved).toMatchObject({following:true,pushOptIn:true});
});
