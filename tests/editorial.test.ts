import { beforeAll,afterAll,it,expect } from 'vitest';
import { fixture,type Fixture,s,w,randomUUID,content,eq } from './workflow-fixture';
let f:Fixture;
beforeAll(async()=>{f=await fixture();}); afterAll(async()=>f.pg.close());
it('PRD §12.5 未核准稿件不能透過直接 API、分享 URL 或快取瀏覽',async()=>{
  const l=await f.draft(); await expect(f.auth.letter(f.member,l.id)).rejects.toMatchObject({status:404});
  const response=await f.route(f.request('admin/letters/'+l.id,undefined,f.editor.token)); expect(response.headers.get('cache-control')).toBe('no-store'); const data=await response.json(); expect(data.data.draft.raw).toBeUndefined();
  await expect(f.editorial.publish(f.lead.token,l.id,1,randomUUID())).rejects.toMatchObject({status:409});
});
it('PRD §12.6 restricted 安全級別不能被一般編輯下調為公開',async()=>{
  const l=await f.draft(); await expect(f.editorial.edit(f.editor.token,l.id,1,{...content,visibility:'public'},randomUUID())).rejects.toMatchObject({status:403});
  await expect(f.governance.propose(f.editor.token,'letter.public',l.id,1,{consent:true},randomUUID())).rejects.toMatchObject({status:403});
});
it('PRD §12.7 修改文字與代禱點後舊版本核准失效；revision immutable',async()=>{
  const l=await f.draft(); await f.approved(l.id,1); await f.editorial.edit(f.editor.token,l.id,1,{...content,prayerPoints:['Updated']},randomUUID());
  const [row]=await f.db.select().from(s.letters).where(eq(s.letters.id,l.id)); expect(row).toMatchObject({revision:2,status:'draft',consentAt:null});
  await expect(f.editorial.publish(f.lead.token,l.id,2,randomUUID())).rejects.toMatchObject({status:409});
  await expect(f.db.update(s.letterRevisions).set({contentHash:'tampered'}).where(eq(s.letterRevisions.letterId,l.id))).rejects.toThrow();
});
it('PRD §12.8 同一作者不能繞過雙人審稿；admin §16.6 編輯不能自審',async()=>{
  const l=await f.draft(); const task=await f.editorial.submit(f.editor.token,l.id,1,randomUUID());
  await f.db.insert(s.staffAssignments).values({adminId:f.editor.id,role:'reviewer',missionaryId:f.a.id,expiresAt:new Date(+f.clock.now+3600000)});
  await expect(f.editorial.decide(f.editor.token,task.tasks[0].id,1,'approve',true,randomUUID())).rejects.toMatchObject({status:403});
  await f.editorial.decide(f.reviewer.token,task.tasks[0].id,1,'approve',true,randomUUID());
  await expect(f.editorial.decide(f.reviewer.token,task.tasks[1].id,1,'approve',true,randomUUID())).rejects.toMatchObject({status:409});
  await expect(f.editorial.publish(f.lead.token,l.id,1,randomUUID())).rejects.toMatchObject({status:409});
  await f.editorial.decide(f.reviewer2.token,task.tasks[1].id,1,'approve',true,randomUUID()); await f.editorial.publish(f.lead.token,l.id,1,randomUUID()); expect((await f.auth.letter(f.member,l.id)).id).toBe(l.id);
});
it('admin §16.11 同一 action 重複／並發只有一次有效更新與 audit；409 stale revision',async()=>{
  const l=await f.draft(); const requestId=randomUUID();
  const [a,b]=await Promise.all([f.editorial.edit(f.editor.token,l.id,1,{...content,title:'Changed'},requestId),f.editorial.edit(f.editor.token,l.id,1,{...content,title:'Changed'},requestId)]); expect(a).toEqual(b); expect(a.revision).toBe(2);
  const events=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,requestId)); expect(events).toHaveLength(1);
  await expect(f.editorial.edit(f.editor.token,l.id,1,content,randomUUID())).rejects.toMatchObject({status:409});
  await expect(f.editorial.edit(f.editor.token,l.id,2,content,requestId)).rejects.toMatchObject({status:409});
});
it('submit freezes revision; absent consent, task reassignment and stale decisions fail closed',async()=>{
  const l=await f.draft(); const t=await f.editorial.submit(f.editor.token,l.id,1,randomUUID());
  await expect(f.editorial.edit(f.editor.token,l.id,1,content,randomUUID())).rejects.toMatchObject({status:409});
  await expect(f.editorial.decide(f.reviewer.token,t.tasks[0].id,2,'approve',true,randomUUID())).rejects.toMatchObject({status:409});
  await f.editorial.decide(f.reviewer.token,t.tasks[0].id,1,'approve',false,randomUUID()); await expect(f.editorial.decide(f.reviewer2.token,t.tasks[1].id,1,'approve',false,randomUUID())).rejects.toMatchObject({status:409,code:'consent_required'});
  await expect(f.editorial.publish(f.lead.token,l.id,1,randomUUID())).rejects.toMatchObject({status:409});
});
it('member submission requires explicit expiring delegation and does not gain staff privilege',async()=>{
  const body={request_id:randomUUID(),missionaryId:f.a.id,content}; expect((await f.route(f.request('letters',body))).status).toBe(404);
  await f.db.insert(w.submitterAssignments).values({userId:f.user.id,missionaryId:f.a.id,editorAdminId:f.editor.id,expiresAt:new Date(+f.clock.now+3600000)});
  const response=await f.route(f.request('letters',{...body,request_id:randomUUID()})); expect(response.status).toBe(201);
  expect((await f.route(f.request('admin/tasks',undefined,undefined,f.member))).status).toBe(401);
});
it('publish revalidates current reviewer authority; idempotent replay rechecks live scope',async()=>{
  const l=await f.draft();await f.approved(l.id,1);
  await f.db.update(s.staffAssignments).set({revokedAt:f.clock.now}).where(eq(s.staffAssignments.adminId,f.reviewer2.id));
  await expect(f.editorial.publish(f.lead.token,l.id,1,randomUUID())).rejects.toMatchObject({status:409});
  await f.db.update(s.staffAssignments).set({revokedAt:null}).where(eq(s.staffAssignments.adminId,f.reviewer2.id));
  const l2=await f.draft();const requestId=randomUUID();await f.editorial.edit(f.editor.token,l2.id,1,content,requestId);
  await f.db.update(s.staffAssignments).set({revokedAt:f.clock.now}).where(eq(s.staffAssignments.adminId,f.editor.id));
  await expect(f.editorial.edit(f.editor.token,l2.id,1,content,requestId)).rejects.toMatchObject({status:404});
});
