import {it,expect} from 'vitest';
import {fixture,randomUUID,content,s,eq} from './workflow-fixture';
it('published -> edit -> return -> unchanged resubmit starts a fresh immutable revision and review round',async()=>{
  const f=await fixture();
  try {
    const l=await f.published();
    await f.editorial.edit(f.editor.token,l.id,1,content,randomUUID());
    const first=await f.editorial.submit(f.editor.token,l.id,2,randomUUID());
    await f.editorial.decide(f.reviewer.token,first.tasks[0].id,2,'reject',false,randomUUID(),'虛構確認事項已另行核對');
    const request_id=randomUUID();
    const response=await f.route(f.request(`admin/letters/${l.id}/submit-review`,{expected_revision:2,request_id},f.editor.token));
    expect(response.status).toBe(200);
    const {data:next}=await response.json();
    expect(next.revision).toBe(3);
    expect(await f.core.snapshot(f.db,l.id,3)).toEqual(await f.core.snapshot(f.db,l.id,2));
    expect((await f.route(f.request(`admin/letters/${l.id}/submit-review`,{expected_revision:2,request_id},f.editor.token))).status).toBe(200);
    await expect(f.editorial.publish(f.lead.token,l.id,3,randomUUID())).rejects.toMatchObject({status:409});
    await f.editorial.decide(f.reviewer.token,next.tasks[0].id,3,'approve',true,randomUUID());
    await f.editorial.decide(f.reviewer2.token,next.tasks[1].id,3,'approve',true,randomUUID());
    await f.editorial.publish(f.lead.token,l.id,3,randomUUID());
    const reviews=await f.db.select().from(s.letterReviews).where(eq(s.letterReviews.letterId,l.id));
    expect(reviews.filter(r=>r.revision===2 && r.decision==='reject')).toHaveLength(1);
    expect(reviews.filter(r=>r.revision===3 && r.decision==='approve')).toHaveLength(2);
  } finally {await f.pg.close();}
});
