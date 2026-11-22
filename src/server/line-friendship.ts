import { eq, sql } from 'drizzle-orm';
import type { Database } from './db';
import { systemSettings } from './db/schema';

const key = (subHash:string) => 'line_friendship:'+subHash;

export async function lineFriendship(db:Database,subHash:string) {
  const [state]=await db.select().from(systemSettings).where(eq(systemSettings.key,key(subHash)));
  return {friendEligible:state?.enabled ?? false,blockedAt:state && !state.enabled ? state.updatedAt : null};
}

export async function rememberLineFriendship(db:Database,subHash:string,following:boolean,now:Date) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${subHash}))`);
  await db.insert(systemSettings).values({key:key(subHash),enabled:following,updatedAt:now}).onConflictDoUpdate({target:systemSettings.key,set:{enabled:following,updatedAt:now}});
}
