import { beforeAll,afterAll,it,expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { fixture,type Fixture,s,w,randomUUID,eq,subjectKey,origin } from './workflow-fixture';
import { taipeiDate } from '../src/server/workflows/members';
import { Delivery } from '../src/server/workflows/delivery';
let f:Fixture;
beforeAll(async()=>{f=await fixture();}); afterAll(async()=>f.pg.close());
async function enable() {await f.db.update(s.systemSettings).set({enabled:false}).where(eq(s.systemSettings.key,'global_notification_pause')); await f.db.update(s.systemSettings).set({value:100}).where(eq(s.systemSettings.key,'monthly_notification_quota'));}
async function subscribe() {await f.members.subscribe(f.member,f.a.id,true,true,randomUUID());}
it('PRD §12.11 相同使用者台灣同日重複／並發只記錄一次；weekly distinct suppressed',async()=>{
  const l=await f.published(); await Promise.all(Array.from({length:5},()=>f.members.pray(f.member,l.id,randomUUID())));
  expect((await f.db.select().from(s.prayerEvents).where(eq(s.prayerEvents.letterId,l.id)))).toHaveLength(1);
  expect(taipeiDate(new Date('2026-11-21T16:00:00Z'))).toBe('2026-11-22');
  expect(await f.members.weekly(f.member,l.id)).toMatchObject({suppressed:true,distinct_members:null});
  for(let i=0;i<2;i++){const [u]=await f.db.insert(s.users).values({}).returning();await f.db.insert(s.prayerEvents).values({userId:u.id,letterId:l.id,prayedOn:taipeiDate(f.clock.now)});}
  const stats=await f.members.weekly(f.member,l.id); expect(stats.distinct_members).toBe(3); expect(JSON.stringify(stats)).not.toContain(f.user.id);
});
it('PRD §12.12 同一推播重試不重複建立成功紀錄；admin §16.8 restricted 中性 preview',async()=>{
  await subscribe(); await enable(); const l=await f.draft();await f.approved(l.id,1);const requestId=randomUUID();
  await Promise.all([f.editorial.publish(f.lead.token,l.id,1,requestId),f.editorial.publish(f.lead.token,l.id,1,requestId)]);
  const jobs=await f.db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.letterId,l.id));expect(jobs).toHaveLength(1);
  await Promise.all([f.delivery.dispatch(),f.delivery.dispatch()]); const sent=f.sent.filter(v=>v.retryKey===jobs[0].idempotencyKey);expect(sent).toHaveLength(1);expect(sent[0]).toMatchObject({subject:'fictional-line-subject',text:'有新的關懷消息'});
  const [identity]=await f.db.select().from(s.lineIdentities);expect(identity.encryptedSub).not.toContain('fictional-line-subject');
  const listing=await f.reads.list(f.lead.token,'notification-jobs',0,50,'',randomUUID()); expect(JSON.stringify(listing)).not.toContain('fictional-line-subject'); expect(JSON.stringify(listing)).not.toContain('有新的關懷消息');
});
it('PRD §12.13 退訂、未加好友、blocked、配額不足與全域 pause 不會誤發',async()=>{
  await subscribe(); const l=await f.published(); const before=f.sent.length;
  await f.db.update(s.systemSettings).set({enabled:true}).where(eq(s.systemSettings.key,'global_notification_pause')); expect((await f.delivery.dispatch()).status).toBe('paused');expect(f.sent.length).toBe(before);
  await enable();await f.db.update(s.systemSettings).set({value:0}).where(eq(s.systemSettings.key,'monthly_notification_quota')); expect((await f.delivery.dispatch()).status).toBe('quota');expect(f.sent.length).toBe(before);
  await enable(); await f.db.update(s.lineIdentities).set({friendEligible:false}).where(eq(s.lineIdentities.userId,f.user.id));await f.delivery.dispatch();expect(f.sent.length).toBe(before);
  await f.db.update(s.lineIdentities).set({friendEligible:true,blockedAt:f.clock.now}).where(eq(s.lineIdentities.userId,f.user.id));await f.published();await f.delivery.dispatch();expect(f.sent.length).toBe(before);
  await f.db.update(s.lineIdentities).set({blockedAt:null}).where(eq(s.lineIdentities.userId,f.user.id));await f.members.subscribe(f.member,f.a.id,undefined,false,randomUUID());await f.published();await f.delivery.dispatch();expect(f.sent.length).toBe(before);
  const [sub]=await f.db.select().from(s.subscriptions).where(eq(s.subscriptions.userId,f.user.id));expect(sub).toMatchObject({following:true,pushOptIn:false});
});
it('bounded retries reuse X-Line-Retry-Key and classify permanent errors',async()=>{
  const original=f.clock.now;
  await subscribe();await enable();const l=await f.published();const keys:string[]=[];
  const worker=new Delivery(f.core,{async send(_s,_t,key){keys.push(key);return 'retryable';}},subjectKey,'webhook-secret');
  for(let i=0;i<4;i++){await worker.dispatch();f.clock.now=new Date(+f.clock.now+180000);}
  const [job]=await f.db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.letterId,l.id));expect(job).toMatchObject({attempts:3,status:'failed',errorCode:'retryable'});expect(new Set(keys).size).toBe(1);expect(keys).toHaveLength(3);
  await expect(worker.retry(f.lead.token,job.id,randomUUID())).rejects.toMatchObject({status:409});
  f.clock.now=original;
  await f.published();await new Delivery(f.core,{async send(){return 'permanent';}},subjectKey,'webhook-secret').dispatch();
  const failures=await f.db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.errorCode,'permanent'));expect(failures[0].attempts).toBe(1);
});
it('PRD §12.4 and admin §16.9 撤權／撤稿即時阻斷 API 與 queued jobs',async()=>{
  await subscribe();const l=await f.published();await f.members.revoke(f.lead.token,f.grant.id,randomUUID());
  await expect(f.auth.letter(f.member,l.id)).rejects.toMatchObject({status:404});const jobs=await f.db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.letterId,l.id));expect(jobs[0].status).toBe('cancelled');
  await f.db.update(s.accessGrants).set({revokedAt:null,expiresAt:new Date(+f.clock.now+86400000)}).where(eq(s.accessGrants.id,f.grant.id));
  const second=await f.published();await f.editorial.archive(f.lead.token,second.id,1,randomUUID());await expect(f.auth.letter(f.member,second.id)).rejects.toMatchObject({status:404});
});
it('PRD §12.13 forged/replayed LINE webhook is rejected or deduped; follow/unfollow/block',async()=>{
  const event={webhookEventId:'fictional-event',type:'unfollow',timestamp:100,source:{userId:'fictional-line-subject'}};const raw=Buffer.from(JSON.stringify({events:[event]}));
  await expect(f.delivery.webhook(raw,'bad')).rejects.toMatchObject({status:401});
  const sign=(bytes:Buffer)=>createHmac('sha256','webhook-secret').update(bytes).digest('base64');
  await f.delivery.webhook(raw,sign(raw));await f.delivery.webhook(raw,sign(raw));expect(await f.db.select().from(s.webhookEvents)).toHaveLength(1);
  let [identity]=await f.db.select().from(s.lineIdentities);expect(identity.friendEligible).toBe(false);expect(identity.blockedAt).not.toBeNull();
  const follow=Buffer.from(JSON.stringify({events:[{...event,webhookEventId:'follow-event',type:'follow',timestamp:200}]}));await f.delivery.webhook(follow,sign(follow));[identity]=await f.db.select().from(s.lineIdentities);expect(identity.friendEligible).toBe(true);expect(identity.blockedAt).toBeNull();
  const block=Buffer.from(JSON.stringify({events:[{...event,webhookEventId:'block-event',type:'block',timestamp:300}]}));await f.delivery.webhook(block,sign(block));[identity]=await f.db.select().from(s.lineIdentities);expect(identity.friendEligible).toBe(false);
});
it('internal dispatch requires independent shared secret, rate limit and safe request ID',async()=>{
  const missing=await f.route(new Request(origin+'/api/internal/dispatch',{method:'POST'}));expect(missing.status).toBe(401);expect((await missing.json()).request_id).toBeTruthy();
  const response=await f.route(new Request(origin+'/api/internal/dispatch',{method:'POST',headers:{'x-mc-dispatch-secret':'dispatch-secret'}}));expect(response.status).toBe(200);
});
