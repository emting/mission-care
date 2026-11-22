import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { Services, fail } from "./services";
import * as s from "./db/schema";
import { usedLiffTokens } from "./db/workflow-schema";
import { encryptSecret, hash, randomToken } from "./security";

export type LiffVerifier = (token: string, channel: string) => Promise<unknown>;
export const verifyLiff: LiffVerifier = async (token, channel) => {
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: token, client_id: channel }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Invalid identity");
  return response.json();
};
const claimsInput = z.object({
  iss: z.literal("https://access.line.me"),
  aud: z.string().min(1),
  sub: z.string().min(1),
  exp: z.number().int(),
  iat: z.number().int(),
});
export async function loginLiff(
  auth: Services,
  token: string,
  nonce: string,
  channel: string,
  key: string,
  verifier: LiffVerifier = verifyLiff,
) {
  const now = auth.now();
  const [challenge] = await auth.db
    .update(s.loginChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(s.loginChallenges.nonceHash, hash(nonce)),
        isNull(s.loginChallenges.consumedAt),
        gt(s.loginChallenges.expiresAt, now),
      ),
    )
    .returning();
  if (!challenge || !channel) return fail(401, "invalid_identity");
  let claims: z.infer<typeof claimsInput>;
  try {
    claims = claimsInput.parse(await verifier(token, channel));
    const seconds = +now / 1000;
    if (
      claims.aud !== channel ||
      claims.exp <= seconds ||
      claims.iat < seconds - 300 ||
      claims.iat > seconds + 30 ||
      claims.exp <= claims.iat
    )
      return fail(401, "invalid_identity");
  } catch {
    return fail(401, "invalid_identity");
  }
  return auth.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${hash(claims.sub)}))`,
    );
    await tx.delete(usedLiffTokens).where(lte(usedLiffTokens.expiresAt, now));
    const [used] = await tx
      .insert(usedLiffTokens)
      .values({
        tokenHash: hash(token),
        expiresAt: new Date(claims.exp * 1000),
      })
      .onConflictDoNothing()
      .returning();
    if (!used) return fail(401, "replayed_identity");
    const [identity] = await tx
      .select()
      .from(s.lineIdentities)
      .where(
        and(
          eq(s.lineIdentities.provider, channel),
          eq(s.lineIdentities.subHash, hash(claims.sub)),
        ),
      );
    let userId = identity?.userId;
    if (!userId) {
      const [user] = await tx.insert(s.users).values({}).returning();
      userId = user.id;
      await tx
        .insert(s.lineIdentities)
        .values({
          userId,
          provider: channel,
          subHash: hash(claims.sub),
          encryptedSub: encryptSecret(claims.sub, key),
        });
    } else {
      await tx
        .update(s.lineIdentities)
        .set({ encryptedSub: encryptSecret(claims.sub, key) })
        .where(eq(s.lineIdentities.id, identity.id));
    }
    const [user] = await tx
      .select()
      .from(s.users)
      .where(eq(s.users.id, userId));
    if (!user.enabled) return fail(403, "account_disabled");
    const session = randomToken();
    await tx
      .insert(s.sessions)
      .values({
        userId,
        tokenHash: hash(session),
        expiresAt: new Date(+now + 3600000),
      });
    return session;
  });
}
