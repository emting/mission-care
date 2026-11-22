import { beforeEach, afterEach, it, expect } from 'vitest';
import { fixture, type Fixture, s, eq, content, randomUUID } from './workflow-fixture';

let f: Fixture;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.pg.close(); });

it('restricted drafts of previously public letters require new dual control before becoming public', async () => {
  await f.db.update(s.missionaries).set({governance:'public'}).where(eq(s.missionaries.id,f.a.id));
  const l = await f.draft();
  const makePublic = async (revision:number) => {
    const request = await f.governance.propose(f.editor.token,'letter.public',l.id,revision,{consent:true},randomUUID());
    await f.governance.approve(f.owner.token,request.id,randomUUID());
    const submitted = await f.editorial.submit(f.editor.token,l.id,revision+1,randomUUID());
    expect(submitted.tasks).toHaveLength(1);
    await f.editorial.decide(f.reviewer.token,submitted.tasks[0].id,revision+1,'approve',true,randomUUID());
    await f.editorial.publish(f.lead.token,l.id,revision+1,randomUUID());
  };
  await makePublic(1);
  await f.editorial.edit(f.editor.token,l.id,2,{...content,visibility:'public'},randomUUID());
  await f.editorial.edit(f.editor.token,l.id,3,content,randomUUID());
  await expect(f.editorial.edit(f.editor.token,l.id,4,{...content,visibility:'public'},randomUUID())).rejects.toMatchObject({status:403,code:'dual_control_required'});
  expect((await f.core.snapshot(f.db,l.id,4)).visibility).toBe('restricted');
  const submitted = await f.editorial.submit(f.editor.token,l.id,4,randomUUID());
  expect(submitted.tasks).toHaveLength(2);
  await f.editorial.decide(f.reviewer.token,submitted.tasks[0].id,4,'reject',false,randomUUID());
  await makePublic(4);
  expect((await f.auth.letter(f.member,l.id)).id).toBe(l.id);
  const [published]=await f.db.select().from(s.letters).where(eq(s.letters.id,l.id));
  expect(published).toMatchObject({status:'published',visibility:'public',revision:5});
});
