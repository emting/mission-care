import { beforeEach, afterEach, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { fixture, type Fixture, s, eq, key, subjectKey, randomUUID } from './workflow-fixture';
import { Services } from '../src/server/services';
import { loginLiff } from '../src/server/liff-auth';
import { hash } from '../src/server/security';

let f: Fixture;
let eventClock:number;
beforeEach(async () => { f=await fixture();eventClock=+f.clock.now; });
afterEach(async () => { await f.pg.close(); });
async function webhook(subject:string,type:string,eventId=randomUUID(),timestamp=eventClock++) {
  const raw=Buffer.from(JSON.stringify({events:[{webhookEventId:eventId,type,timestamp,source:{userId:subject}}]}));
  await f.delivery.webhook(raw,createHmac('sha256','webhook-secret').update(raw).digest('base64'));
}
async function login(method:'nonce'|'liff',subject:string) {
  const claims={iss:'https://access.line.me',aud:'channel',sub:subject,iat:+f.clock.now/1000,exp:+f.clock.now/1000+600};
  const auth=new Services(f.db,async(_token,nonce)=>({...claims,nonce}),'channel',key,()=>f.clock.now,subjectKey);
  const nonce=await auth.challenge();
  return method==='nonce' ? auth.loginLine(randomUUID(),nonce) : loginLiff(auth,randomUUID(),nonce,'channel',subjectKey,async()=>claims);
}
it.each(['nonce','liff'] as const)('a pre-login follow enables opted-in dispatch after %s login',async(method)=>{
  const subject='fictional-prelogin-subject';
  await webhook(subject,'follow');
  const token=await login(method,subject);
  const user=await f.auth.member(token);
  const [identity]=await f.db.select().from(s.lineIdentities).where(eq(s.lineIdentities.userId,user.id));
  expect(identity.friendEligible).toBe(true);
  expect(identity.blockedAt).toBeNull();
  await f.db.insert(s.accessGrants).values({userId:user.id,missionaryId:f.a.id,expiresAt:new Date(+f.clock.now+3600000)});
  await f.members.subscribe(token,f.a.id,false,true,randomUUID());
  await f.db.update(s.systemSettings).set({enabled:false}).where(eq(s.systemSettings.key,'global_notification_pause'));
  await f.db.update(s.systemSettings).set({value:100}).where(eq(s.systemSettings.key,'monthly_notification_quota'));
  await f.published();
  expect((await f.delivery.dispatch()).processed).toBe(1);
  expect(f.sent).toEqual([expect.objectContaining({subject,text:'有新的關懷消息'})]);
});

it.each(['nonce','liff'] as const)('out-of-order events cannot overwrite newer pre-login or identity state after %s login',async(method)=>{
  const subject='fictional-out-of-order';
  await webhook(subject,'follow',randomUUID(),100);
  await webhook(subject,'unfollow',randomUUID(),300);
  await webhook(subject,'follow',randomUUID(),200);
  const user=await f.auth.member(await login(method,subject));
  const identity=async()=> (await f.db.select().from(s.lineIdentities).where(eq(s.lineIdentities.userId,user.id)))[0];
  expect((await identity()).friendEligible).toBe(false);
  const id=(await identity()).id;
  const timestamp=async(key:string)=>(await f.db.select().from(s.systemSettings).where(eq(s.systemSettings.key,key)))[0].value;
  expect(await timestamp('line_friendship:'+hash(subject))).toEqual({timestamp:300});
  expect(await timestamp('line_friendship_identity:'+id)).toEqual({timestamp:300});
  await webhook(subject,'follow',randomUUID(),400);
  await f.db.insert(s.accessGrants).values({userId:user.id,missionaryId:f.a.id,expiresAt:new Date(+f.clock.now+3600000)});
  await f.members.subscribe(await login(method,subject),f.a.id,false,true,randomUUID());
  const letter=await f.published();
  const jobs=async()=>f.db.select().from(s.deliveryJobs).where(eq(s.deliveryJobs.letterId,letter.id));
  expect(await jobs()).toEqual([expect.objectContaining({status:'pending',userId:user.id})]);
  await webhook(subject,'unfollow',randomUUID(),350);
  await webhook(subject,'block',randomUUID(),400);
  expect((await identity()).friendEligible).toBe(true);
  expect((await identity()).blockedAt).toBeNull();
  expect(await jobs()).toEqual([expect.objectContaining({status:'pending'})]);
  expect(await timestamp('line_friendship_identity:'+id)).toEqual({timestamp:400});
  await webhook(subject,'block',randomUUID(),500);
  await webhook(subject,'follow',randomUUID(),450);
  expect((await identity()).friendEligible).toBe(false);
  expect((await identity()).blockedAt).not.toBeNull();
  expect(await jobs()).toEqual([expect.objectContaining({status:'cancelled'})]);
  expect(await timestamp('line_friendship:'+hash(subject))).toEqual({timestamp:500});
  expect(await timestamp('line_friendship_identity:'+id)).toEqual({timestamp:500});
});

it('missing or invalid LINE event timestamps fail closed without processing friendship or deduplication state',async()=>{
  for(const timestamp of [undefined,-1,1.5,Number.MAX_SAFE_INTEGER+1,'123']) {
    const body={events:[{webhookEventId:randomUUID(),type:'follow',timestamp,source:{userId:'fictional-invalid-timestamp'}}]};
    const raw=Buffer.from(JSON.stringify(body));
    const request=f.request('line/webhook',body);
    request.headers.set('x-line-signature',createHmac('sha256','webhook-secret').update(raw).digest('base64'));
    expect((await f.route(request)).status).toBe(400);
  }
  expect(await f.db.select().from(s.webhookEvents)).toHaveLength(0);
});
it.each(['nonce','liff'] as const)('%s login remains fail-closed for no follow and pre-login unfollow/block',async(method)=>{
  for(const type of ['none','unfollow','block']) {
    const subject='fictional-'+type;
    if(type!=='none') {await webhook(subject,'follow');await webhook(subject,type);}
    const user=await f.auth.member(await login(method,subject));
    const [identity]=await f.db.select().from(s.lineIdentities).where(eq(s.lineIdentities.userId,user.id));
    expect(identity.friendEligible).toBe(false);
    expect(identity.blockedAt===null).toBe(type==='none');
  }
});

it.each(['nonce','liff'] as const)('%s login and a simultaneous follow converge without losing friendship',async(method)=>{
  const subject='fictional-concurrent';
  const [token]=await Promise.all([login(method,subject),webhook(subject,'follow')]);
  const user=await f.auth.member(token);
  const [identity]=await f.db.select().from(s.lineIdentities).where(eq(s.lineIdentities.userId,user.id));
  expect(identity.friendEligible).toBe(true);
  const eventId=randomUUID();
  await webhook(subject,'follow',eventId);
  await webhook(subject,'unfollow');
  await webhook(subject,'follow',eventId);
  await login(method,subject);
  const [blocked]=await f.db.select().from(s.lineIdentities).where(eq(s.lineIdentities.userId,user.id));
  expect(blocked.friendEligible).toBe(false);
  expect(blocked.blockedAt).not.toBeNull();
  const settings=await f.db.select().from(s.systemSettings);
  expect(JSON.stringify(settings)).not.toContain(subject);
});
