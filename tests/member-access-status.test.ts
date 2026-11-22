import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,s,eq,randomUUID} from './workflow-fixture';
import {UiReads} from '../src/server/ui-reads';
import {MemberPrivacy} from '../src/ui/member';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
it('member privacy reloads persisted own request/grant statuses and excludes other members',async()=>{
  const f=await fixture();
  try {
    for(const status of ['pending','approved','rejected']) await f.db.insert(s.accessRequests).values({userId:f.user.id,missionaryId:f.a.id,status});
    const [other]=await f.db.insert(s.users).values({}).returning();
    await f.db.insert(s.accessRequests).values({userId:other.id,missionaryId:f.b.id});
    const read=()=>new UiReads(f.core).memberAccess(f.member);
    const access=await read();
    expect(await read()).toEqual(access);
    expect(access.requests.map(r=>r.status).sort()).toEqual(['審核中','已核准','未通過'].sort());
    const html=renderToStaticMarkup(createElement(MemberPrivacy,{authenticated:true,access}));
    expect(html).toContain('我的閱讀權限');expect(html).toContain('到期日：');expect(html).not.toContain(f.b.code);
    await f.members.revoke(f.lead.token,f.grant.id,randomUUID());
    expect((await read()).grants[0].status).toBe('已撤銷');
    await f.db.update(s.accessGrants).set({revokedAt:null,expiresAt:new Date(+f.clock.now-1)}).where(eq(s.accessGrants.id,f.grant.id));
    expect((await read()).grants[0].status).toBe('已到期');
    await expect(new UiReads(f.core).memberAccess(undefined)).rejects.toMatchObject({status:401});
  } finally {await f.pg.close();}
});
