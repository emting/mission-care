import {it,expect} from 'vitest';
import {fixture,randomUUID} from './workflow-fixture';
it('reviewer queue identifies requests with missionary and pseudonymous member codes, not LINE identities',async()=>{
  const f=await fixture();
  try {
    await f.members.requestAccess(f.member,f.a.id,randomUUID());
    const rows=await f.reads.list(f.lead.token,'access-requests',0,20,'',randomUUID());
    expect(rows.items).toEqual([expect.objectContaining({missionaryCode:f.a.code,memberCode:expect.stringMatching(/^U-[A-F0-9]{12}$/)})]);
    expect(JSON.stringify(rows)).not.toContain('fictional-line-subject');
    expect(JSON.stringify(rows)).not.toContain(f.user.id);
    await expect(f.reads.list(f.owner.token,'access-requests',0,20,'',randomUUID())).rejects.toMatchObject({status:403});
  } finally {await f.pg.close();}
});
