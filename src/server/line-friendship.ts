import { eq, sql } from 'drizzle-orm';
import type { Database } from './db';
import { systemSettings } from './db/schema';

const key = (subHash:string) => 'line_friendship:'+subHash;
const identityKey = (identityId:string) => 'line_friendship_identity:'+identityId;
const eventTimestamp = (value:unknown) => value && typeof value==='object' && 'timestamp' in value &&
  typeof value.timestamp==='number' && Number.isSafeInteger(value.timestamp) && value.timestamp>=0 ? value.timestamp : null;

export async function lineFriendship(db:Database,subHash:string) {
  const [state]=await db.select().from(systemSettings).where(eq(systemSettings.key,key(subHash)));
  return {friendEligible:state?.enabled ?? false,blockedAt:state && !state.enabled ? state.updatedAt : null,timestamp:eventTimestamp(state?.value)};
}

async function remember(db:Database,stateKey:string,following:boolean,timestamp:number,now:Date) {
  const [state]=await db.select().from(systemSettings).where(eq(systemSettings.key,stateKey));
  const previous=eventTimestamp(state?.value);
  if(previous!==null && timestamp<=previous) return false;
  await db.insert(systemSettings).values({key:stateKey,enabled:following,value:{timestamp},updatedAt:now}).onConflictDoUpdate({target:systemSettings.key,set:{enabled:following,value:{timestamp},updatedAt:now}});
  return true;
}

export async function rememberLineFriendship(db:Database,subHash:string,following:boolean,timestamp:number,now:Date) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${subHash}))`);
  return remember(db,key(subHash),following,timestamp,now);
}

export async function rememberIdentityFriendship(db:Database,identityId:string,following:boolean,timestamp:number|null,now:Date) {
  if(timestamp===null) return false;
  return remember(db,identityKey(identityId),following,timestamp,now);
}
