import { beforeEach, afterEach, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { fixture, type Fixture, s, eq, key, subjectKey, randomUUID } from './workflow-fixture';
import { Services } from '../src/server/services';
import { loginLiff } from '../src/server/liff-auth';

let f: Fixture;
beforeEach(async () => { f=await fixture(); });
afterEach(async () => { await f.pg.close(); });
async function webhook(subject:string,type:string,eventId=randomUUID()) {
  const raw=Buffer.from(JSON.stringify({events:[{webhookEventId:eventId,type,source:{userId:subject}}]}));
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
