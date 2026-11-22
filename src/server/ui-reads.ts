import { and, eq, inArray, ne, count, desc } from "drizzle-orm";
import * as s from "./db/schema";
import * as w from "./db/workflow-schema";
import { WorkflowCore } from "./workflows/core";
import { Members, taipeiDate } from "./workflows/members";
import { fail } from "./services";
import { permissions, recentMfa, staffCan, type Permission } from "./policy";
import { decryptSecret, hash } from "./security";
import { aiOutput } from "./ai";
import { scanSensitive } from "./ai";
import type { AdminIdentity } from "../ui/navigation";
import { notificationRecipientEligible } from "./workflows/delivery";

export class UiReads {
  constructor(public core: WorkflowCore) {}
  async identity(token: string | undefined): Promise<AdminIdentity> {
    const c = this.core;
    const { admin, session } = await c.auth.adminSession(token);
    const assignments = (
      await c.db
        .select()
        .from(s.staffAssignments)
        .where(eq(s.staffAssignments.adminId, admin.id))
    ).filter((a) => !a.revokedAt && a.expiresAt > c.now());
    if (!assignments.length) return fail(403, "forbidden");
    const missions = await c.db
      .select({ id: s.missionaries.id, code: s.missionaries.code })
      .from(s.missionaries);
    return {
      id: admin.id,
      roles: assignments.map((a) => ({
        role: a.role,
        scope: a.missionaryId
          ? (missions.find((m) => m.id === a.missionaryId)?.code ?? "指定範圍")
          : "教會層級",
      })),
      permissions: [
        ...new Set(assignments.flatMap((a) => [...permissions[a.role]])),
      ].filter(permission=>permission!=="notification_resume" || staffCan(admin.id,assignments,permission,null,c.now())),
      environment: process.env.NODE_ENV === "production" ? "PROD" : "TEST",
      recentMfa: recentMfa(session.mfaVerifiedAt, c.now()),
    };
  }
  async memberList(token: string | undefined) {
    const visible = await this.core.auth.visibleMissionaries(token);
    const rows = await this.core.db
      .select({ id: s.missionaries.id, region: s.missionaries.generalRegion })
      .from(s.missionaries);
    return visible.map((m) => ({
      ...m,
      region: rows.find((r) => r.id === m.id)?.region ?? "未提供區域",
    }));
  }
  async memberMissionary(token: string | undefined, id: string) {
    const c = this.core;
    const user = await c.auth.member(token);
    const missionary = (await this.memberList(token)).find((m) => m.id === id);
    if (!missionary) return fail(404, "not_found");
    const [sub] = await c.db
      .select()
      .from(s.subscriptions)
      .where(
        and(
          eq(s.subscriptions.userId, user.id),
          eq(s.subscriptions.missionaryId, id),
        ),
      );
    return {
      ...missionary,
      following: sub?.following ?? false,
      pushOptIn: sub?.pushOptIn ?? false,
      letters: (await c.auth.visibleLetters(token)).filter(
        (l) => l.missionaryId === id,
      ),
    };
  }
  async memberLetter(token: string | undefined, id: string) {
    const c = this.core;
    const user = await c.auth.member(token);
    const letter = await c.auth.letter(token, id);
    const current = await c.letter(c.db, id);
    const content = await c.snapshot(c.db, id, current.revision);
    const [prayer] = await c.db
      .select({ id: s.prayerEvents.id })
      .from(s.prayerEvents)
      .where(
        and(
          eq(s.prayerEvents.userId, user.id),
          eq(s.prayerEvents.letterId, id),
          eq(s.prayerEvents.prayedOn, taipeiDate(c.now())),
        ),
      );
    const assets = content.assetIds.length
      ? await c.db
          .select({
            id: s.letterAssets.id,
            reviewedAt: s.letterAssets.reviewedAt,
          })
          .from(s.letterAssets)
          .where(
            and(
              eq(s.letterAssets.letterId, id),
              inArray(s.letterAssets.id, content.assetIds),
            ),
          )
      : [];
    const [missionary] = await c.db
      .select({
        code: s.missionaries.code,
        region: s.missionaries.generalRegion,
      })
      .from(s.missionaries)
      .where(eq(s.missionaries.id, letter.missionaryId));
    return {
      ...letter,
      ...missionary,
      prayed: !!prayer,
      prayedOn: taipeiDate(c.now()),
      assetIds: assets.filter((a) => a.reviewedAt).map((a) => a.id),
      stats: await new Members(
        c,
        Number(process.env.PRAYER_SUPPRESSION_THRESHOLD ?? 5),
      ).weekly(token, id),
    };
  }
  async adminLetter(token: string | undefined, id: string) {
    const c = this.core;
    const { admin } = await c.auth.adminSession(token);
    const letter = await c.letter(c.db, id);
    await c.auth.staff(token, "letter_read", letter.missionaryId);
    const assignments = await c.db
      .select()
      .from(s.staffAssignments)
      .where(eq(s.staffAssignments.adminId, admin.id));
    const can = (permission: Permission) =>
      staffCan(admin.id, assignments, permission, letter.missionaryId, c.now());
    const content = await c.snapshot(c.db, id, letter.revision);
    const { raw, ...safe } = content;
    const revisions = await c.db
      .select({ editorId: s.letterRevisions.editorId })
      .from(s.letterRevisions)
      .where(eq(s.letterRevisions.letterId, id));
    const [linked] = await c.db
      .select()
      .from(w.memberSubmissions)
      .innerJoin(
        w.adminUserLinks,
        eq(w.memberSubmissions.userId, w.adminUserLinks.userId),
      )
      .where(
        and(
          eq(w.memberSubmissions.letterId, id),
          eq(w.adminUserLinks.adminId, admin.id),
        ),
      );
    const reviews = await c.db
      .select({
        reviewerId: s.letterReviews.reviewerId,
        decision: s.letterReviews.decision,
        consentConfirmed: s.letterReviews.consentConfirmed,
        revision: s.letterReviews.revision,
      })
      .from(s.letterReviews)
      .where(eq(s.letterReviews.letterId, id));
    const tasks = await c.db
      .select({ id: s.reviewTasks.id, assigneeId: s.reviewTasks.assigneeId })
      .from(s.reviewTasks)
      .where(
        and(
          eq(s.reviewTasks.letterId, id),
          eq(s.reviewTasks.revision, letter.revision),
          eq(s.reviewTasks.status, "pending"),
        ),
      );
    const self =
      letter.authorId === admin.id ||
      revisions.some((r) => r.editorId === admin.id) ||
      !!linked;
    const reviewed = reviews.some(
      (r) => r.revision === letter.revision && r.reviewerId === admin.id,
    );
    const [draft] = await c.db
      .select({ encryptedAiDraft: s.letterDrafts.encryptedAiDraft })
      .from(s.letterDrafts)
      .where(
        and(
          eq(s.letterDrafts.letterId, id),
          eq(s.letterDrafts.revision, letter.revision),
        ),
      );
    const suggestion = draft?.encryptedAiDraft
      ? aiOutput.parse(JSON.parse(decryptSecret(draft.encryptedAiDraft, c.key)))
      : null;
    return {
      id,
      missionaryId: letter.missionaryId,
      revision: letter.revision,
      status: letter.status,
      consent: !!letter.consentAt,
      content: {
        ...safe,
        ...(can("draft_edit") || can("review") ? { raw } : {}),
      },
      suggestion,
      riskFlags: scanSensitive(raw),
      self,
      reviewed,
      taskId:
        tasks.find((t) => !t.assigneeId || t.assigneeId === admin.id)?.id ??
        null,
      canEdit: can("draft_edit"),
      canSubmit: can("submit_review"),
      canReview: can("review"),
      canPublish: can("publish"),
      canArchive: can("archive"),
      reviews: reviews.map(({ reviewerId, ...r }) => ({
        ...r,
        isCurrentReviewer: reviewerId === admin.id,
      })),
    };
  }
  async missionary(token: string | undefined, id: string) {
    await this.core.auth.staff(token, "missionary_read", id);
    const m = await this.core.missionary(this.core.db, id);
    return {
      id: m.id,
      code: m.code,
      generalRegion: m.generalRegion,
      overview: m.overview,
      governance: m.governance,
      active: m.active,
      allowPhotos: m.allowPhotos,
      consent: !!m.consentAt,
    };
  }
  async grants(token: string | undefined) {
    const c = this.core;
    const scope = await c.scope(c.db, token, "access_decide");
    const grants = await c.db
      .select({
        id: s.accessGrants.id,
        missionaryId: s.accessGrants.missionaryId,
        missionaryCode: s.missionaries.code,
        userId: s.accessGrants.userId,
        approvedBy: s.accessGrants.approvedBy,
        expiresAt: s.accessGrants.expiresAt,
        revokedAt: s.accessGrants.revokedAt,
      })
      .from(s.accessGrants)
      .innerJoin(s.missionaries, eq(s.missionaries.id, s.accessGrants.missionaryId))
      .where(
        scope.global
          ? undefined
          : inArray(s.accessGrants.missionaryId, scope.ids),
      )
      .limit(50);
    if (!grants.length) return [];
    const requests = await c.db.select({
      id: s.accessRequests.id, userId: s.accessRequests.userId,
      missionaryId: s.accessRequests.missionaryId, decidedBy: s.accessRequests.decidedBy,
    }).from(s.accessRequests).where(and(
      inArray(s.accessRequests.userId, grants.map(g => g.userId)),
      inArray(s.accessRequests.missionaryId, grants.map(g => g.missionaryId)),
      eq(s.accessRequests.status, "approved"),
    )).orderBy(desc(s.accessRequests.decidedAt), desc(s.accessRequests.id));
    return grants.map(({userId, approvedBy, ...grant}) => ({
      ...grant,
      memberCode: `U-${hash(userId).slice(0, 12).toUpperCase()}`,
      requestId: approvedBy ? requests.find(r => r.userId === userId &&
        r.missionaryId === grant.missionaryId && r.decidedBy === approvedBy)?.id ?? null : null,
    }));
  }
  async notifications(token: string | undefined, tab: string, offset: number) {
    const c = this.core;
    const scope = await c.scope(c.db, token, "assign");
    const where = and(
      scope.global ? undefined : inArray(s.letters.missionaryId, scope.ids),
      tab === "pending"
        ? eq(s.deliveryJobs.status, "pending")
        : ne(s.deliveryJobs.status, "pending"),
    );
    const items = await c.db
      .select({
        id: s.deliveryJobs.id,
        letterId: s.deliveryJobs.letterId,
        revision: s.deliveryJobs.revision,
        status: s.deliveryJobs.status,
        attempts: s.deliveryJobs.attempts,
        errorCode: s.deliveryJobs.errorCode,
        sentAt: s.deliveryJobs.sentAt,
      })
      .from(s.deliveryJobs)
      .innerJoin(s.letters, eq(s.deliveryJobs.letterId, s.letters.id))
      .where(where)
      .orderBy(s.deliveryJobs.id)
      .limit(20)
      .offset(offset);
    const [total] = await c.db
      .select({ count: count() })
      .from(s.deliveryJobs)
      .innerJoin(s.letters, eq(s.deliveryJobs.letterId, s.letters.id))
      .where(where);
    const retryItems=await Promise.all(items.map(async job=>({...job,retryEligible:await notificationRecipientEligible(c,job.id)})));
    return {
      items:retryItems,
      count: total.count,
      next_offset:
        offset + items.length < total.count ? offset + items.length : null,
    };
  }
  async donations(token: string | undefined) {
    const c = this.core;
    await c.auth.staff(token, "donation_request");
    const destinations = await c.db
      .select({
        url: s.donationDestinations.officialUrl,
        enabled: s.donationDestinations.enabled,
        revision: s.donationDestinations.revision,
      })
      .from(s.donationDestinations)
      .where(eq(s.donationDestinations.enabled, true));
    const requests = await c.db
      .select({
        id: s.adminActionRequests.id,
        requestedBy: s.adminActionRequests.requestedBy,
        status: s.adminActionRequests.status,
        change: s.adminActionRequests.proposedChange,
        expiresAt: s.adminActionRequests.expiresAt,
      })
      .from(s.adminActionRequests)
      .where(
        and(
          eq(s.adminActionRequests.action, "donation.change"),
          eq(s.adminActionRequests.status, "pending"),
        ),
      )
      .limit(50);
    const { admin } = await c.auth.adminSession(token);
    return {
      revision: Math.max(1, ...destinations.map((d) => d.revision)),
      destinations,
      requests: requests.map(({ requestedBy, ...r }) => ({
        ...r,
        self: requestedBy === admin.id,
        url: String((r.change as { url?: string }).url ?? ""),
        change: undefined,
      })),
    };
  }
}
