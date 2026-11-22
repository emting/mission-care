import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { workflowDependencies } from "./workflow-http";
import { adminCookie, memberCookie } from "./http";
import { ApiError } from "./services";
import { UiReads } from "./ui-reads";
import { adminNavigation } from "../ui/navigation";
import { MemberLetterBoundary } from "../ui/member-letter-boundary";
import { AdminShell, AdminListing, AdminOverview } from "../ui/admin";
import {
  AdminAccess,
  AdminDonations,
  AdminLetter,
  AdminMissionary,
  AdminNotifications,
  AdminSecurity,
  AdminSettings,
  AdminCreateLetter,
} from "../ui/admin-panels";
import {
  MemberShell,
  MemberLogin,
  MemberList,
  MemberMissionary,
  MemberLetter,
  MemberPrivacy,
} from "../ui/member";
import * as s from "./db/schema";

function unavailable(id: string, member = false) {
  return (
    <section className="panel error-state" role="alert">
      <span aria-hidden="true">⚠</span>
      <h1>資料暫不可用</h1>
      <p>
        未顯示的資料不代表沒有待辦。請稍後重新整理，或提供以下識別碼給支援同工。
      </p>
      <small>{member ? `參考編號：${id.slice(0,8)}` : `request_id：${id}`}</small>
      <p>
        <Link href="/app">返回關懷平台</Link> ·{" "}
        <Link href="/admin">返回管理總覽</Link>
      </p>
    </section>
  );
}
export async function MemberScreen({ parts = [] }: { parts?: string[] }) {
  const requestId = randomUUID();
  const token = (await cookies()).get(memberCookie)?.value;
  const privacy = parts.length === 1 && parts[0] === "privacy";
  if (!token) {
    if (privacy)
      return (
        <MemberShell>
          <MemberPrivacy authenticated={false} />
        </MemberShell>
      );
    return (
      <MemberLogin
        devEnabled={
          process.env.NODE_ENV === "development" &&
          process.env.MC_LOCAL_DB === "1" &&
          process.env.MC_DEV_LOGIN === "1"
        }
      />
    );
  }
  try {
    const d = workflowDependencies();
    const user = await d.core.auth.member(token);
    const reads = new UiReads(d.core);
    let content: React.ReactNode;
    if (privacy) content = <MemberPrivacy authenticated />;
    else if (!parts.length)
      content = <MemberList items={await reads.memberList(token)} />;
    else if (parts.length === 2 && parts[0] === "missionaries")
      content = (
        <MemberMissionary
          value={await reads.memberMissionary(token, z.uuid().parse(parts[1]))}
        />
      );
    else if (parts.length === 2 && parts[0] === "letters")
      content = (
        <MemberLetterBoundary id={parts[1]}>
          <MemberLetter
            value={await reads.memberLetter(token, z.uuid().parse(parts[1]))}
            donation={await d.governance.cta()}
          />
        </MemberLetterBoundary>
      );
    else return notFound();
    await d.core.audit(d.core.db, {
      actorId: user.id,
      action: "page.member." + (parts[0] ?? "list"),
      requestId,
      resourceId: parts[1],
    });
    return <MemberShell>{content}</MemberShell>;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401)
        return (
          <MemberLogin
            devEnabled={
              process.env.NODE_ENV === "development" &&
              process.env.MC_LOCAL_DB === "1" &&
              process.env.MC_DEV_LOGIN === "1"
            }
          />
        );
      if (error.status === 404) return notFound();
      if (error.status === 403) return forbidden();
    }
    if (error instanceof z.ZodError) return notFound();
    if (error instanceof Error && "digest" in error) throw error;
    return <MemberShell>{unavailable(requestId,true)}</MemberShell>;
  }
}
export async function AdminScreen({
  parts = [],
  query = {},
}: {
  parts?: string[];
  query?: Record<string, string | string[] | undefined>;
}) {
  const requestId = randomUUID();
  const token = (await cookies()).get(adminCookie)?.value;
  if (!token) return redirect("/admin/login");
  const kind = parts[0] ?? "";
  const nav = adminNavigation.find(
    (n) => n.path === "/admin" + (kind ? "/" + kind : ""),
  );
  if (!nav || parts.length > 2) return notFound();
  let identity;
  try {
    const d = workflowDependencies();
    const c = d.core;
    const ui = new UiReads(c);
    identity = await ui.identity(token);
    await c.scope(c.db, token, nav.permission);
    let content: React.ReactNode;
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .catch(0)
      .parse(query.offset);
    const search = z
      .string()
      .max(100)
      .catch("")
      .parse(query.search ?? "");
    if (parts.length === 2) {
      const id = z.uuid().parse(parts[1]);
      if (kind === "letters") {
        const value = await ui.adminLetter(token, id);
        content = <AdminLetter key={id + ":" + value.revision} value={value} />;
      } else if (kind === "missionaries")
        content = <AdminMissionary value={await ui.missionary(token, id)} />;
      else return notFound();
    } else if (!kind)
      content = (
        <AdminOverview value={await d.reads.overview(token, requestId)} />
      );
    else if (["tasks", "missionaries", "letters", "audit"].includes(kind)) {
      const create =
        kind === "letters" && identity.permissions.includes("draft_edit") ? (
          <AdminCreateLetter
            missionaries={
              (await d.reads.list(token, "missionaries", 0, 50, "", requestId))
                .items as { id: string; code: string }[]
            }
          />
        ) : null;
      content = (
        <>
          {create}
          <AdminListing
            kind={kind as "tasks" | "missionaries" | "letters" | "audit"}
            value={await d.reads.list(
              token,
              kind as "tasks" | "missionaries" | "letters" | "audit",
              offset,
              20,
              search,
              requestId,
            )}
            offset={offset}
            search={search}
          />
        </>
      );
    } else if (kind === "access")
      content = (
        <AdminAccess
          requests={await d.reads.list(
            token,
            "access-requests",
            offset,
            20,
            "",
            requestId,
          )}
          grants={await ui.grants(token)}
          offset={offset}
        />
      );
    else if (kind === "notifications") {
      const tab = ["pending", "sent", "preferences"].includes(String(query.tab))
        ? String(query.tab)
        : "pending";
      const [pause] = await c.db
        .select()
        .from(s.systemSettings)
        .where(eq(s.systemSettings.key, "global_notification_pause"));
      const value = await ui.notifications(token, tab, offset);
      content = (
        <AdminNotifications
          value={value}
          pause={pause?.enabled ?? true}
          tab={tab}
          offset={offset}
        />
      );
    } else if (kind === "donations")
      content = <AdminDonations value={await ui.donations(token)} />;
    else if (kind === "security")
      content = (
        <AdminSecurity
          incidents={await d.reads.list(
            token,
            "incidents",
            offset,
            20,
            "",
            requestId,
          )}
          canLockdown={identity.permissions.includes("lockdown")}
          canResume={identity.permissions.includes("notification_resume")}
        />
      );
    else if (kind === "settings")
      content = (
        <AdminSettings
          identity={identity}
          health={
            identity.permissions.includes("health")
              ? await d.reads.health(token, requestId)
              : null
          }
        />
      );
    else return notFound();
    await c.audit(c.db, {
      actorId: identity.id,
      action: "page.admin." + (kind || "overview"),
      requestId,
      resourceId: parts[1],
      missionaryId: kind === "missionaries" ? parts[1] : undefined,
    });
    return <AdminShell identity={identity}>{content}</AdminShell>;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.code === "mfa_required")
        return redirect("/admin/login");
      if (error.status === 403) return forbidden();
      if (error.status === 404) return notFound();
    }
    if (error instanceof z.ZodError) return notFound();
    if (error instanceof Error && "digest" in error) throw error;
    return identity ? (
      <AdminShell identity={identity}>{unavailable(requestId)}</AdminShell>
    ) : (
      <main className="standalone-error">{unavailable(requestId)}</main>
    );
  }
}
