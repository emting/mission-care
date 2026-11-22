import { and,eq,inArray,isNull,or,sql,desc,count } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import * as s from '../db/schema';
import { WorkflowCore } from './core';
import { ApiError,fail } from '../services';
import type { Permission } from '../policy';
import { hash } from '../security';
import { notificationRecipientEligible } from './delivery';
export type ReadKind='tasks'|'missionaries'|'letters'|'access-requests'|'audit'|'notification-jobs'|'incidents';
export const pageInput={limit:50,maxOffset:10000};
export class AdminReads {
  constructor(public core:WorkflowCore) {}
  async list(token:string|undefined,kind:ReadKind,offset:number,limit:number,search:string,requestId:string,overview=false) {
    const c=this.core;
    const permission:Permission=kind==='audit'?'audit':kind==='incidents'?'incident_read':kind==='access-requests'?'access_decide':kind==='notification-jobs'?'assign':kind==='missionaries'?'missionary_read':'letter_read';
    const scope=await c.scope(c.db,token,permission);
    const ids=scope.ids.length?scope.ids:['00000000-0000-0000-0000-000000000000'];
    const missionaryFilter=(column:AnyPgColumn)=>scope.global ? undefined:inArray(column,ids);
    let items:unknown[]=[]; let total=0;
    if(kind==='missionaries') {
      const where=and(missionaryFilter(s.missionaries.id),search?sql`${s.missionaries.code} ILIKE ${'%'+search+'%'}`:undefined);
      items=await c.db.select({id:s.missionaries.id,code:s.missionaries.code,governance:s.missionaries.governance,active:s.missionaries.active}).from(s.missionaries).where(where).orderBy(s.missionaries.id).limit(limit).offset(offset);
      [{total}]=await c.db.select({total:count()}).from(s.missionaries).where(where);
    } else if(kind==='letters') {
      const where=and(missionaryFilter(s.letters.missionaryId),search?sql`${s.letters.title} ILIKE ${'%'+search+'%'}`:undefined);
      items=await c.db.select({id:s.letters.id,missionaryId:s.letters.missionaryId,status:s.letters.status,revision:s.letters.revision,title:s.letters.title}).from(s.letters).where(where).orderBy(s.letters.id).limit(limit).offset(offset);
      [{total}]=await c.db.select({total:count()}).from(s.letters).where(where);
    } else if(kind==='tasks') {
      const where=and(missionaryFilter(s.letters.missionaryId),search?sql`${s.letters.title} ILIKE ${'%'+search+'%'}`:undefined,eq(s.reviewTasks.status,'pending'),eq(s.reviewTasks.revision,s.letters.revision));
      items=await c.db.select({id:s.reviewTasks.id,letterId:s.reviewTasks.letterId,revision:s.reviewTasks.revision,status:s.reviewTasks.status,dueAt:s.reviewTasks.dueAt}).from(s.reviewTasks).innerJoin(s.letters,eq(s.letters.id,s.reviewTasks.letterId)).where(where).orderBy(s.reviewTasks.id).limit(limit).offset(offset);
      [{total}]=await c.db.select({total:overview?sql<number>`count(distinct ${s.reviewTasks.letterId})::int`:count()}).from(s.reviewTasks).innerJoin(s.letters,eq(s.letters.id,s.reviewTasks.letterId)).where(where);
    } else if(kind==='access-requests') {
      const where=and(missionaryFilter(s.accessRequests.missionaryId),overview?eq(s.accessRequests.status,'pending'):undefined);
      const requests=await c.db.select({id:s.accessRequests.id,missionaryId:s.accessRequests.missionaryId,missionaryCode:s.missionaries.code,memberId:s.accessRequests.userId,status:s.accessRequests.status,createdAt:s.accessRequests.createdAt}).from(s.accessRequests).innerJoin(s.missionaries,eq(s.missionaries.id,s.accessRequests.missionaryId)).where(where).orderBy(s.accessRequests.id).limit(limit).offset(offset);
      items=requests.map(({memberId,...request})=>({...request,memberCode:`U-${hash(memberId).slice(0,12).toUpperCase()}`}));
      [{total}]=await c.db.select({total:count()}).from(s.accessRequests).where(where);
    } else if(kind==='notification-jobs') {
      const where=and(missionaryFilter(s.letters.missionaryId),overview?or(eq(s.deliveryJobs.status,'failed'),and(eq(s.deliveryJobs.status,'pending'),sql`${s.deliveryJobs.scheduledAt} < ${new Date(+c.now()-3600000)}`)):undefined);
      items=await c.db.select({id:s.deliveryJobs.id,letterId:s.deliveryJobs.letterId,status:s.deliveryJobs.status,attempts:s.deliveryJobs.attempts,errorCode:s.deliveryJobs.errorCode}).from(s.deliveryJobs).innerJoin(s.letters,eq(s.letters.id,s.deliveryJobs.letterId)).where(where).orderBy(s.deliveryJobs.id).limit(limit).offset(offset);
      items=await Promise.all((items as {id:string}[]).map(async job=>({...job,retryEligible:await notificationRecipientEligible(c,job.id)})));
      [{total}]=await c.db.select({total:count()}).from(s.deliveryJobs).innerJoin(s.letters,eq(s.letters.id,s.deliveryJobs.letterId)).where(where);
    } else if(kind==='incidents') {
      const where=and(missionaryFilter(s.securityIncidents.missionaryId),overview?sql`${s.securityIncidents.status} <> 'closed'`:undefined);
      items=await c.db.select().from(s.securityIncidents).where(where).orderBy(s.securityIncidents.id).limit(limit).offset(offset);
      [{total}]=await c.db.select({total:count()}).from(s.securityIncidents).where(where);
    } else {
      const where=missionaryFilter(s.auditEvents.missionaryId);
      const events=await c.db.select({id:s.auditEvents.id,action:s.auditEvents.action,outcome:s.auditEvents.outcome,missionaryId:s.auditEvents.missionaryId,resourceId:s.auditEvents.resourceId,reasonCode:s.auditEvents.reasonCode,requestId:s.auditEvents.requestId,createdAt:s.auditEvents.createdAt,staffEmail:s.admins.email,memberId:s.users.id,actorType:s.auditEvents.actorType,missionaryCode:s.missionaries.code,letterId:s.letters.id}).from(s.auditEvents).leftJoin(s.admins,eq(s.admins.id,s.auditEvents.actorId)).leftJoin(s.users,eq(s.users.id,s.auditEvents.actorId)).leftJoin(s.missionaries,eq(s.missionaries.id,s.auditEvents.missionaryId)).leftJoin(s.letters,eq(s.letters.id,s.auditEvents.resourceId)).where(where).orderBy(desc(s.auditEvents.createdAt),s.auditEvents.id).limit(limit).offset(offset);
      items=events.map(({staffEmail,memberId,actorType,missionaryCode,letterId,...event})=>({...event,actorLabel:staffEmail??(memberId?`U-${hash(memberId).slice(0,12).toUpperCase()}`:actorType==='request'?'未登入／無法辨識':'系統'),targetLabel:letterId?`${missionaryCode??'代禱信'} · L-${letterId.slice(0,8)}`:missionaryCode??(event.resourceId?'指定資料':'全域／系統'),targetHref:letterId?`/admin/letters/${letterId}`:event.missionaryId?`/admin/missionaries/${event.missionaryId}`:null}));
      [{total}]=await c.db.select({total:count()}).from(s.auditEvents).where(where);
    }
    await c.audit(c.db,{actorId:scope.admin.id,action:'admin.read.'+kind,requestId});
    return {items,count:total,next_offset:offset+items.length<total?offset+items.length:null};
  }
  async letter(token:string|undefined,id:string,requestId:string) {
    const c=this.core; await c.auth.adminSession(token); const l=await c.letter(c.db,id); const {admin}=await c.auth.staff(token,'letter_read',l.missionaryId);
    const content=await c.snapshot(c.db,id,l.revision); const {raw,...draft}=content;
    await c.audit(c.db,{actorId:admin.id,action:'admin.read.letter',resourceId:id,missionaryId:l.missionaryId,requestId});
    return {id:l.id,revision:l.revision,status:l.status,draft};
  }
  async overview(token:string|undefined,requestId:string) {
    const c=this.core; await c.scope(c.db,token,'overview');
    const source=async(kind:ReadKind)=>{
      try { const result=await this.list(token,kind,0,1,'',requestId,true); return {status:'available',count:result.count}; }
      catch(error) { if(error instanceof ApiError && error.status===403) return {status:'not_authorized'}; return {status:'unavailable'}; }
    };
    return {as_of:c.now().toISOString(),tasks:await source('tasks'),access_requests:await source('access-requests'),notification_jobs:await source('notification-jobs'),incidents:await source('incidents')};
  }
  async health(token:string|undefined,requestId:string) {
    const c=this.core; const {admin}=await c.auth.staff(token,'health');
    let database='available'; try { await c.db.execute(sql`select 1`); } catch { database='unavailable'; }
    if(database==='available') await c.audit(c.db,{actorId:admin.id,action:'admin.read.health',requestId}); return {database,as_of:c.now().toISOString()};
  }
}
