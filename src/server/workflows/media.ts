import { and,eq,inArray } from 'drizzle-orm';
import * as s from '../db/schema';
import { WorkflowCore } from './core';
import { fail } from '../services';
import { hash } from '../security';
import { sanitizeImage,type PrivateStorage } from '../storage';
export class Media {
  constructor(public core:WorkflowCore,private storage:PrivateStorage) {}
  async upload(token:string|undefined,id:string,expected:number,bytes:Buffer,requestId:string) {
    const c=this.core; const l=await c.letter(c.db,id); const {admin}=await c.auth.staff(token,'draft_edit',l.missionaryId);
    const clean=await sanitizeImage(bytes);
    return c.operation({actorId:admin.id,action:'media.upload',requestId,resourceId:id},{id,expected,hash:hash(clean.toString('base64'))},async db=>{
      await c.staff(db,token,'draft_edit',l.missionaryId); const current=await c.letter(db,id); c.conflict(current.revision,expected);
      if(current.status==='pending_review') return fail(409,'revision_frozen');
      const m=await c.missionary(db,l.missionaryId); if(!m.allowPhotos || m.governance==='offline') return fail(403,'photos_disabled');
      const old=await c.snapshot(db,id,current.revision); if(old.assetIds.length>=10) return fail(400,'too_many_assets');
      const privateStorageKey=await this.storage.put(clean); const revision=current.revision+1;
      const [asset]=await db.insert(s.letterAssets).values({letterId:id,revision,privateStorageKey,contentHash:hash(clean.toString('base64')),mimeType:'image/webp',sanitizedAt:c.now()}).returning();
      const content={...old,assetIds:[...old.assetIds,asset.id]};
      await db.insert(s.letterRevisions).values({letterId:id,revision,editorId:admin.id,encryptedSnapshot:c.seal(content),contentHash:hash(JSON.stringify(content))});
      await db.insert(s.letterDrafts).values({letterId:id,revision,encryptedRaw:c.seal(content),deleteAfter:new Date(+c.now()+30*86400000)});
      await db.update(s.letters).set({revision,status:'draft',publishedAt:null,consentAt:null,title:'',safeSummary:null,prayerPoints:[]}).where(eq(s.letters.id,id));
      await db.update(s.reviewTasks).set({status:'superseded'}).where(eq(s.reviewTasks.letterId,id)); await c.cancelLetterJobs(db,id); return {id:asset.id,revision};
    });
  }
  async read(memberToken:string|undefined,adminToken:string|undefined,id:string,requestId:string) {
    const c=this.core; const [asset]=await c.db.select().from(s.letterAssets).where(eq(s.letterAssets.id,id));
    // Authenticate even when the requested resource is missing.
    const actor=adminToken ? (await c.auth.adminSession(adminToken)).admin.id : (await c.auth.member(memberToken)).id;
    if(!asset) return fail(404,'not_found'); const l=await c.letter(c.db,asset.letterId);
    if(adminToken) await c.auth.staff(adminToken,'letter_read',l.missionaryId);
    else {
      await c.auth.letter(memberToken,l.id); const content=await c.snapshot(c.db,l.id,l.revision);
      if(!asset.reviewedAt || !content.assetIds.includes(asset.id)) return fail(404,'not_found');
    }
    await c.audit(c.db,{actorId:actor,action:'media.read',resourceId:id,requestId,missionaryId:l.missionaryId});
    try { return await this.storage.get(asset.privateStorageKey); } catch { return fail(404,'not_found'); }
  }
}
