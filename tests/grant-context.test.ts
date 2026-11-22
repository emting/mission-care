import { beforeAll, afterAll, it, expect } from 'vitest';
import { fixture, type Fixture, s, randomUUID } from './workflow-fixture';
import { UiReads } from '../src/server/ui-reads';
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});

it('grant revocation context includes scoped missionary/member codes and the latest approved originating request, without LINE identity fields',async()=>{
  const reads=new UiReads(f.core);
  const [legacy]=await reads.grants(f.lead.token);
  expect(legacy).toMatchObject({id:f.grant.id,missionaryCode:f.a.code,requestId:null});
  expect(legacy.memberCode).toMatch(/^U-[A-F0-9]{12}$/);
  const [request]=await f.db.insert(s.accessRequests).values({userId:f.user.id,missionaryId:f.a.id}).returning();
  await f.members.decideAccess(f.lead.token,request.id,true,new Date(+f.clock.now+86400000),randomUUID());
  await f.db.insert(s.accessRequests).values({userId:f.user.id,missionaryId:f.a.id,status:'rejected',decidedBy:f.lead.id,decidedAt:new Date(+f.clock.now+1000)});
  const scoped=await f.staff(['access_reviewer'],f.b.id);
  expect(await reads.grants(scoped.token)).toEqual([]);
  await f.db.insert(s.accessGrants).values({userId:f.user.id,missionaryId:f.b.id,expiresAt:new Date(+f.clock.now+86400000)});
  const [result]=await reads.grants(f.lead.token);
  expect(result).toMatchObject({id:f.grant.id,missionaryCode:f.a.code,memberCode:legacy.memberCode,requestId:request.id});
  expect(await reads.grants(f.lead.token)).toHaveLength(1);
  expect((await reads.grants(scoped.token)).map(g=>g.missionaryId)).toEqual([f.b.id]);
  expect(JSON.stringify(result)).not.toContain(f.user.id);
  expect(JSON.stringify(result)).not.toMatch(/fictional-line-subject|subHash|encryptedSub|userId|approvedBy/);
  await expect(reads.grants(f.editor.token)).rejects.toMatchObject({status:403});
});
