import { eq } from "drizzle-orm";
import * as s from "./db/schema";
import { Services, fail } from "./services";
import { randomToken, hash } from "./security";
export async function devLogin(
  auth: Services,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (
    env.NODE_ENV !== "development" ||
    env.MC_LOCAL_DB !== "1" ||
    env.MC_DEV_LOGIN !== "1"
  )
    return fail(404, "not_found");
  const [setting] = await auth.db
    .select()
    .from(s.systemSettings)
    .where(eq(s.systemSettings.key, "local_seed_member"));
  const userId = (setting?.value as { userId?: string } | null)?.userId;
  if (!userId) return fail(404, "not_found");
  const [user] = await auth.db
    .select()
    .from(s.users)
    .where(eq(s.users.id, userId));
  if (!user?.enabled) return fail(403, "account_disabled");
  const token = randomToken();
  await auth.db
    .insert(s.sessions)
    .values({
      userId,
      tokenHash: hash(token),
      expiresAt: new Date(+auth.now() + 3600000),
    });
  return token;
}
