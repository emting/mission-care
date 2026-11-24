import {createHmac,randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import * as s from '../src/server/db/schema';
import {decryptSecret,randomToken} from '../src/server/security';
import {WorkflowCore,type Content} from '../src/server/workflows/core';
import {Editorial} from '../src/server/workflows/editorial';
import {Members} from '../src/server/workflows/members';
import {Delivery} from '../src/server/workflows/delivery';
import {Governance} from '../src/server/workflows/governance';

export type DemoActors=Record<'editor'|'reviewer'|'reviewer2'|'mission_lead'|'security_auditor'|'finance_link_manager',string>;

export async function populateDemoWork(core:WorkflowCore,member:string,actors:DemoActors,missionaryId:string,subjectKey:string) {
  const user=await core.auth.member(member);
  const editorial=new Editorial(core);const members=new Members(core);const governance=new Governance(core);
  const content:Content={title:'虛構展示：一起預備新的關懷季節',safeSummary:'完全虛構的展示近況：同工正在預備陪伴與關懷，邀請大家一起代禱。',prayerPoints:['為同工有智慧與合宜的休息代禱。'],raw:'完全虛構的展示草稿，沒有真實人物、地點或行程。',visibility:'restricted',assetIds:[]};
  const pending=await editorial.create(actors.editor,undefined,missionaryId,content,randomUUID());
  await editorial.submit(actors.editor,pending.id,pending.revision,randomUUID());
  await members.requestAccess(member,missionaryId,randomUUID());
  await governance.propose(actors.finance_link_manager,'donation.change',undefined,1,{url:'https://revival.eoffering.org.tw/'},randomUUID());

  const [identity]=await core.db.select().from(s.lineIdentities).where(eq(s.lineIdentities.userId,user.id));
  if(!identity?.encryptedSub) throw Error('Demo notification fixture requires a fictional identity');
  const webhookSecret=randomToken();
  // This client cannot send messages or access the network.
  const delivery=new Delivery(core,{async send(){return 'permanent';}},subjectKey,webhookSecret);
  const raw=Buffer.from(JSON.stringify({events:[{webhookEventId:randomUUID(),type:'follow',timestamp:+core.now(),source:{userId:decryptSecret(identity.encryptedSub,subjectKey)}}]}));
  await delivery.webhook(raw,createHmac('sha256',webhookSecret).update(raw).digest('base64'));
  await members.subscribe(member,missionaryId,true,true,randomUUID());
  async function publishNotificationExample(title:string) {
    const letter=await editorial.create(actors.editor,undefined,missionaryId,{...content,title},randomUUID());
    const submitted=await editorial.submit(actors.editor,letter.id,letter.revision,randomUUID());
    for(const [index,task] of submitted.tasks.entries())
      await editorial.decide(index===0?actors.reviewer:actors.reviewer2,task.id,submitted.revision,'approve',true,randomUUID());
    await editorial.publish(actors.mission_lead,letter.id,submitted.revision,randomUUID());
  }
  await publishNotificationExample('虛構展示：通知失敗的關懷近況');
  const [quota]=await core.db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'monthly_notification_quota'));
  try {
    // Quota configuration has no workflow setter; restore it before any page is captured.
    await core.db.update(s.systemSettings).set({value:100}).where(eq(s.systemSettings.key,'monthly_notification_quota'));
    await governance.resumeNotifications(actors.security_auditor,{reasonCode:'other',confirmed:true},randomUUID());
    await delivery.dispatch();
  } finally {
    await governance.lockdown(actors.security_auditor,{pauseNotifications:true,reasonCode:'delivery_failure'},randomUUID());
    await core.db.update(s.systemSettings).set({value:quota?.value??0}).where(eq(s.systemSettings.key,'monthly_notification_quota'));
  }
  await publishNotificationExample('虛構展示：等待通知的關懷近況');
}
