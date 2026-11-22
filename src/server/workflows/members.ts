import { and,eq,gt,isNull,inArray,sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { fail,Services } from '../services';
import { WorkflowCore } from './core';
import {canRevokeGrant} from '../policy';
export function taipeiDate(now:Date) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export class Members {
  constructor(public core:WorkflowCore,private suppression=5) { if(suppression<2 || !Number.isInteger(suppression)) throw new Error('Invalid suppression threshold'); }
  async pray(token:string|undefined,letterId:string,requestId:string) {
    const c=this.core; const user=await c.auth.member(token);
    return c.operation({actorId:user.id,action:'prayer.record',resourceId:letterId,requestId},{letterId},async db=>{
      const auth=new Services(db,async()=>null,'','',c.auth.now); await auth.letter(token,letterId);
      await db.insert(s.prayerEvents).values({userId:user.id,letterId,prayedOn:taipeiDate(c.now())}).onConflictDoNothing(); return {recorded:true};
    });
  }
  async weekly(token:string|undefined,letterId:string) {
    await this.core.auth.letter(token,letterId);
    const now=this.core.now(); const end=taipeiDate(now); const day=new Date(end+'T00:00:00Z'); const weekday=day.getUTCDay(); day.setUTCDate(day.getUTCDate()-(weekday+6)%7); const start=day.toISOString().slice(0,10);
    const [row]=await this.core.db.select({count:sql<number>`count(distinct ${s.prayerEvents.userId})::int`}).from(s.prayerEvents).where(and(eq(s.prayerEvents.letterId,letterId),sql`${s.prayerEvents.prayedOn} >= ${start}::date AND ${s.prayerEvents.prayedOn} <= ${end}::date`));
    return {week_start:start,as_of:now.toISOString(),distinct_members:row.count>=this.suppression ? row.count:null,suppressed:row.count<this.suppression};
  }
  async subscribe(token:string|undefined,missionaryId:string,following:boolean|undefined,pushOptIn:boolean|undefined,requestId:string) {
    const c=this.core; const user=await c.auth.member(token);
    return c.operation({actorId:user.id,action:'subscription.update',requestId,missionaryId},{missionaryId,following,pushOptIn},async db=>{
      const auth=new Services(db,async()=>null,'','',c.auth.now);
      if(!(await auth.visibleMissionaries(token)).some(m=>m.id===missionaryId)) return fail(404,'not_found');
      const patch={...(following===undefined?{}:{following}),...(pushOptIn===undefined?{}:{pushOptIn,pushConsentAt:pushOptIn?c.now():null})};
      const [subscription]=await db.insert(s.subscriptions).values({userId:user.id,missionaryId,...patch}).onConflictDoUpdate({target:[s.subscriptions.userId,s.subscriptions.missionaryId],set:patch}).returning({following:s.subscriptions.following,pushOptIn:s.subscriptions.pushOptIn});
      if(pushOptIn===false) await c.cancelJobs(db,missionaryId,user.id); return {updated:true,...subscription};
    });
  }
  async requestAccess(token:string|undefined,missionaryId:string,requestId:string) {
    const c=this.core; const user=await c.auth.member(token);
    // Opaque acceptance also covers nonexistent/offline targets.
    return c.operation({actorId:user.id,action:'access.request',requestId},{missionaryId},async db=>{
      const [m]=await db.select().from(s.missionaries).where(and(eq(s.missionaries.id,missionaryId),eq(s.missionaries.active,true)));
      if(m && m.governance!=='offline') {
        if(m.governance==='invite_only') {
          const [grant]=await db.select({id:s.accessGrants.id}).from(s.accessGrants).where(and(eq(s.accessGrants.userId,user.id),eq(s.accessGrants.missionaryId,missionaryId)));
          const [history]=await db.select({id:s.accessRequests.id}).from(s.accessRequests).where(and(eq(s.accessRequests.userId,user.id),eq(s.accessRequests.missionaryId,missionaryId)));
          if(!grant && !history) return {accepted:true};
        }
        const [old]=await db.select().from(s.accessRequests).where(and(eq(s.accessRequests.userId,user.id),eq(s.accessRequests.missionaryId,missionaryId),eq(s.accessRequests.status,'pending')));
        if(!old) await db.insert(s.accessRequests).values({userId:user.id,missionaryId});
      }
      return {accepted:true};
    });
  }
  async decideAccess(token:string|undefined,id:string,approve:boolean,expiresAt:Date,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'access.decision',resourceId:id,requestId},{id,approve,expiresAt},async db=>{
      const [r]=await db.select().from(s.accessRequests).where(eq(s.accessRequests.id,id)); if(!r) return fail(404,'not_found');
      await c.staff(db,token,'access_decide',r.missionaryId);
      if(r.status!=='pending') return fail(409,'invalid_state');
      if(approve && (expiresAt<=c.now() || +expiresAt>+c.now()+366*86400000)) return fail(400,'invalid_expiry');
      await db.update(s.accessRequests).set({status:approve?'approved':'rejected',decidedBy:admin.id,decidedAt:c.now()}).where(eq(s.accessRequests.id,id));
      if(approve) await db.insert(s.accessGrants).values({userId:r.userId,missionaryId:r.missionaryId,approvedBy:admin.id,expiresAt}).onConflictDoUpdate({target:[s.accessGrants.userId,s.accessGrants.missionaryId],set:{approvedBy:admin.id,expiresAt,revokedAt:null}});
      return {decided:true};
    });
  }
  async revoke(token:string|undefined,id:string,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'access.revoke',resourceId:id,requestId},{id},async db=>{
      const [g]=await db.select().from(s.accessGrants).where(eq(s.accessGrants.id,id)); if(!g) return fail(404,'not_found');
      await c.staff(db,token,'access_decide',g.missionaryId);
      if(!canRevokeGrant(g,c.now())) return fail(409,'grant_inactive');
      await db.update(s.accessGrants).set({revokedAt:c.now()}).where(eq(s.accessGrants.id,id)); await c.cancelJobs(db,g.missionaryId,g.userId); return {revoked:true};
    });
  }
  async privacy(token:string|undefined,requestId:string) {
    const c=this.core; const user=await c.auth.member(token);
    return c.operation({actorId:user.id,action:'privacy.delete_request',requestId},{},async db=>{
      const [request]=await db.insert(s.privacyRequests).values({userId:user.id,kind:'delete',deleteAfter:new Date(+c.now()+30*86400000)}).returning();
      await db.update(s.users).set({enabled:false,noticeAcceptedAt:null}).where(eq(s.users.id,user.id));
      await db.update(s.sessions).set({revokedAt:c.now()}).where(eq(s.sessions.userId,user.id));
      await db.update(s.subscriptions).set({following:false,pushOptIn:false,pushConsentAt:null}).where(eq(s.subscriptions.userId,user.id));
      await db.update(s.accessGrants).set({revokedAt:c.now()}).where(eq(s.accessGrants.userId,user.id));
      await db.update(s.deliveryJobs).set({status:'cancelled'}).where(and(eq(s.deliveryJobs.userId,user.id),inArray(s.deliveryJobs.status,['pending','failed'])));
      return {id:request.id,status:'pending',retention_review_due:request.deleteAfter};
    });
  }
}
