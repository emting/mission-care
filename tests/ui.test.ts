import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture, type Fixture, s, eq, randomUUID } from "./workflow-fixture";
import { UiReads } from "../src/server/ui-reads";
import { devLogin } from "../src/server/dev-login";
import { adminNavigation } from "../src/ui/navigation";
let f: Fixture;
let ui: UiReads;
beforeAll(async () => {
  f = await fixture();
  ui = new UiReads(f.core);
});
afterAll(async () => {
  await f.pg.close();
});
it("member UI projections show only visible code names, safe content and the current member daily prayer state", async () => {
  await f.db
    .update(s.missionaries)
    .set({ generalRegion: "虛構泛化地區" })
    .where(eq(s.missionaries.id, f.a.id));
  const list = await ui.memberList(f.member);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: f.a.id, region: "虛構泛化地區" });
  await expect(ui.memberMissionary(f.member, f.b.id)).rejects.toMatchObject({
    status: 404,
  });
  const l = await f.published();
  const letter = await ui.memberLetter(f.member, l.id);
  expect(letter.prayed).toBe(false);
  expect(letter.stats.distinct_members).toBeNull();
  expect(letter).not.toHaveProperty("raw");
  expect(letter).not.toHaveProperty("userId");
  await f.members.pray(f.member, l.id, randomUUID());
  expect((await ui.memberLetter(f.member, l.id)).prayed).toBe(true);
  await f.editorial.archive(f.lead.token, l.id, l.revision, randomUUID(), 'other');
  await expect(ui.memberLetter(f.member, l.id)).rejects.toMatchObject({
    status: 404,
  });
});
it("member UI preserves independent following/push opt-in state and empty letter lists", async () => {
  expect((await ui.memberMissionary(f.member, f.a.id)).letters).toEqual([]);
  await f.members.subscribe(f.member, f.a.id, true, false, randomUUID());
  expect(await ui.memberMissionary(f.member, f.a.id)).toMatchObject({
    following: true,
    pushOptIn: false,
  });
  await f.members.subscribe(f.member, f.a.id, undefined, true, randomUUID());
  expect(await ui.memberMissionary(f.member, f.a.id)).toMatchObject({
    following: true,
    pushOptIn: true,
  });
});
it("admin UI original text is limited to scoped editors/reviewers and self-approval is explicitly identified", async () => {
  const l = await f.draft();
  expect((await ui.adminLetter(f.editor.token, l.id)).self).toBe(true);
  expect(
    (await ui.adminLetter(f.reviewer.token, l.id)).content.raw,
  ).toBeTruthy();
  expect((await ui.adminLetter(f.lead.token, l.id)).content).not.toHaveProperty(
    "raw",
  );
  await expect(ui.adminLetter(f.owner.token, l.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(ui.missionary(f.editor.token, f.b.id)).rejects.toMatchObject({
    status: 404,
  });
  const support = await f.staff(["support"], null);
  const identity = await ui.identity(support.token);
  expect(
    adminNavigation
      .filter((n) => identity.permissions.includes(n.permission))
      .map((n) => n.path),
  ).not.toContain("/admin/letters");
  await expect(
    f.core.scope(f.db, support.token, "letter_read"),
  ).rejects.toMatchObject({ status: 403 });
});
it("admin notification tabs paginate/filter server-side without recipient identities or message content", async () => {
  const l = await f.published();
  await f.db
    .insert(s.deliveryJobs)
    .values([
      {
        userId: f.user.id,
        letterId: l.id,
        revision: l.revision,
        idempotencyKey: randomUUID(),
        status: "failed",
        scheduledAt: f.clock.now,
      },
    ]);
  const sent = await ui.notifications(f.lead.token, "sent", 0);
  expect(sent.items.length).toBeGreaterThan(0);
  expect(sent.items.every((i) => i.status !== "pending")).toBe(true);
  expect(JSON.stringify(sent)).not.toContain("userId");
  expect(JSON.stringify(sent)).not.toContain("safeSummary");
  expect((await ui.notifications(f.lead.token, "pending", 999)).items).toEqual(
    [],
  );
  await expect(
    ui.notifications(f.editor.token, "pending", 0),
  ).rejects.toMatchObject({ status: 403 });
});
it("development mock login fails closed in production, without local mode, and for deleted members", async () => {
  for (const env of [
    { NODE_ENV: "production", MC_LOCAL_DB: "1", MC_DEV_LOGIN: "1" },
    { NODE_ENV: "development", MC_DEV_LOGIN: "1" },
    { NODE_ENV: "development", MC_LOCAL_DB: "1" },
  ] as NodeJS.ProcessEnv[])
    await expect(devLogin(f.auth, env)).rejects.toMatchObject({ status: 404 });
  const env = {
    NODE_ENV: "development" as const,
    MC_LOCAL_DB: "1",
    MC_DEV_LOGIN: "1",
  };
  await expect(devLogin(f.auth, env)).rejects.toMatchObject({ status: 404 });
  await f.db
    .insert(s.systemSettings)
    .values({
      key: "local_seed_member",
      enabled: true,
      value: { userId: f.user.id },
    });
  const token = await devLogin(f.auth, env);
  expect((await f.auth.member(token)).id).toBe(f.user.id);
  await f.members.privacy(token, randomUUID());
  await expect(devLogin(f.auth, env)).rejects.toMatchObject({ status: 403 });
});
