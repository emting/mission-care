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

it('AI drafting hides revision state until staff scope or member delegation is authorized', async () => {
  const l=await f.draft();
  const outsider=await f.staff(['editor'],f.b.id);
  for(const revision of [1,99]) {
    await expect(f.editorial.aiDraft(outsider.token,undefined,l.id,revision,randomUUID())).rejects.toMatchObject({status:404,code:'not_found'});
    await expect(f.editorial.aiDraft(undefined,f.member,l.id,revision,randomUUID())).rejects.toMatchObject({status:404,code:'not_found'});
  }
  await expect(f.editorial.aiDraft(outsider.token,undefined,randomUUID(),99,randomUUID())).rejects.toMatchObject({status:404});
  await expect(f.editorial.aiDraft(f.editor.token,undefined,l.id,99,randomUUID())).rejects.toMatchObject({status:409,code:'revision_conflict'});
  expect((await f.editorial.aiDraft(f.editor.token,undefined,l.id,1,randomUUID())).needs_human_review).toBe(true);
});

it.each(['restricted','public'] as const)('the final %s approval without consent keeps its task open', async (visibility) => {
  const l=await f.draft();
  let revision=1;
  if(visibility==='public') {
    await f.db.update(s.missionaries).set({governance:'public'}).where(eq(s.missionaries.id,f.a.id));
    const proposal=await f.governance.propose(f.editor.token,'letter.public',l.id,1,{consent:true},randomUUID());
    await f.governance.approve(f.owner.token,proposal.id,randomUUID());
    revision=2;
  }
  const submitted=await f.editorial.submit(f.editor.token,l.id,revision,randomUUID());
  if(visibility==='restricted') await f.editorial.decide(f.reviewer.token,submitted.tasks[0].id,revision,'approve',false,randomUUID());
  const task=submitted.tasks.at(-1)!;
  const reviewer=visibility==='restricted' ? f.reviewer2 : f.reviewer;
  const requestId=randomUUID();
  await expect(f.editorial.decide(reviewer.token,task.id,revision,'approve',false,requestId)).rejects.toMatchObject({status:409,code:'consent_required'});
  const [pending]=await f.db.select().from(s.reviewTasks).where(eq(s.reviewTasks.id,task.id));
  expect(pending.status).toBe('pending');
  await f.editorial.decide(reviewer.token,task.id,revision,'approve',true,requestId);
  await f.editorial.publish(f.lead.token,l.id,revision,randomUUID());
  expect((await f.auth.letter(f.member,l.id)).id).toBe(l.id);
});
