import {it,expect} from 'vitest';
import {fixture,randomUUID,s,eq} from './workflow-fixture';
import {UiReads} from '../src/server/ui-reads';
it('reject requires a bounded nonblank note, stored encrypted and shown only to authorized staff',async()=>{
  const f=await fixture();
  try {
    const l=await f.draft(); const submitted=await f.editorial.submit(f.editor.token,l.id,1,randomUUID());
    for(const comment of ['', '   ', 'a'.repeat(2001)]) await expect(f.editorial.decide(f.reviewer.token,submitted.tasks[0].id,1,'reject',false,randomUUID(),comment)).rejects.toMatchObject({status:400,code:'return_comment_required'});
    expect((await f.core.letter(f.db,l.id)).status).toBe('pending_review');
    await f.editorial.decide(f.reviewer.token,submitted.tasks[0].id,1,'reject',false,randomUUID(),'  請核對虛構摘要。  ');
    const [review]=await f.db.select().from(s.letterReviews).where(eq(s.letterReviews.letterId,l.id));
    expect(review.returnCommentEncrypted).not.toContain('虛構摘要');
    const ui=new UiReads(f.core);
    expect((await ui.adminLetter(f.editor.token,l.id)).latestReturnNote).toBe('請核對虛構摘要。');
    await expect(ui.adminLetter(f.owner.token,l.id)).rejects.toMatchObject({status:404});
  } finally {await f.pg.close();}
});
