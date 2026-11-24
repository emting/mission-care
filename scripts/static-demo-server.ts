import {createServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {seedLocal} from '../src/server/db/seed';
import {localEnvironment} from '../src/server/db/local';
import * as schema from '../src/server/db/schema';
import type {Database} from '../src/server/db';
import {Services} from '../src/server/services';
import {devLogin} from '../src/server/dev-login';
import {eq,inArray} from 'drizzle-orm';
import {hash,randomToken} from '../src/server/security';
import {WorkflowCore} from '../src/server/workflows/core';
import {populateDemoWork,type DemoActors} from './static-demo-fixtures';

async function main() {
  if(!process.send) throw Error('Private demo worker requires IPC');
  Object.assign(process.env,{NODE_ENV:'development'});
  const log=console.log;console.log=()=>{};
  try {await seedLocal();} finally {console.log=log;}
  const {config,env}=await localEnvironment();Object.assign(process.env,env);
  const pg=new PGlite(resolve('.local-data/db'));const db=drizzle(pg,{schema});
  const auth=new Services(db,async()=>null,env.LINE_LOGIN_CHANNEL_ID,config.authKey,()=>new Date(),config.subjectKey);
  const member=await devLogin(auth,{...env,NODE_ENV:'development'});
  const fixtureSecrets:string[]=[];
  const actors={} as DemoActors;
  try {
    for(const role of ['editor','reviewer','reviewer2','mission_lead','security_auditor','finance_link_manager'] as const) {
      const [admin]=await db.select().from(schema.admins).where(eq(schema.admins.email,role+'@mission-care.test'));
      const token=randomToken();fixtureSecrets.push(token);actors[role]=token;
      await db.insert(schema.adminSessions).values({adminId:admin.id,tokenHash:hash(token),aal:'aal2',sessionVersion:admin.sessionVersion,mfaVerifiedAt:auth.now(),expiresAt:new Date(+auth.now()+600000)});
    }
    const [missionary]=await db.select().from(schema.missionaries).where(eq(schema.missionaries.code,'M-02'));
    await populateDemoWork(new WorkflowCore(auth,config.authKey),member,actors,missionary.id,config.subjectKey);
  } finally {
    await db.delete(schema.adminSessions).where(inArray(schema.adminSessions.tokenHash,fixtureSecrets.map(hash)));
  }
  // Only this private process gets the fixture DB; production auth guards stay unchanged.
  (globalThis as typeof globalThis&{missionCareDb?:Database}).missionCareDb=db;
  Object.assign(process.env,{NODE_ENV:'production'});
  const next=(await import('next')).default;
  const app=next({dev:false,dir:process.cwd()});await app.prepare();
  const server=createServer({key:await readFile('demo-key.pem'),cert:await readFile('demo-cert.pem')},app.getRequestHandler());
  server.listen(0,'127.0.0.1',()=>{
    const address=server.address();if(!address||typeof address==='string') throw Error('Missing demo port');
    const origin=`https://127.0.0.1:${address.port}`;process.env.APP_ORIGIN=origin;
    process.send!({origin,member,config,fixtureSecrets});
  });
  process.on('SIGTERM',()=>{server.close();void app.close().then(()=>pg.close()).finally(()=>process.exit(0));});
}
main().catch(()=>{process.send?.({error:'Private demo server failed'});process.exit(1);});
