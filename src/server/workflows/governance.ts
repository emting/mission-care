import { randomUUID } from 'node:crypto';
import { and,eq,inArray,sql } from 'drizzle-orm';
import type { Database } from '../db';
import * as s from '../db/schema';
import { WorkflowCore } from './core';
import { fail } from '../services';
import { hash } from '../security';
export function officialUrl(value:string,domains:string[]) {
  let u:URL; try { u=new URL(value); } catch { return fail(400,'invalid_official_url'); }
  if(u.protocol!=='https:' || u.username || u.password || u.port || !domains.includes(u.hostname) || u.hash) return fail(400,'invalid_official_url'); return u;
}
export type LockdownInput = {letterId?:string;grantId?:string;adminId?:string;pauseNotifications?:true;disableAi?:true;reasonCode:string};
export class Governance {
  constructor(public core:WorkflowCore,private domains=['revival.eoffering.org.tw']) {}
  async propose(token:string|undefined,action:'donation.change'|'letter.public',resourceId:string|undefined,expected:number,change:Record<string,unknown>,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'action.propose',requestId},{action,resourceId,expected,change},async db=>{
      let missionaryId:string|undefined;
      if(action==='donation.change') {
        await c.staff(db,token,'donation_request',null,true); officialUrl(String(change.url),this.domains);
      } else {
        if(!resourceId) return fail(400,'missing_resource'); const l=await c.letter(db,resourceId); missionaryId=l.missionaryId;
        await c.staff(db,token,'draft_edit',missionaryId,true); c.conflict(l.revision,expected);
        if(l.status!=='draft') return fail(409,'invalid_state');
        const m=await c.missionary(db,missionaryId); if(m.governance!=='public') return fail(403,'policy_floor');
        if(change.consent!==true) return fail(400,'consent_required');
      }
      const [r]=await db.insert(s.adminActionRequests).values({action,resourceId,missionaryId,requestedBy:admin.id,expectedRevision:expected,proposedChange:change,reasonCode:'requested',requestId,expiresAt:new Date(+c.now()+86400000)}).returning();
      return {id:r.id,status:r.status};
    });
  }
  async approve(token:string|undefined,id:string,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'action.approve',resourceId:id,requestId},{id},async db=>{
      const [r]=await db.select().from(s.adminActionRequests).where(eq(s.adminActionRequests.id,id)); if(!r) return fail(404,'not_found');
      if(r.requestedBy===admin.id) return fail(403,'self_approval');
      if(r.status!=='pending' || r.expiresAt<=c.now()) return fail(409,'invalid_state');
      const change=r.proposedChange as Record<string,unknown>;
      if(r.action==='donation.change') {
        await c.staff(db,token,'donation_approve',null,true); const url=officialUrl(String(change.url),this.domains);
        const current=await db.select().from(s.donationDestinations).where(eq(s.donationDestinations.enabled,true));
        c.conflict(Math.max(1,...current.map(d=>d.revision)),r.expectedRevision);
        await db.update(s.donationDestinations).set({enabled:false});
        await db.insert(s.donationDestinations).values({officialUrl:url.href,approvedDomain:url.hostname,requestedBy:r.requestedBy,approvedBy:admin.id,enabled:true,revision:r.expectedRevision+1});
        await db.insert(s.systemSettings).values({key:'donations',enabled:true}).onConflictDoUpdate({target:s.systemSettings.key,set:{enabled:true}});
      } else if(r.action==='letter.public' && r.resourceId) {
        await c.staff(db,token,'policy_approve',r.missionaryId,true);
        const l=await c.letter(db,r.resourceId); c.conflict(l.revision,r.expectedRevision); const m=await c.missionary(db,l.missionaryId);
        if(m.governance!=='public' || l.status!=='draft' || change.consent!==true) return fail(403,'policy_floor');
        const content={...await c.snapshot(db,l.id,l.revision),visibility:'public' as const}; const revision=l.revision+1;
        await db.insert(s.letterRevisions).values({letterId:l.id,revision,editorId:r.requestedBy,encryptedSnapshot:c.seal(content),contentHash:hash(JSON.stringify(content))});
        await db.insert(s.letterDrafts).values({letterId:l.id,revision,encryptedRaw:c.seal(content),deleteAfter:new Date(+c.now()+30*86400000)});
        await db.update(s.letters).set({visibility:'public',revision,status:'draft',consentAt:null}).where(eq(s.letters.id,l.id));
        await db.update(s.reviewTasks).set({status:'superseded'}).where(eq(s.reviewTasks.letterId,l.id));
      } else return fail(400,'unsupported_action');
      await db.update(s.adminActionRequests).set({approvedBy:admin.id,status:'executed',executedAt:c.now()}).where(eq(s.adminActionRequests.id,id)); return {executed:true};
    });
  }
  async cta() {
    const [flag]=await this.core.db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'donations')); if(!flag?.enabled) return null;
    const rows=await this.core.db.select().from(s.donationDestinations).where(eq(s.donationDestinations.enabled,true));
    const d=rows.find(v=>v.requestedBy && v.approvedBy && v.requestedBy!==v.approvedBy); if(!d) return null;
    try { return {url:officialUrl(d.officialUrl,this.domains).href,external:true}; } catch { return null; }
  }
  async lockdown(token:string|undefined,input:LockdownInput,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'security.lockdown',requestId},{...input},async db=>{
      await c.staff(db,token,'lockdown',null,true);
      if(input.pauseNotifications) await this.setting(db,'global_notification_pause',true);
      if(input.disableAi) await this.setting(db,'ai_import_disabled',true);
      if(input.letterId) {
        const l=await c.letter(db,input.letterId);
        await db.update(s.letters).set({status:'archived',archivedAt:c.now()}).where(eq(s.letters.id,l.id)); await c.cancelLetterJobs(db,l.id);
      }
      if(input.grantId) {
        const [g]=await db.update(s.accessGrants).set({revokedAt:c.now()}).where(eq(s.accessGrants.id,input.grantId)).returning(); if(g) await c.cancelJobs(db,g.missionaryId,g.userId);
      }
      if(input.adminId) await db.update(s.admins).set({sessionVersion:sql`${s.admins.sessionVersion}+1`}).where(eq(s.admins.id,input.adminId));
      const [incident]=await db.insert(s.securityIncidents).values({category:'emergency_lockdown',severity:'high',reasonCode:input.reasonCode,reportedBy:admin.id}).returning();
      await db.insert(s.adminAlerts).values({category:'post_incident_review',safeSummary:'緊急封鎖需要事後覆核'}); return {id:incident.id,status:'locked_down'};
    });
  }
  async setting(db:Database,key:string,enabled:boolean) { await db.insert(s.systemSettings).values({key,enabled}).onConflictDoUpdate({target:s.systemSettings.key,set:{enabled}}); }
  async incident(token:string|undefined,id:string|undefined,input:{missionaryId?:string;category:string;severity:string;reasonCode:string;status:'open'|'investigating'|'closed'},requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:id?'incident.update':'incident.create',resourceId:id,requestId},input,async db=>{
      let scope=input.missionaryId ?? null;
      if(id) { const [old]=await db.select().from(s.securityIncidents).where(eq(s.securityIncidents.id,id)); if(!old) return fail(404,'not_found'); scope=old.missionaryId; if(input.missionaryId && input.missionaryId!==scope) return fail(403,'scope_change_forbidden'); }
      await c.staff(db,token,'incident_read',scope);
      const values={...input,missionaryId:scope,closedAt:input.status==='closed'?c.now():null};
      const [r]=id ? await db.update(s.securityIncidents).set(values).where(eq(s.securityIncidents.id,id)).returning({id:s.securityIncidents.id}) : await db.insert(s.securityIncidents).values({...values,reportedBy:admin.id}).returning({id:s.securityIncidents.id}); return r;
    });
  }
}
