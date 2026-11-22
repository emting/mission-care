import { beforeAll, afterAll, it, expect } from 'vitest';
import { fixture, type Fixture, s, randomUUID, eq } from './workflow-fixture';
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});

it('lockdown rejects missing, blank and unsupported reasons before any mutation at service and route boundaries',async()=>{
  await f.db.update(s.systemSettings).set({enabled:false}).where(eq(s.systemSettings.key,'ai_import_disabled'));
  for(const reason of [undefined,'',' ','unsupported']) {
    await expect(f.governance.lockdown(f.auditor.token,{disableAi:true,reasonCode:reason as string},randomUUID())).rejects.toMatchObject({status:400});
    const response=await f.route(f.request('admin/security/lockdown',{disableAi:true,reasonCode:reason,request_id:randomUUID()},f.auditor.token));
    expect(response.status).toBe(400);
  }
  expect(await f.db.select().from(s.securityIncidents)).toHaveLength(0);
  const [setting]=await f.db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'ai_import_disabled'));
  expect(setting.enabled).toBe(false);
  expect(await f.governance.lockdown(f.auditor.token,{disableAi:true,reasonCode:'suspected_disclosure'},randomUUID())).toMatchObject({status:'locked_down'});
});
