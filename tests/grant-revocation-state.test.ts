import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,s,eq,randomUUID} from './workflow-fixture';
import {AdminAccess} from '../src/ui/admin-panels';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
it('expired and already-revoked grants reject new revocations with a clear conflict',async()=>{
  const f=await fixture();
  try {
    await f.members.revoke(f.lead.token,f.grant.id,randomUUID());
    await expect(f.members.revoke(f.lead.token,f.grant.id,randomUUID())).rejects.toMatchObject({status:409,code:'grant_inactive'});
    await f.db.update(s.accessGrants).set({revokedAt:null,expiresAt:f.clock.now}).where(eq(s.accessGrants.id,f.grant.id));
    const response=await f.route(f.request(`admin/access-grants/${f.grant.id}/revoke`,{request_id:randomUUID()},f.lead.token));
    expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('grant_inactive');
    expect((await f.db.select().from(s.accessGrants).where(eq(s.accessGrants.id,f.grant.id)))[0].revokedAt).toBeNull();
  } finally {await f.pg.close();}
});
it('expired/revoked grant controls are disabled, while active grant controls remain enabled',()=>{
  const now=new Date();
  const grant={missionaryId:'m',missionaryCode:'M-02',memberCode:'U-FICTIONAL',requestId:null};
  const html=renderToStaticMarkup(createElement(AdminAccess,{requests:{items:[],count:0,next_offset:null},offset:0,grants:[
    {...grant,id:'expired',expiresAt:new Date(+now-1000),revokedAt:null},
    {...grant,id:'revoked',expiresAt:new Date(+now+86400000),revokedAt:now},
    {...grant,id:'active',expiresAt:new Date(+now+86400000),revokedAt:null},
  ]}));
  const buttons=[...html.matchAll(/<button class="danger"[^>]*>/g)].map(m=>m[0]);
  expect(buttons).toHaveLength(3);expect(buttons[0]).toContain('disabled');expect(buttons[1]).toContain('disabled');expect(buttons[2]).not.toContain('disabled');
});
