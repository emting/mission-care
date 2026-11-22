import {it,expect} from 'vitest';
import {fixture,s,eq,randomUUID} from './workflow-fixture';
import {UiReads} from '../src/server/ui-reads';
it('audit links require the same live destination permission as the detail screen',async()=>{
  const f=await fixture();
  try {
    const letter=await f.draft();
    const requestId=randomUUID();
    await f.core.audit(f.db,{actorId:f.editor.id,action:'letter.edit',requestId,resourceId:letter.id});
    const read=async(token:string)=>{
      const rows=await f.reads.list(token,'audit',0,50,'',randomUUID());
      return rows.items.find(row=>(row as {requestId:string}).requestId===requestId);
    };
    expect(await read(f.auditor.token)).toMatchObject({targetLabel:expect.stringContaining(f.a.code),targetHref:null});
    await expect(new UiReads(f.core).adminLetter(f.auditor.token,letter.id)).rejects.toMatchObject({status:404});
    const both=await f.staff(['security_auditor','editor']);
    expect(await read(both.token)).toMatchObject({targetHref:`/admin/letters/${letter.id}`});
    expect((await new UiReads(f.core).adminLetter(both.token,letter.id)).id).toBe(letter.id);
    await f.db.update(s.staffAssignments).set({missionaryId:f.b.id}).where(eq(s.staffAssignments.adminId,both.id));
    await expect(f.reads.list(both.token,'audit',0,50,'',randomUUID())).resolves.toMatchObject({items:[]});
    const global=await f.staff(['security_auditor'],null);
    const [assignment]=await f.db.insert(s.staffAssignments).values({adminId:global.id,role:'editor',missionaryId:f.b.id,expiresAt:new Date(+f.clock.now+86400000)}).returning();
    expect(await read(global.token)).toMatchObject({targetHref:null});
    await f.db.update(s.staffAssignments).set({missionaryId:f.a.id,expiresAt:f.clock.now}).where(eq(s.staffAssignments.id,assignment.id));
    expect(await read(global.token)).toMatchObject({targetHref:null});
    await f.db.update(s.staffAssignments).set({expiresAt:new Date(+f.clock.now+86400000),revokedAt:f.clock.now}).where(eq(s.staffAssignments.id,assignment.id));
    expect(await read(global.token)).toMatchObject({targetHref:null});
    await f.core.audit(f.db,{actorId:f.editor.id,action:'subscription.update',requestId:randomUUID(),missionaryId:f.a.id});
    const rows=await f.reads.list(f.auditor.token,'audit',0,50,'',randomUUID());
    expect(rows.items.filter(row=>(row as {missionaryId:string}).missionaryId===f.a.id)).toEqual(expect.arrayContaining([expect.objectContaining({targetLabel:f.a.code,targetHref:null})]));
    await f.db.update(s.staffAssignments).set({revokedAt:null}).where(eq(s.staffAssignments.id,assignment.id));
    const allowed=await f.reads.list(global.token,'audit',0,50,'',randomUUID());
    expect(allowed.items).toEqual(expect.arrayContaining([expect.objectContaining({targetLabel:f.a.code,targetHref:`/admin/missionaries/${f.a.id}`})]));
  } finally {await f.pg.close();}
});
