import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as s from '../src/server/db/schema';
import * as w from '../src/server/db/workflow-schema';
import { Services } from '../src/server/services';
import { hash,encryptSecret,MemoryRateLimiter } from '../src/server/security';
import { WorkflowCore,type Content } from '../src/server/workflows/core';
import { Editorial } from '../src/server/workflows/editorial';
import { Members } from '../src/server/workflows/members';
import { Delivery,type MessagingClient } from '../src/server/workflows/delivery';
import { Governance } from '../src/server/workflows/governance';
import { AdminReads } from '../src/server/workflows/reads';
import { Media } from '../src/server/workflows/media';
import { createWorkflowHandler } from '../src/server/workflow-http';
import { memberCookie,adminCookie } from '../src/server/http';
import type { Role } from '../src/server/policy';
export {s,w,randomUUID,eq};
export const key='ab'.repeat(32),subjectKey='cd'.repeat(32),origin='https://care.example';
export const content:Content={title:'Fictional letter',safeSummary:'A fictional safe summary',prayerPoints:['Peace'],raw:'Fictional original text',visibility:'restricted',assetIds:[]};
export async function fixture() {
  const pg=new PGlite(); const db=drizzle(pg,{schema:s}); await migrate(db,{migrationsFolder:'./drizzle'});
  const clock={now:new Date('2026-11-21T12:00:00Z')};
  const auth=new Services(db,async()=>null,'channel',key,()=>clock.now,subjectKey); const core=new WorkflowCore(auth,key);
  const [a,b]=await db.insert(s.missionaries).values([{code:'Fiction-A',active:true,allowPhotos:true},{code:'Fiction-B',active:true,allowPhotos:true}]).returning();
  async function staff(roles:Role[],scope:string|null=a.id) {
    const [admin]=await db.insert(s.admins).values({email:randomUUID()+'@example.test',passwordHash:'not-used',totpSecretEncrypted:encryptSecret('fictional',key),enabled:true}).returning();
    await db.insert(s.staffAssignments).values(roles.map(role=>({adminId:admin.id,role,missionaryId:scope,expiresAt:new Date(+clock.now+86400000)})));
    const token=randomUUID(); await db.insert(s.adminSessions).values({adminId:admin.id,tokenHash:hash(token),aal:'aal2',sessionVersion:0,mfaVerifiedAt:clock.now,expiresAt:new Date(+clock.now+86400000)}); return {id:admin.id,token};
  }
  const editor=await staff(['editor']); const reviewer=await staff(['reviewer']); const reviewer2=await staff(['reviewer']); const lead=await staff(['mission_lead','access_reviewer']);
  const owner=await staff(['church_owner'],null); const auditor=await staff(['security_auditor'],null); const finance=await staff(['finance_link_manager'],null); const finance2=await staff(['finance_link_manager'],null);
  const [user]=await db.insert(s.users).values({}).returning(); const member=randomUUID();
  await db.insert(s.sessions).values({userId:user.id,tokenHash:hash(member),expiresAt:new Date(+clock.now+86400000)});
  await db.insert(s.lineIdentities).values({userId:user.id,provider:'channel',subHash:hash('fictional-line-subject'),encryptedSub:encryptSecret('fictional-line-subject',subjectKey),friendEligible:true});
  const [grant]=await db.insert(s.accessGrants).values({userId:user.id,missionaryId:a.id,expiresAt:new Date(+clock.now+86400000)}).returning();
  const storage=new Map<string,Buffer>(); const media=new Media(core,{async put(bytes){const id=randomUUID();storage.set(id,bytes);return id;},async get(id){const bytes=storage.get(id);if(!bytes)throw Error('not_found');return bytes;}});
  const sent:{subject:string;text:string;retryKey:string}[]=[];
  const client:MessagingClient={async send(subject,text,retryKey){sent.push({subject,text,retryKey});return 'accepted';}};
  const editorial=new Editorial(core); const members=new Members(core,3); const delivery=new Delivery(core,client,subjectKey,'webhook-secret'); const governance=new Governance(core); const reads=new AdminReads(core);
  const deps={core,editorial,members,delivery,governance,reads,media};
  const route=createWorkflowHandler(()=>deps,origin,'dispatch-secret',new MemoryRateLimiter(1000));
  function request(path:string,body?:unknown,staffToken?:string,memberToken:string|undefined=member,method=body===undefined?'GET':'POST') {
    return new Request(origin+'/api/'+path,{method,headers:{origin,'content-type':'application/json','x-mc-csrf':'1',cookie:[staffToken?`${adminCookie}=${staffToken}`:'',memberToken?`${memberCookie}=${memberToken}`:''].filter(Boolean).join('; ')},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function draft(patch:Partial<Content>={}) {return editorial.create(editor.token,undefined,a.id,{...content,...patch},randomUUID());}
  async function approved(id:string,revision:number) {
    const submitted=await editorial.submit(editor.token,id,revision,randomUUID());
    await editorial.decide(reviewer.token,submitted.tasks[0].id,revision,'approve',true,randomUUID());
    await editorial.decide(reviewer2.token,submitted.tasks[1].id,revision,'approve',true,randomUUID()); return submitted;
  }
  async function published() {const l=await draft();await approved(l.id,l.revision);await editorial.publish(lead.token,l.id,l.revision,randomUUID());return l;}
  return {pg,db,clock,auth,...deps,a,b,editor,reviewer,reviewer2,lead,owner,auditor,finance,finance2,user,member,grant,staff,storage,sent,client,route,request,draft,approved,published};
}
export type Fixture=Awaited<ReturnType<typeof fixture>>;
