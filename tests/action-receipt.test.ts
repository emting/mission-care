import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { api, ClientError } from '../src/ui/shared';
import { fixture, type Fixture, s, randomUUID, eq } from './workflow-fixture';
let f:Fixture;
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f.pg.close();});
afterEach(()=>{vi.unstubAllGlobals();});

it('a high-risk action receipt retains the audited operation ID separately from the HTTP request ID, including replay',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(path:string,init:RequestInit)=>f.route(f.request(path.replace('/api/',''),JSON.parse(init.body as string),f.auditor.token))));
  const actionId=randomUUID();
  const body={request_id:actionId,disableAi:true,reasonCode:'suspected_disclosure'};
  const result=await api('admin/security/lockdown',body);
  expect(result.action_request_id).toBe(actionId);
  expect(result.request_id).not.toBe(actionId);
  const replay=await api('admin/security/lockdown',body);
  expect(replay.action_request_id).toBe(actionId);
  expect(replay.request_id).not.toBe(result.request_id);
  const audit=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,actionId));
  expect(audit).toHaveLength(1);
  expect(audit[0].action).toBe('security.lockdown');
});

it('non-action requests and failures retain the transport request ID without a fabricated action receipt',async()=>{
  const transportId=randomUUID();
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{},request_id:transportId})));
  expect(await api('auth/challenge')).toEqual({data:{},request_id:transportId});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'forbidden'},request_id:transportId},{status:403})));
  await expect(api('admin/security/lockdown',{request_id:randomUUID()})).rejects.toMatchObject(new ClientError('forbidden',transportId));
});
