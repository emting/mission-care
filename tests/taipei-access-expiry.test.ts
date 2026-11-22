import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,s,eq,randomUUID} from './workflow-fixture';
import {AdminAccess} from '../src/ui/admin-panels';
import {exclusiveTaipeiExpiry} from '../src/server/taipei-calendar';
import {formatGrantExpiry} from '../src/ui/shared';
import {canViewMissionary} from '../src/server/policy';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
it.each(['2026-05-31T16:00:00Z','2026-05-31T19:30:00Z','2026-05-31T23:59:59Z'])('uses Taipei date-picker default/min at %s (00:00–08:00 Taipei)',instant=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(instant));
  try {
    const html=renderToStaticMarkup(createElement(AdminAccess,{requests:{items:[],count:0,next_offset:null},grants:[],offset:0}));
    expect(html).toContain('min="2026-06-02"');expect(html).toContain('value="2026-07-01"');
  } finally {vi.useRealTimers();}
});
it('approves a calendar date through its last Taipei millisecond, then denies at the next day',async()=>{
  const f=await fixture();
  try {
    const [request]=await f.db.insert(s.accessRequests).values({userId:f.user.id,missionaryId:f.a.id}).returning();
    const response=await f.route(f.request(`admin/access-requests/${request.id}/decision`,{request_id:randomUUID(),approve:true,expiresOn:'2026-12-30'},f.lead.token));
    expect(response.status).toBe(200);
    const [grant]=await f.db.select().from(s.accessGrants).where(eq(s.accessGrants.id,f.grant.id));
    expect(grant.expiresAt.toISOString()).toBe('2026-12-30T16:00:00.000Z');
    expect(formatGrantExpiry(grant.expiresAt)).toBe('2026/12/30 23:59');
    const missionary={id:f.a.id,active:true,governance:'invite_only' as const};
    expect(canViewMissionary(f.user.id,missionary,[grant],new Date('2026-12-30T15:59:59.999Z'))).toBe(true);
    expect(canViewMissionary(f.user.id,missionary,[grant],new Date('2026-12-30T16:00:00.000Z'))).toBe(false);
    const invalid=await f.route(f.request(`admin/access-requests/${request.id}/decision`,{request_id:randomUUID(),approve:true,expiresOn:'2026-02-31'},f.lead.token));
    expect(invalid.status).toBe(400);expect((await invalid.json()).error.code).toBe('invalid_expiry');
    expect(exclusiveTaipeiExpiry('')).toBeNull();expect(exclusiveTaipeiExpiry('2026-13-01')).toBeNull();
    const missing=await f.route(f.request(`admin/access-requests/${request.id}/decision`,{request_id:randomUUID(),approve:true},f.lead.token));
    expect(missing.status).toBe(400);
  } finally {await f.pg.close();}
});
