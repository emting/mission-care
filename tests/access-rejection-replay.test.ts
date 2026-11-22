import {it,expect} from 'vitest';
import {fixture,s,eq,randomUUID} from './workflow-fixture';
it('replays an expiry-free rejection after time advances without a hash conflict or duplicate decision',async()=>{
  const f=await fixture();
  try {
    const [request]=await f.db.insert(s.accessRequests).values({userId:f.user.id,missionaryId:f.a.id}).returning();
    const body={request_id:randomUUID(),approve:false};
    const post=()=>f.route(f.request(`admin/access-requests/${request.id}/decision`,body,f.lead.token));
    const first=await post();expect(first.status).toBe(200);
    const initial=await first.json();
    f.clock.now=new Date(+f.clock.now+1000);
    const replay=await post();expect(replay.status).toBe(200);expect((await replay.json()).data).toEqual(initial.data);
    const events=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,body.request_id));
    expect(events).toHaveLength(1);expect(events[0].outcome).toBe('success');
    const changed=await f.route(f.request(`admin/access-requests/${request.id}/decision`,{...body,approve:true,expiresOn:'2026-12-01'},f.lead.token));
    expect(changed.status).toBe(409);expect((await changed.json()).error.code).toBe('request_conflict');
  } finally {await f.pg.close();}
});
