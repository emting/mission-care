import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,type Fixture,s,randomUUID,eq} from './workflow-fixture';
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
it('every missing lockdown target returns 404 without incidents or other side effects and audits the failed actor',async()=>{
  for(const target of ['letterId','grantId','adminId']) {
    const requestId=randomUUID();
    const response=await f.route(f.request('admin/security/lockdown',{[target]:'00000000-0000-4000-8000-000000000001',reasonCode:'other',request_id:requestId},f.auditor.token));
    expect(response.status).toBe(404);
    expect(await f.db.select().from(s.securityIncidents)).toHaveLength(0);
    expect(await f.db.select().from(s.adminAlerts)).toHaveLength(0);
    const [audit]=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,requestId));
    expect(audit).toMatchObject({actorId:f.auditor.id,action:'security.lockdown',outcome:'404'});
  }
});
it('scoped lockdown cannot target another missionary and valid targets still work',async()=>{
  const scoped=await f.staff(['security_auditor'],f.b.id);
  await expect(f.governance.lockdown(scoped.token,{grantId:f.grant.id,reasonCode:'other'},randomUUID())).rejects.toMatchObject({status:404});
  expect(await f.db.select().from(s.securityIncidents)).toHaveLength(0);
  expect(await f.governance.lockdown(f.auditor.token,{grantId:f.grant.id,reasonCode:'other'},randomUUID())).toMatchObject({status:'locked_down'});
});
