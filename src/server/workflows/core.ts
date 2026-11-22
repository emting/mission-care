import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db';
import * as s from '../db/schema';
import * as w from '../db/workflow-schema';
import { Services, fail } from '../services';
import { hash, encryptSecret, decryptSecret } from '../security';
import { recentMfa, staffCan, canViewLetter,canViewMissionary,type Permission } from '../policy';
export const revisionInput = z.object({request_id:z.uuid(),expected_revision:z.number().int().positive()}).strict();
export const contentInput = z.object({
  title:z.string().trim().min(1).max(200),safeSummary:z.string().max(5000),
  prayerPoints:z.array(z.string().max(2000)).max(20),raw:z.string().max(100000),
  visibility:z.enum(['public','restricted']).default('restricted'),assetIds:z.array(z.uuid()).max(10).default([]),
}).strict();
export type Content = z.infer<typeof contentInput>;
export type Context = {actorId:string;requestId:string;action:string;missionaryId?:string|null;resourceId?:string};
export class WorkflowCore {
  constructor(public auth: Services, public key: string) {}
  get db() { return this.auth.db; }
  now() { return this.auth.now(); }
  seal(content: Content) { return encryptSecret(JSON.stringify(content),this.key); }
  unseal(content: string) { return contentInput.parse(JSON.parse(decryptSecret(content,this.key))); }
  async audit(db: Database, c: Context, outcome = 'success') {
    if(!c.missionaryId && c.resourceId) {
      const [letter]=await db.select({id:s.letters.missionaryId}).from(s.letters).where(eq(s.letters.id,c.resourceId));
      const [grant]=await db.select({id:s.accessGrants.missionaryId}).from(s.accessGrants).where(eq(s.accessGrants.id,c.resourceId));
      const [request]=await db.select({id:s.accessRequests.missionaryId}).from(s.accessRequests).where(eq(s.accessRequests.id,c.resourceId));
      c={...c,missionaryId:letter?.id??grant?.id??request?.id};
    }
    await db.insert(s.auditEvents).values({actorId:c.actorId,actorType:'internal',action:c.action,requestId:c.requestId,missionaryId:c.missionaryId,resourceId:c.resourceId,outcome});
  }
  async operation<T>(c: Context, input: unknown, work: (db: Database)=>Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mc_dispatch_governance'))`);
      const inputHash=hash(JSON.stringify({resourceId:c.resourceId,input}));
      const [old]=await tx.select().from(w.operations).where(eq(w.operations.requestId,c.requestId));
      if(old) {
        if(old.actorId!==c.actorId || old.action!==c.action || old.inputHash!==inputHash) return fail(409,'request_conflict');
        await this.authorizeReplay(tx,c,input);
        return old.result as T;
      }
      const result=await work(tx);
      await tx.insert(w.operations).values({requestId:c.requestId,actorId:c.actorId,action:c.action,inputHash,result});
      await this.audit(tx,c); return result;
    });
  }
  private async authorizeReplay(db:Database,c:Context,input:unknown) {
    const data=input as Record<string,unknown>;
    let resourceId=c.resourceId ?? (typeof data.resourceId==='string'?data.resourceId:undefined);
    let missionaryId=c.missionaryId ?? null;
    let permission:Permission|undefined=({
      'letter.create':'draft_edit','letter.edit':'draft_edit','letter.submit':'submit_review','review.decision':'review',
      'letter.publish':'publish','letter.archive':'archive','letter.ai_draft':'draft_edit','media.upload':'draft_edit',
      'access.decision':'access_decide','access.revoke':'access_decide','notification.retry':'assign',
      'security.lockdown':'lockdown','incident.create':'incident_read','incident.update':'incident_read',
    } as Record<string,Permission>)[c.action];
    if(c.action==='action.propose') permission=data.action==='donation.change'?'donation_request':'draft_edit';
    if(c.action==='action.approve' && resourceId) {
      const [r]=await db.select().from(s.adminActionRequests).where(eq(s.adminActionRequests.id,resourceId));
      if(!r) return fail(404,'not_found'); permission=r.action==='donation.change'?'donation_approve':'policy_approve'; missionaryId=r.missionaryId; resourceId=undefined;
    }
    if(resourceId) {
      const [task]=await db.select().from(s.reviewTasks).where(eq(s.reviewTasks.id,resourceId));
      const [job]=await db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.id,resourceId));
      const [letter]=await db.select().from(s.letters).where(eq(s.letters.id,task?.letterId??job?.letterId??resourceId));
      const [grant]=await db.select().from(s.accessGrants).where(eq(s.accessGrants.id,resourceId));
      const [request]=await db.select().from(s.accessRequests).where(eq(s.accessRequests.id,resourceId));
      const [incident]=await db.select().from(s.securityIncidents).where(eq(s.securityIncidents.id,resourceId));
      missionaryId=letter?.missionaryId??grant?.missionaryId??request?.missionaryId??incident?.missionaryId??missionaryId;
    }
    if(!missionaryId && typeof data.missionaryId==='string') missionaryId=data.missionaryId;
    const [admin]=await db.select().from(s.admins).where(eq(s.admins.id,c.actorId));
    if(admin && permission) {
      const assignments=await db.select().from(s.staffAssignments).where(eq(s.staffAssignments.adminId,admin.id));
      if(!admin.enabled || !staffCan(admin.id,assignments,permission,missionaryId,this.now())) return fail(missionaryId?404:403,missionaryId?'not_found':'forbidden'); return;
    }
    const [user]=await db.select().from(s.users).where(eq(s.users.id,c.actorId)); if(!user?.enabled) return fail(401,'unauthenticated');
    if(['letter.create','letter.ai_draft'].includes(c.action)) {
      const [assignment]=await db.select().from(w.submitterAssignments).where(and(eq(w.submitterAssignments.userId,user.id),eq(w.submitterAssignments.missionaryId,missionaryId!)));
      if(!assignment || assignment.revokedAt || assignment.expiresAt<=this.now()) return fail(404,'not_found');
    } else if(c.action==='prayer.record' || c.action==='subscription.update') {
      const m=await this.missionary(db,missionaryId!); const grants=await db.select().from(s.accessGrants).where(eq(s.accessGrants.userId,user.id));
      const visible=c.action==='prayer.record'?canViewLetter(user.id,m,await this.letter(db,c.resourceId!),grants,this.now()):canViewMissionary(user.id,m,grants,this.now());
      if(!visible) return fail(404,'not_found');
    }
  }
  async staff(db: Database, token: string|undefined, permission: Permission, missionaryId: string|null, recent = false) {
    const svc=new Services(db,async()=>null,'','',this.auth.now);
    const r=await svc.staff(token,permission,missionaryId);
    if(recent && !recentMfa(r.session.mfaVerifiedAt,this.now())) return fail(403,'recent_mfa_required'); return r;
  }
  async letter(db: Database,id:string) { const [l]=await db.select().from(s.letters).where(eq(s.letters.id,id)); return l ?? fail(404,'not_found'); }
  async missionary(db: Database,id:string) { const [m]=await db.select().from(s.missionaries).where(eq(s.missionaries.id,id)); return m ?? fail(404,'not_found'); }
  async snapshot(db: Database,id:string,revision:number) {
    const [r]=await db.select().from(s.letterRevisions).where(and(eq(s.letterRevisions.letterId,id),eq(s.letterRevisions.revision,revision)));
    return r ? this.unseal(r.encryptedSnapshot) : fail(409,'missing_revision');
  }
  async scope(db: Database, token:string|undefined, permission: Permission) {
    const svc=new Services(db,async()=>null,'','',this.auth.now); const {admin}=await svc.adminSession(token);
    const assignments=await db.select().from(s.staffAssignments).where(eq(s.staffAssignments.adminId,admin.id));
    const rows=await db.select({id:s.missionaries.id}).from(s.missionaries);
    const ids=rows.filter(m=>staffCan(admin.id,assignments,permission,m.id,this.now())).map(m=>m.id);
    const global=staffCan(admin.id,assignments,permission,null,this.now());
    if (!ids.length && !global) return fail(403,'forbidden'); return {ids,global,admin};
  }
  conflict(actual:number,expected:number) { if(actual!==expected) fail(409,'revision_conflict'); }
  async cancelJobs(db: Database, missionaryId:string, userId?:string) {
    const ids=await db.select({id:s.letters.id}).from(s.letters).where(eq(s.letters.missionaryId,missionaryId));
    for(const l of ids) await db.update(s.deliveryJobs).set({status:'cancelled'}).where(and(eq(s.deliveryJobs.letterId,l.id),sql`${s.deliveryJobs.status} IN ('pending','failed')`,userId ? eq(s.deliveryJobs.userId,userId):undefined));
  }
  async cancelLetterJobs(db:Database,letterId:string) { await db.update(s.deliveryJobs).set({status:'cancelled'}).where(and(eq(s.deliveryJobs.letterId,letterId),sql`${s.deliveryJobs.status} IN ('pending','failed')`)); }
}
