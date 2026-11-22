import { randomUUID } from 'node:crypto';
import { and,eq,gt,isNull,inArray } from 'drizzle-orm';
import * as s from '../db/schema';
import * as w from '../db/workflow-schema';
import { fail } from '../services';
import { hash,encryptSecret } from '../security';
import { draftSafely,localAi,type AiProvider } from '../ai';
import { staffCan } from '../policy';
import { WorkflowCore,type Content } from './core';
import {securityReasonInput} from '../security-reason';
import {z} from 'zod';
export const returnCommentInput=z.string().trim().min(1).max(2000);
export class Editorial {
  constructor(public core:WorkflowCore,private ai:AiProvider=localAi) {}
  async create(token:string|undefined,memberToken:string|undefined,missionaryId:string,content:Content,requestId:string) {
    const c=this.core;
    const actor=token ? (await c.auth.adminSession(token)).admin.id : (await c.auth.member(memberToken)).id;
    return c.operation({actorId:actor,action:'letter.create',requestId,missionaryId},{missionaryId,content},async db=>{
      const m=await c.missionary(db,missionaryId); if(m.governance==='offline') return fail(404,'not_found');
      let editorId=actor;
      if(token) await c.staff(db,token,'draft_edit',missionaryId);
      else {
        const [assignment]=await db.select().from(w.submitterAssignments).where(and(eq(w.submitterAssignments.userId,actor),eq(w.submitterAssignments.missionaryId,missionaryId),isNull(w.submitterAssignments.revokedAt),gt(w.submitterAssignments.expiresAt,c.now())));
        if(!assignment) return fail(404,'not_found'); editorId=assignment.editorAdminId;
        const [editor]=await db.select().from(s.admins).where(and(eq(s.admins.id,editorId),eq(s.admins.enabled,true))); if(!editor) return fail(403,'editor_unavailable');
      }
      if(content.visibility==='public') return fail(403,'new_letters_restricted');
      const [letter]=await db.insert(s.letters).values({missionaryId,authorId:editorId,title:''}).returning();
      await db.insert(s.letterRevisions).values({letterId:letter.id,revision:1,editorId,encryptedSnapshot:c.seal(content),contentHash:hash(JSON.stringify(content))});
      await db.insert(s.letterDrafts).values({letterId:letter.id,revision:1,encryptedRaw:c.seal(content),deleteAfter:new Date(+c.now()+30*86400000)});
      if(!token) await db.insert(w.memberSubmissions).values({letterId:letter.id,userId:actor});
      return {id:letter.id,revision:1};
    });
  }
  async edit(token:string|undefined,id:string,expected:number,content:Content,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'letter.edit',resourceId:id,requestId},{id,expected,content},async db=>{
      const l=await c.letter(db,id); await c.staff(db,token,'draft_edit',l.missionaryId); c.conflict(l.revision,expected);
      const m=await c.missionary(db,l.missionaryId); if(m.governance==='offline') return fail(403,'offline');
      const current=await c.snapshot(db,id,l.revision);
      if(content.visibility==='public' && current.visibility==='restricted') return fail(403,'dual_control_required');
      if(m.governance==='invite_only' && content.visibility!=='restricted') return fail(403,'policy_floor');
      if(l.status==='pending_review') return fail(409,'revision_frozen');
      if(content.assetIds.length) {
        const assets=await db.select().from(s.letterAssets).where(inArray(s.letterAssets.id,content.assetIds));
        if(assets.length!==content.assetIds.length || assets.some(a=>a.letterId!==id || !a.sanitizedAt)) return fail(400,'invalid_assets');
      }
      const revision=l.revision+1;
      await db.insert(s.letterRevisions).values({letterId:id,revision,editorId:admin.id,encryptedSnapshot:c.seal(content),contentHash:hash(JSON.stringify(content))});
      await db.insert(s.letterDrafts).values({letterId:id,revision,encryptedRaw:c.seal(content),deleteAfter:new Date(+c.now()+30*86400000)});
      await db.update(s.letters).set({revision,status:'draft',publishedAt:null,consentAt:null,title:'',safeSummary:null,prayerPoints:[]}).where(eq(s.letters.id,id));
      await db.update(s.reviewTasks).set({status:'superseded'}).where(eq(s.reviewTasks.letterId,id));
      await c.cancelLetterJobs(db,id); return {id,revision};
    });
  }
  async submit(token:string|undefined,id:string,expected:number,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'letter.submit',resourceId:id,requestId},{id,expected},async db=>{
      const l=await c.letter(db,id); await c.staff(db,token,'submit_review',l.missionaryId); c.conflict(l.revision,expected);
      if(l.status!=='draft') return fail(409,'invalid_state');
      const existingReviews=await db.select().from(s.letterReviews).where(and(eq(s.letterReviews.letterId,id),eq(s.letterReviews.revision,l.revision)));
      const content=await c.snapshot(db,id,l.revision);
      let revision=l.revision;
      if(existingReviews.length) {
        revision++;
        await db.insert(s.letterRevisions).values({letterId:id,revision,editorId:admin.id,encryptedSnapshot:c.seal(content),contentHash:hash(JSON.stringify(content))});
        await db.insert(s.letterDrafts).values({letterId:id,revision,encryptedRaw:c.seal(content),deleteAfter:new Date(+c.now()+30*86400000)});
      }
      const m=await c.missionary(db,l.missionaryId); const required=m.governance==='invite_only' || content.visibility==='restricted' ? 2 : 1;
      const tasks=await db.insert(s.reviewTasks).values(Array.from({length:required},()=>({letterId:id,revision}))).returning({id:s.reviewTasks.id});
      await db.update(s.letters).set({status:'pending_review',revision,consentAt:null}).where(eq(s.letters.id,id)); return {id,revision,tasks};
    });
  }
  async decide(token:string|undefined,taskId:string,expected:number,decision:'approve'|'reject',consent:boolean,requestId:string,comment='') {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'review.decision',resourceId:taskId,requestId},{taskId,expected,decision,consent,comment},async db=>{
      const [task]=await db.select().from(s.reviewTasks).where(eq(s.reviewTasks.id,taskId)); if(!task) return fail(404,'not_found');
      const l=await c.letter(db,task.letterId); await c.staff(db,token,'review',l.missionaryId); c.conflict(l.revision,expected); c.conflict(task.revision,expected);
      if(l.status!=='pending_review' || task.status!=='pending' || (task.assigneeId && task.assigneeId!==admin.id)) return fail(409,'invalid_state');
      const [memberAuthor]=await db.select().from(w.memberSubmissions).innerJoin(w.adminUserLinks,eq(w.adminUserLinks.userId,w.memberSubmissions.userId)).where(and(eq(w.memberSubmissions.letterId,l.id),eq(w.adminUserLinks.adminId,admin.id)));
      const revisions=await db.select().from(s.letterRevisions).where(eq(s.letterRevisions.letterId,l.id));
      if(l.authorId===admin.id || memberAuthor || revisions.some(r=>r.editorId===admin.id)) return fail(403,'self_approval');
      const old=await db.select().from(s.letterReviews).where(and(eq(s.letterReviews.letterId,l.id),eq(s.letterReviews.revision,l.revision),eq(s.letterReviews.reviewerId,admin.id)));
      if(old.length) return fail(409,'already_reviewed');
      const note=decision==='reject'?returnCommentInput.safeParse(comment):null;
      if(note && !note.success) return fail(400,'return_comment_required');
      const content=await c.snapshot(db,l.id,l.revision);
      const assets=content.assetIds.length ? await db.select().from(s.letterAssets).where(inArray(s.letterAssets.id,content.assetIds)) : [];
      if(assets.some(a=>!a.sanitizedAt)) return fail(409,'unsafe_assets');
      await db.insert(s.letterReviews).values({letterId:l.id,revision:l.revision,reviewerId:admin.id,decision,returnCommentEncrypted:note?.success?encryptSecret(note.data,c.key):null,consentConfirmed:consent,mediaHashes:assets.map(a=>a.contentHash)});
      await db.update(s.reviewTasks).set({status:decision,assigneeId:admin.id}).where(eq(s.reviewTasks.id,taskId));
      if(decision==='reject') {
        await db.update(s.letters).set({status:'draft'}).where(eq(s.letters.id,l.id));
        await db.update(s.reviewTasks).set({status:'superseded'}).where(and(eq(s.reviewTasks.letterId,l.id),eq(s.reviewTasks.status,'pending')));
      } else {
        const reviews=await db.select().from(s.letterReviews).where(and(eq(s.letterReviews.letterId,l.id),eq(s.letterReviews.revision,l.revision),eq(s.letterReviews.decision,'approve')));
        const m=await c.missionary(db,l.missionaryId); const required=m.governance==='invite_only' || content.visibility==='restricted' ? 2 : 1;
        if(new Set(reviews.map(r=>r.reviewerId)).size>=required) {
          if(!reviews.some(r=>r.consentConfirmed)) return fail(409,'consent_required');
          await db.update(s.letters).set({status:'approved',consentAt:c.now()}).where(eq(s.letters.id,l.id));
        }
      }
      return {id:l.id,revision:l.revision};
    });
  }
  async publish(token:string|undefined,id:string,expected:number,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'letter.publish',resourceId:id,requestId},{id,expected},async db=>{
      const l=await c.letter(db,id); await c.staff(db,token,'publish',l.missionaryId,true); c.conflict(l.revision,expected);
      const m=await c.missionary(db,l.missionaryId); const content=await c.snapshot(db,id,l.revision);
      if(!m.active || m.governance==='offline' || (m.governance==='invite_only' && content.visibility!=='restricted')) return fail(403,'policy_floor');
      if(l.status!=='approved' || !l.consentAt) return fail(409,'not_approved');
      const reviews=await db.select().from(s.letterReviews).where(and(eq(s.letterReviews.letterId,id),eq(s.letterReviews.revision,l.revision),eq(s.letterReviews.decision,'approve')));
      const revisions=await db.select().from(s.letterRevisions).where(eq(s.letterRevisions.letterId,id));
      if(reviews.some(r=>r.reviewerId===l.authorId || revisions.some(v=>v.editorId===r.reviewerId)) || new Set(reviews.map(r=>r.reviewerId)).size<(content.visibility==='restricted' || m.governance==='invite_only' ? 2 : 1) || !reviews.some(r=>r.consentConfirmed)) return fail(409,'not_approved');
      for(const review of reviews) {
        const [reviewer]=await db.select().from(s.admins).where(eq(s.admins.id,review.reviewerId));
        const assignments=await db.select().from(s.staffAssignments).where(eq(s.staffAssignments.adminId,review.reviewerId));
        if(!reviewer?.enabled || !staffCan(reviewer.id,assignments,'review',m.id,c.now())) return fail(409,'reviewer_authority_expired');
        const [linkedAuthor]=await db.select().from(w.memberSubmissions).innerJoin(w.adminUserLinks,eq(w.adminUserLinks.userId,w.memberSubmissions.userId)).where(and(eq(w.memberSubmissions.letterId,id),eq(w.adminUserLinks.adminId,review.reviewerId)));
        if(linkedAuthor) return fail(409,'self_approval');
      }
      if(content.assetIds.length) {
        const assets=await db.select().from(s.letterAssets).where(inArray(s.letterAssets.id,content.assetIds));
        if(!m.allowPhotos || assets.length!==content.assetIds.length || assets.some(a=>a.letterId!==id || !a.sanitizedAt || reviews.some(r=>!(r.mediaHashes as string[]).includes(a.contentHash)))) return fail(409,'unsafe_assets');
        await db.update(s.letterAssets).set({reviewedAt:c.now()}).where(inArray(s.letterAssets.id,content.assetIds));
      }
      await db.update(s.letters).set({status:'published',title:content.title,safeSummary:content.safeSummary,prayerPoints:content.prayerPoints,visibility:content.visibility,publishedAt:c.now(),archivedAt:null}).where(eq(s.letters.id,id));
      const subscriptions=await db.select().from(s.subscriptions).where(and(eq(s.subscriptions.missionaryId,l.missionaryId),eq(s.subscriptions.pushOptIn,true)));
      for(const sub of subscriptions) {
        const [recipient]=await db.insert(w.deliveryRecipients).values({letterId:id,userId:sub.userId}).onConflictDoNothing().returning();
        if(recipient) await db.insert(s.deliveryJobs).values({letterId:id,userId:sub.userId,revision:l.revision,idempotencyKey:randomUUID(),scheduledAt:c.now()});
      }
      return {id,revision:l.revision};
    });
  }
  async archive(token:string|undefined,id:string,expected:number,requestId:string,reasonCode:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'letter.archive',resourceId:id,requestId},{id,expected,reasonCode},async db=>{
      const l=await c.letter(db,id); await c.staff(db,token,'archive',l.missionaryId); c.conflict(l.revision,expected);
      if(!securityReasonInput.safeParse(reasonCode).success) return fail(400,'invalid_input');
      await db.update(s.letters).set({status:'archived',archivedAt:c.now()}).where(eq(s.letters.id,id));
      await db.update(s.deliveryJobs).set({status:'cancelled'}).where(and(eq(s.deliveryJobs.letterId,id),inArray(s.deliveryJobs.status,['pending','failed']))); return {id};
    });
  }
  async aiDraft(token:string|undefined,memberToken:string|undefined,id:string,expected:number,requestId:string) {
    const c=this.core; const actor=token ? (await c.auth.adminSession(token)).admin.id : (await c.auth.member(memberToken)).id;
    return c.operation({actorId:actor,action:'letter.ai_draft',resourceId:id,requestId},{id,expected},async db=>{
      const l=await c.letter(db,id);
      if(token) await c.staff(db,token,'draft_edit',l.missionaryId);
      else {
        const [assignment]=await db.select().from(w.submitterAssignments).innerJoin(w.memberSubmissions,eq(w.memberSubmissions.userId,w.submitterAssignments.userId)).where(and(eq(w.memberSubmissions.letterId,id),eq(w.submitterAssignments.userId,actor),eq(w.submitterAssignments.missionaryId,l.missionaryId),gt(w.submitterAssignments.expiresAt,c.now()),isNull(w.submitterAssignments.revokedAt)));
        if(!assignment) return fail(404,'not_found');
      }
      c.conflict(l.revision,expected);
      const [pause]=await db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'ai_import_disabled')); if(pause?.enabled) return fail(403,'ai_disabled');
      if(l.status!=='draft') return fail(409,'revision_frozen');
      const m=await c.missionary(db,l.missionaryId); const content=await c.snapshot(db,id,l.revision);
      const output=await draftSafely(content.raw,m.governance!=='public' || content.visibility==='restricted',this.ai,false);
      await db.update(s.letterDrafts).set({encryptedAiDraft:encryptAi(output,c.key)}).where(and(eq(s.letterDrafts.letterId,id),eq(s.letterDrafts.revision,l.revision)));
      return output;
    });
  }
}
function encryptAi(output:unknown,key:string) { return encryptSecret(JSON.stringify(output),key); }
