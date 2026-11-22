import { and, eq, gt, isNull } from 'drizzle-orm';
import { authenticator } from 'otplib';
import type { Database } from './db';
import * as s from './db/schema';
import { hash, randomToken, verifyPassword, decryptSecret } from './security';
import { lineSubject, type LineVerifier } from './line';
import { canViewLetter, canViewMissionary, staffCan, type Permission } from './policy';
export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
export const fail = (status: number, code: string): never => { throw new ApiError(status,code); };
export class Services {
  constructor(public db: Database, private verifier: LineVerifier, private channel: string, private encryptionKey: string, public now = () => new Date()) {}
  async challenge() { const nonce = randomToken(); await this.db.insert(s.loginChallenges).values({ nonceHash:hash(nonce),expiresAt:new Date(+this.now()+300_000) }); return nonce; }
  async loginLine(token: string, nonce: string) {
    const [challenge] = await this.db.update(s.loginChallenges).set({ consumedAt:this.now() }).where(and(eq(s.loginChallenges.nonceHash,hash(nonce)),isNull(s.loginChallenges.consumedAt),gt(s.loginChallenges.expiresAt,this.now()))).returning();
    if (!challenge) return fail(401,'invalid_identity');
    let sub: string; try { sub = await lineSubject(this.verifier,token,nonce,this.channel,this.now()); } catch { return fail(401,'invalid_identity'); }
    const subHash = hash(sub);
    const userId = await this.db.transaction(async tx => {
      await tx.execute((await import('drizzle-orm')).sql`select pg_advisory_xact_lock(hashtext(${subHash}))`);
      const [identity] = await tx.select().from(s.lineIdentities).where(and(eq(s.lineIdentities.provider,this.channel),eq(s.lineIdentities.subHash,subHash)));
      if (identity) return identity.userId;
      const [user] = await tx.insert(s.users).values({}).returning();
      await tx.insert(s.lineIdentities).values({ userId:user.id,provider:this.channel,subHash }); return user.id;
    });
    const [user] = await this.db.select().from(s.users).where(eq(s.users.id,userId));
    if (!user.enabled) return fail(403,'account_disabled');
    const session = randomToken(); await this.db.insert(s.sessions).values({ userId,tokenHash:hash(session),expiresAt:new Date(+this.now()+3600_000) }); return session;
  }
  async member(token: string|undefined) {
    if (!token) return fail(401,'unauthenticated');
    const [row] = await this.db.select({ user:s.users }).from(s.sessions).innerJoin(s.users,eq(s.users.id,s.sessions.userId)).where(and(eq(s.sessions.tokenHash,hash(token)),isNull(s.sessions.revokedAt),gt(s.sessions.expiresAt,this.now()),eq(s.users.enabled,true)));
    return row?.user ?? fail(401,'unauthenticated');
  }
  async logout(token: string) { await this.member(token); await this.db.update(s.sessions).set({revokedAt:this.now()}).where(eq(s.sessions.tokenHash,hash(token))); }
  async passwordLogin(email: string, password: string) {
    const [admin] = await this.db.select().from(s.admins).where(eq(s.admins.email,email.toLowerCase()));
    const dummy = '00000000000000000000000000000000:'+'00'.repeat(64);
    const valid = await verifyPassword(password,admin?.passwordHash ?? dummy);
    if (!admin?.enabled || !valid) return fail(401,'invalid_credentials');
    const token = randomToken(); await this.db.insert(s.adminSessions).values({adminId:admin.id,tokenHash:hash(token),sessionVersion:admin.sessionVersion,expiresAt:new Date(+this.now()+300_000)}); return token;
  }
  async adminSession(token: string|undefined, aal2 = true) {
    if (!token) return fail(401,'unauthenticated');
    const [r] = await this.db.select({admin:s.admins,session:s.adminSessions}).from(s.adminSessions).innerJoin(s.admins,eq(s.admins.id,s.adminSessions.adminId)).where(and(eq(s.adminSessions.tokenHash,hash(token)),isNull(s.adminSessions.revokedAt),gt(s.adminSessions.expiresAt,this.now()),eq(s.admins.enabled,true)));
    if (!r || r.admin.sessionVersion !== r.session.sessionVersion) return fail(401,'unauthenticated');
    if (aal2 && r.session.aal !== 'aal2') return fail(403,'mfa_required'); return r;
  }
  async mfa(token: string|undefined, code: string) {
    const {admin,session} = await this.adminSession(token,false);
    const step = Math.floor(+this.now()/30_000);
    const totp = authenticator.clone(); totp.options = { epoch:+this.now(),window:0 };
    if (!totp.check(code,decryptSecret(admin.totpSecretEncrypted,this.encryptionKey))) return fail(401,'invalid_mfa');
    const fresh = randomToken();
    await this.db.transaction(async tx => {
      const { sql } = await import('drizzle-orm');
      const [accepted] = await tx.update(s.admins).set({lastTotpStep:step}).where(and(eq(s.admins.id,admin.id),sql`(${s.admins.lastTotpStep} IS NULL OR ${s.admins.lastTotpStep} < ${step})`)).returning();
      if (!accepted) return fail(401,'replayed_mfa');
      await tx.update(s.adminSessions).set({revokedAt:this.now()}).where(eq(s.adminSessions.id,session.id));
      await tx.insert(s.adminSessions).values({adminId:admin.id,tokenHash:hash(fresh),sessionVersion:admin.sessionVersion,aal:'aal2',mfaVerifiedAt:this.now(),expiresAt:new Date(+this.now()+1800_000)});
    }); return fresh;
  }
  async staff(token: string|undefined, permission: Permission, missionaryId: string|null = null) {
    const r = await this.adminSession(token);
    const assignments = await this.db.select().from(s.staffAssignments).where(eq(s.staffAssignments.adminId,r.admin.id));
    if (!staffCan(r.admin.id,assignments,permission,missionaryId,this.now())) return fail(missionaryId ? 404 : 403,missionaryId ? 'not_found' : 'forbidden'); return r;
  }
  async invalidateAdmin(adminId: string, disable = false) {
    const { sql } = await import('drizzle-orm');
    await this.db.update(s.admins).set({sessionVersion:sql`${s.admins.sessionVersion} + 1`,...(disable ? {enabled:false} : {})}).where(eq(s.admins.id,adminId));
  }
  async visibleMissionaries(token: string|undefined) {
    const user = await this.member(token); const grants = await this.db.select().from(s.accessGrants).where(eq(s.accessGrants.userId,user.id));
    const rows = await this.db.select().from(s.missionaries).where(eq(s.missionaries.active,true));
    return rows.filter(m => canViewMissionary(user.id,m,grants,this.now())).map(m => ({id:m.id,code:m.code,overview:m.overview}));
  }
  async visibleLetters(token: string|undefined) {
    const user = await this.member(token); const grants = await this.db.select().from(s.accessGrants).where(eq(s.accessGrants.userId,user.id));
    const rows = await this.db.select({letter:s.letters,missionary:s.missionaries}).from(s.letters).innerJoin(s.missionaries,eq(s.missionaries.id,s.letters.missionaryId)).where(eq(s.letters.status,'published'));
    return rows.filter(r => canViewLetter(user.id,r.missionary,r.letter,grants,this.now())).map(({letter:l}) => ({id:l.id,missionaryId:l.missionaryId,title:l.title,safeSummary:l.safeSummary,prayerPoints:l.prayerPoints}));
  }
  async letter(token: string|undefined, id: string) { return (await this.visibleLetters(token)).find(l => l.id === id) ?? fail(404,'not_found'); }
}
