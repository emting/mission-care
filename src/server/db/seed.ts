import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import sharp from "sharp";
import * as s from "./schema";
import { localEnvironment } from "./local";
import { hash, hashPassword, encryptSecret, randomToken } from "../security";
import { Services } from "../services";
import { WorkflowCore } from "../workflows/core";
import { Editorial } from "../workflows/editorial";
import { Media } from "../workflows/media";
import { Governance } from "../workflows/governance";
import { LocalPrivateStorage } from "../storage";
import { type Role } from "../policy";

export async function seedLocal() {
  const { config, env, dir } = await localEnvironment();
  Object.assign(process.env, env);
  const pg = new PGlite(resolve(dir, "db"));
  const db = drizzle(pg, { schema: s });
  try {
    await migrate(db, { migrationsFolder: resolve("drizzle") });
    const [seeded] = await db
      .select()
      .from(s.systemSettings)
      .where(eq(s.systemSettings.key, "local_seed_member"));
    if (!seeded) {
      await db.transaction(async (tx) => {
        const expiresAt = new Date(Date.now() + 300 * 86400000);
        const missions = await tx
          .insert(s.missionaries)
          .values([
            {
              code: "M-01",
              governance: "public",
              active: true,
              generalRegion: "亞太地區",
              overview: "在平凡的相遇中，陪伴社群一起成長。",
              allowPhotos: true,
            },
            {
              code: "M-02",
              governance: "invite_only",
              active: true,
              generalRegion: "跨文化地區",
              overview: "以傾聽與同行，回應日常中的需要。",
              allowPhotos: true,
            },
            {
              code: "M-03",
              governance: "invite_only",
              active: true,
              generalRegion: "泛化地區",
              overview: "安靜陪伴，持續關懷。",
            },
            { code: "M-04", governance: "offline", active: false },
          ])
          .returning();
        const staff: Record<string, { id: string; token: string }> = {};
        for (const name of Object.keys(config.totp)) {
          const role: Role =
            name === "reviewer2"
              ? "reviewer"
              : name === "finance2"
                ? "finance_link_manager"
                : (name as Role);
          const [admin] = await tx
            .insert(s.admins)
            .values({
              email: `${name}@mission-care.test`,
              enabled: true,
              passwordHash: await hashPassword(config.password),
              totpSecretEncrypted: encryptSecret(
                config.totp[name],
                config.authKey,
              ),
            })
            .returning();
          const global = [
            "church_owner",
            "security_auditor",
            "finance_link_manager",
            "support",
          ].includes(role);
          await tx
            .insert(s.staffAssignments)
            .values(
              (global ? [null] : missions.map((m) => m.id)).map(
                (missionaryId) => ({
                  adminId: admin.id,
                  role,
                  missionaryId,
                  expiresAt,
                }),
              ),
            );
          const token = randomToken();
          staff[name] = { id: admin.id, token };
          await tx
            .insert(s.adminSessions)
            .values({
              adminId: admin.id,
              tokenHash: hash(token),
              aal: "aal2",
              sessionVersion: 0,
              mfaVerifiedAt: new Date(),
              expiresAt,
            });
        }
        const [user, other] = await tx
          .insert(s.users)
          .values([
            { noticeAcceptedAt: new Date() },
            { noticeAcceptedAt: new Date() },
          ])
          .returning();
        await tx
          .insert(s.lineIdentities)
          .values({
            userId: user.id,
            provider: env.LINE_LOGIN_CHANNEL_ID,
            subHash: hash("fictional-local-member"),
            encryptedSub: encryptSecret(
              "fictional-local-member",
              config.subjectKey,
            ),
            friendEligible: false,
          });
        await tx
          .insert(s.accessGrants)
          .values({
            userId: user.id,
            missionaryId: missions[1].id,
            approvedBy: staff.access_reviewer.id,
            expiresAt,
          });
        await tx
          .insert(s.accessRequests)
          .values({ userId: other.id, missionaryId: missions[1].id });
        await tx
          .insert(s.subscriptions)
          .values({
            userId: user.id,
            missionaryId: missions[0].id,
            following: true,
            pushOptIn: false,
          });
        await tx
          .insert(s.subscriptions)
          .values({
            userId: other.id,
            missionaryId: missions[0].id,
            following: false,
            pushOptIn: true,
            pushConsentAt: new Date(),
          });
        const auth = new Services(
          tx,
          async () => null,
          env.LINE_LOGIN_CHANNEL_ID,
          config.authKey,
        );
        const core = new WorkflowCore(auth, config.authKey);
        const editorial = new Editorial(core);
        const media = new Media(
          core,
          new LocalPrivateStorage(env.PRIVATE_MEDIA_DIR),
        );
        const titles = [
          "讓盼望在日常扎根",
          "在傾聽中，一起同行",
          "新的季節，繼續陪伴",
          "為日常的服事預備",
          "守望彼此的需要",
          "一段已完成的同行",
        ];
        for (let index = 0; index < titles.length; index++) {
          const missionaryId = missions[index === 3 ? 2 : index % 2].id;
          const content = {
            title: titles[index],
            safeSummary:
              "謝謝每一份安靜的關懷。這段時間，我們透過生活中的陪伴，慢慢建立信任，也在彼此的分享中看見盼望。願我們保持謙卑與耐心，珍惜每一次相遇。",
            prayerPoints: [
              "求主賜下傾聽的耐心與智慧。",
              "願同工在忙碌中有合宜的休息。",
              "為社群中的連結與彼此信任感恩。",
            ],
            raw: "【虛構投稿・僅供測試】\n這是一份完全虛構的原始稿。透過日常的分享與陪伴，同工持續學習彼此信任。沒有真實姓名、地點或行程資訊。",
            visibility:
              index % 2 === 0 ? ("public" as const) : ("restricted" as const),
            assetIds: [] as string[],
          };
          if (index === 3) content.visibility = "restricted";
          const publicRequested = content.visibility === "public";
          content.visibility = "restricted";
          const letter = await editorial.create(
            staff.editor.token,
            undefined,
            missionaryId,
            content,
            randomUUID(),
          );
          let revision = letter.revision;
          if (index === 0) {
            const image = await sharp(
              Buffer.from(
                '<svg width="1000" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="500" fill="#e8e8d9"/><circle cx="780" cy="115" r="55" fill="#dbb977"/><path d="M0 350 Q250 130 500 340 T1000 300 V500 H0Z" fill="#a5b6a0"/><path d="M0 450 Q380 200 700 450 T1000 390 V500 H0Z" fill="#5d7e69"/></svg>',
              ),
            )
              .png()
              .toBuffer();
            const asset = await media.upload(
              staff.editor.token,
              letter.id,
              revision,
              image,
              randomUUID(),
            );
            revision = asset.revision;
          }
          if (publicRequested) {
            const governance = new Governance(core);
            const request = await governance.propose(
              staff.editor.token,
              "letter.public",
              letter.id,
              revision,
              { consent: true },
              randomUUID(),
            );
            await governance.approve(
              staff.church_owner.token,
              request.id,
              randomUUID(),
            );
            revision++;
          }
          if (index !== 3) {
            const submitted = await editorial.submit(
              staff.editor.token,
              letter.id,
              revision,
              randomUUID(),
            );
            if (index !== 2) {
              await editorial.decide(
                staff.reviewer.token,
                submitted.tasks[0].id,
                revision,
                "approve",
                true,
                randomUUID(),
              );
              if (submitted.tasks[1])
                await editorial.decide(
                  staff.reviewer2.token,
                  submitted.tasks[1].id,
                  revision,
                  "approve",
                  true,
                  randomUUID(),
                );
              if (index !== 4)
                await editorial.publish(
                  staff.mission_lead.token,
                  letter.id,
                  revision,
                  randomUUID(),
                );
              if (index === 5)
                await editorial.archive(
                  staff.mission_lead.token,
                  letter.id,
                  revision,
                  randomUUID(),
                  "other",
                );
            }
          }
        }
        await tx
          .insert(s.securityIncidents)
          .values({
            category: "delivery_failure",
            severity: "low",
            status: "open",
            reasonCode: "delivery_failure",
            reportedBy: staff.security_auditor.id,
          });
        await tx
          .insert(s.systemSettings)
          .values({
            key: "local_seed_member",
            enabled: true,
            value: { userId: user.id },
          });
        for (const item of Object.values(staff))
          await tx
            .delete(s.adminSessions)
            .where(eq(s.adminSessions.tokenHash, hash(item.token)));
      });
      console.log(
        "已建立完全虛構的本機測試資料；通知保持暫停，未啟用奉獻連結。",
      );
    } else console.log("本機測試資料已存在，不覆寫既有工作。");
    console.log(`僅限本機開發・共用測試密碼：${config.password}`);
    for (const name of Object.keys(config.totp))
      console.log(
        `${name}@mission-care.test ｜ TOTP 測試密鑰：${config.totp[name]}`,
      );
    return env;
  } finally {
    await pg.close();
  }
}
