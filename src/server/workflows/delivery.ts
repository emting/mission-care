import { createHmac,timingSafeEqual,randomUUID } from 'node:crypto';
import { and,eq,gt,isNull,inArray,sql,lte } from 'drizzle-orm';
import { z } from 'zod';
import * as s from '../db/schema';
import * as w from '../db/workflow-schema';
import { WorkflowCore } from './core';
import { decryptSecret,hash } from '../security';
import { canViewLetter } from '../policy';
import { fail } from '../services';
import type { Database } from '../db';
import { rememberLineFriendship } from '../line-friendship';
export interface MessagingClient { send(subject:string,text:string,retryKey:string):Promise<'accepted'|'retryable'|'permanent'|'quota'> }
export class LineMessagingClient implements MessagingClient {
  constructor(private accessToken:string) {}
  async send(subject:string,text:string,retryKey:string) {
    if(!this.accessToken) return 'permanent' as const;
    try {
      const response=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${this.accessToken}`,'Content-Type':'application/json','X-Line-Retry-Key':retryKey},body:JSON.stringify({to:subject,messages:[{type:'text',text}]}),signal:AbortSignal.timeout(5000)});
      if(response.ok || response.status===409) return 'accepted';
      if(response.status===429) return 'quota'; return response.status>=500 ? 'retryable':'permanent';
    } catch { return 'retryable'; }
  }
}
export function secretMatches(received:string|null,expected:string) { if(!received || !expected) return false; return timingSafeEqual(Buffer.from(hash(received),'hex'),Buffer.from(hash(expected),'hex')); }
const webhookSchema=z.object({events:z.array(z.object({webhookEventId:z.string().min(1).max(200),type:z.string().max(40),timestamp:z.number().optional(),source:z.object({userId:z.string().min(1).max(200)}).passthrough()}).passthrough()).max(100)}).passthrough();
export class Delivery {
  constructor(public core:WorkflowCore,private client:MessagingClient,private subjectKey:string,private webhookSecret:string) {}
  async eligible(db:Database,job:typeof s.deliveryJobs.$inferSelect) {
    const c=this.core; const l=await c.letter(db,job.letterId); const m=await c.missionary(db,l.missionaryId);
    const [user]=await db.select().from(s.users).where(eq(s.users.id,job.userId));
    const [sub]=await db.select().from(s.subscriptions).where(and(eq(s.subscriptions.userId,job.userId),eq(s.subscriptions.missionaryId,m.id)));
    const [identity]=await db.select().from(s.lineIdentities).where(eq(s.lineIdentities.userId,job.userId));
    const grants=await db.select().from(s.accessGrants).where(eq(s.accessGrants.userId,job.userId));
    return user?.enabled && sub?.pushOptIn && identity?.friendEligible && !identity.blockedAt && identity.encryptedSub && job.revision===l.revision && canViewLetter(user.id,m,l,grants,c.now()) ? identity:null;
  }
  async dispatch() {
    const c=this.core;
    return c.db.transaction(async db=>{
      // Serializes network dispatch with visibility-reducing operations, including quota reservations.
      await db.execute(sql`select pg_advisory_xact_lock(hashtext('mc_dispatch_governance'))`);
      const [pause]=await db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'global_notification_pause'));
      if(pause?.enabled!==false) return {status:'paused',processed:0};
      const [setting]=await db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'monthly_notification_quota'));
      const quota=typeof setting?.value==='number' ? setting.value:0;
      const month=c.now().toISOString().slice(0,7);
      await db.insert(w.deliveryUsage).values({month}).onConflictDoNothing();
      const jobs=await db.select().from(s.deliveryJobs).where(and(eq(s.deliveryJobs.status,'pending'),lte(s.deliveryJobs.scheduledAt,c.now()))).orderBy(s.deliveryJobs.createdAt).limit(20);
      let processed=0;
      for(const job of jobs) {
        const identity=await this.eligible(db,job);
        if(!identity || job.attempts>=3) { await db.update(s.deliveryJobs).set({status:'cancelled',errorCode:'ineligible'}).where(eq(s.deliveryJobs.id,job.id)); continue; }
        const [usage]=await db.select().from(w.deliveryUsage).where(eq(w.deliveryUsage.month,month)); if(usage.reserved>=quota) return {status:'quota',processed};
        await db.update(w.deliveryUsage).set({reserved:usage.reserved+1}).where(eq(w.deliveryUsage.month,month));
        let result:Awaited<ReturnType<MessagingClient['send']>>;
        try { result=await this.client.send(decryptSecret(identity.encryptedSub!,this.subjectKey),'有新的關懷消息',job.idempotencyKey); } catch { result='retryable'; }
        const attempts=job.attempts+1; const retry=(result==='retryable' || result==='quota') && attempts<3;
        await db.update(s.deliveryJobs).set({attempts,status:result==='accepted'?'accepted':retry?'pending':'failed',sentAt:result==='accepted'?c.now():null,errorCode:result==='accepted'?null:result,scheduledAt:new Date(+c.now()+60000*attempts)}).where(eq(s.deliveryJobs.id,job.id));
        await c.audit(db,{actorId:job.id,action:'notification.dispatch',requestId:randomUUID(),resourceId:job.id},result); processed++;
      }
      return {status:'ready',processed};
    });
  }
  async retry(token:string|undefined,id:string,requestId:string) {
    const c=this.core; const {admin}=await c.auth.adminSession(token);
    return c.operation({actorId:admin.id,action:'notification.retry',requestId,resourceId:id},{id},async db=>{
      const [job]=await db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.id,id)); if(!job) return fail(404,'not_found');
      const letter=await c.letter(db,job.letterId); await c.staff(db,token,'assign',letter.missionaryId);
      if(!['failed','pending'].includes(job.status) || job.attempts>=3 || job.errorCode==='permanent' || !await this.eligible(db,job)) return fail(409,'not_retryable');
      await db.update(s.deliveryJobs).set({status:'pending',scheduledAt:c.now()}).where(eq(s.deliveryJobs.id,id)); return {queued:true};
    });
  }
  async webhook(raw:Buffer,signature:string|null) {
    if(!this.webhookSecret || !signature) return fail(401,'invalid_signature');
    const expected=createHmac('sha256',this.webhookSecret).update(raw).digest(); const actual=Buffer.from(signature,'base64');
    if(expected.length!==actual.length || !timingSafeEqual(expected,actual)) return fail(401,'invalid_signature');
    const parsed=webhookSchema.parse(JSON.parse(raw.toString()));
    for(const event of parsed.events) await this.core.db.transaction(async db=>{
      await db.execute(sql`select pg_advisory_xact_lock(hashtext('mc_dispatch_governance'))`);
      const [row]=await db.insert(s.webhookEvents).values({providerEventId:event.webhookEventId,eventType:event.type,payloadHash:hash(JSON.stringify(event)),processedAt:this.core.now()}).onConflictDoNothing().returning();
      if(!row) return;
      const follow=event.type==='follow'; const unfollow=event.type==='unfollow' || event.type==='block';
      if(follow || unfollow) {
        await rememberLineFriendship(db,hash(event.source.userId),follow,this.core.now());
        const identities=await db.update(s.lineIdentities).set({friendEligible:follow,blockedAt:follow?null:this.core.now()}).where(eq(s.lineIdentities.subHash,hash(event.source.userId))).returning();
        if(unfollow) for(const identity of identities) await db.update(s.deliveryJobs).set({status:'cancelled'}).where(and(eq(s.deliveryJobs.userId,identity.userId),inArray(s.deliveryJobs.status,['pending','failed'])));
      }
      await this.core.audit(db,{actorId:row.id,action:'webhook.process',requestId:randomUUID(),resourceId:row.id});
    });
    return {accepted:true};
  }
}
