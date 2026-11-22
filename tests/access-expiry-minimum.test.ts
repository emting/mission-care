import {it,expect} from 'vitest';
import {fixture,s,eq,randomUUID} from './workflow-fixture';
import {exclusiveTaipeiExpiry,minimumAccessExpiryDate} from '../src/server/taipei-calendar';
import {errorLabels} from '../src/ui/shared';
it('enforces the shared Taipei minimum for date and legacy timestamp approvals, including early morning',async()=>{
  const f=await fixture();
  try {
    f.clock.now=new Date('2026-11-21T16:15:00Z');
    expect(minimumAccessExpiryDate(f.clock.now)).toBe('2026-11-23');
    const [request]=await f.db.insert(s.accessRequests).values({userId:f.user.id,missionaryId:f.a.id}).returning();
    const decide=(expiry:{expiresOn?:string;expiresAt?:string})=>f.route(f.request(`admin/access-requests/${request.id}/decision`,{request_id:randomUUID(),approve:true,...expiry},f.lead.token));
    for(const expiry of [{expiresOn:'2026-11-22'},{expiresAt:exclusiveTaipeiExpiry('2026-11-22')!.toISOString()}]) {
      const response=await decide(expiry);expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('expiry_before_minimum');
      expect(errorLabels.expiry_before_minimum).toContain('臺北時間的明天');
    }
    for(const expiresOn of ['2026/11/23','2026-02-31','']) {
      const response=await decide({expiresOn});expect(response.status).toBe(400);
    }
    expect((await f.db.select().from(s.accessRequests).where(eq(s.accessRequests.id,request.id)))[0].status).toBe('pending');
    const accepted=await decide({expiresOn:minimumAccessExpiryDate(f.clock.now)});expect(accepted.status).toBe(200);
    expect((await f.db.select().from(s.accessGrants).where(eq(s.accessGrants.id,f.grant.id)))[0].expiresAt.toISOString()).toBe('2026-11-23T16:00:00.000Z');
  } finally {await f.pg.close();}
});
