import {it,expect} from 'vitest';
import {fixture,randomUUID,s,eq} from './workflow-fixture';
it('requires a validated retraction reason and exposes safe actor, target and reason metadata',async()=>{
  const f=await fixture();
  try {
    const l=await f.published();
    for(const reasonCode of [undefined,'','raw unrestricted text']) {
      const response=await f.route(f.request(`admin/letters/${l.id}/archive`,{request_id:randomUUID(),expected_revision:1,reasonCode},f.lead.token));
      expect(response.status).toBe(400);
    }
    expect((await f.core.letter(f.db,l.id)).status).toBe('published');
    const requestId=randomUUID();
    await f.editorial.archive(f.lead.token,l.id,1,requestId,'suspected_disclosure');
    const [event]=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,requestId));
    expect(event).toMatchObject({actorId:f.lead.id,resourceId:l.id,reasonCode:'suspected_disclosure',action:'letter.archive'});
    const rows=await f.reads.list(f.auditor.token,'audit',0,50,'',randomUUID());
    expect(rows.items.find(x=>(x as {requestId:string}).requestId===requestId)).toMatchObject({actorLabel:expect.stringContaining('@example.test'),targetLabel:expect.stringContaining('Fiction-A'),targetHref:'/admin/letters/'+l.id,reasonCode:'suspected_disclosure'});
    expect(JSON.stringify(rows.items)).not.toContain('Fictional original text');
  } finally {await f.pg.close();}
});
