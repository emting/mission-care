import {it,expect} from 'vitest';
import {fixture,s,eq,randomUUID} from './workflow-fixture';
import {UiReads} from '../src/server/ui-reads';
it('revoked/expired historical access stays minimally listed, never reveals content, and can be re-requested',async()=>{
  const f=await fixture();
  try {
    const l=await f.published();
    await f.db.update(s.missionaries).set({governance:'invite_only',overview:'secret overview'}).where(eq(s.missionaries.id,f.a.id));
    await f.db.update(s.missionaries).set({governance:'invite_only'}).where(eq(s.missionaries.id,f.b.id));
    const ui=new UiReads(f.core);
    await f.members.revoke(f.lead.token,f.grant.id,randomUUID());
    const cards=await ui.memberList(f.member);
    expect(cards).toEqual([expect.objectContaining({code:f.a.code,overview:null,locked:true,accessStatus:'已撤銷',canRequest:true})]);
    expect(JSON.stringify(cards)).not.toContain('secret overview');
    await expect(ui.memberMissionary(f.member,f.a.id)).rejects.toMatchObject({status:404});
    await expect(f.auth.letter(f.member,l.id)).rejects.toMatchObject({status:404});
    await f.members.requestAccess(f.member,f.a.id,randomUUID());
    expect((await ui.memberList(f.member))[0]).toMatchObject({accessStatus:'審核中',canRequest:false});
    await f.members.requestAccess(f.member,f.b.id,randomUUID());
    expect((await ui.memberList(f.member)).map(m=>m.id)).not.toContain(f.b.id);
    const [offline]=await f.db.insert(s.missionaries).values({code:'Offline-known',governance:'offline'}).returning();
    await f.db.insert(s.accessGrants).values({userId:f.user.id,missionaryId:offline.id,revokedAt:f.clock.now,expiresAt:f.clock.now});
    expect((await ui.memberList(f.member)).find(m=>m.id===offline.id)).toMatchObject({locked:true,overview:null,canRequest:false});
  } finally {await f.pg.close();}
});
