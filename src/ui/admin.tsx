"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  adminNavigation,
  roleLabels,
  statusLabels,
  type AdminIdentity,
} from "./navigation";
import {
  api,
  Badge,
  Empty,
  Feedback,
  formatDate,
  PageHeading,
  useAction,
} from "./shared";
import type { AdminReads, ReadKind } from "../server/workflows/reads";
export function AdminLogin() {
  const action = useAction();
  const router = useRouter();
  const [step, setStep] = useState<"password" | "mfa">("password");
  return (
    <main className="admin-login">
      <a className="skip-link" href="#login-form">
        跳至登入表單
      </a>
      <section className="login-story">
        <Link href="/app" className="brand inverse">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <span>
            Mission Care<small>宣教關懷與代禱</small>
          </span>
        </Link>
        <div>
          <span className="eyebrow">安全，是關懷的一部分</span>
          <h1>
            讓每一份託付，
            <br />
            都被謹慎守護。
          </h1>
          <p>
            為同工預備的工作空間。
            <br />
            以最少的資料，完成必要的關懷。
          </p>
        </div>
        <small>開發測試階段 · 所有資料均為虛構</small>
      </section>
      <section className="login-form-area">
        <div className="login-form-wrap">
          <span className="env-badge">
            {process.env.NODE_ENV === "production"
              ? "PROD · 正式環境"
              : "TEST · 測試環境"}
          </span>
          <p className="eyebrow">管理工作空間</p>
          <h2>{step === "password" ? "工作人員登入" : "雙因素驗證"}</h2>
          <p className="muted">
            {step === "password"
              ? "使用獨立工作帳號登入，接著完成驗證。"
              : "請開啟驗證器，輸入目前的六位數驗證碼。"}
          </p>
          <div className="login-steps">
            <span className={step === "password" ? "active" : ""}>
              01 帳號驗證
            </span>
            <span aria-hidden="true">—</span>
            <span className={step === "mfa" ? "active" : ""}>02 安全驗證</span>
          </div>
          <form
            id="login-form"
            key={step}
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              if (step === "password")
                action.run(
                  () =>
                    api("admin/auth/password", {
                      email: form.get("email"),
                      password: form.get("password"),
                    }),
                  "帳號驗證完成，請繼續雙因素驗證",
                  () => setStep("mfa"),
                );
              else
                action.run(
                  () => api("admin/auth/mfa", { code: form.get("code") }),
                  "驗證成功",
                  () => {
                    router.replace("/admin");
                    router.refresh();
                  },
                );
            }}
          >
            {step === "password" ? (
              <>
                <label>
                  工作電子郵件
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    placeholder="name@example.test"
                  />
                </label>
                <label>
                  密碼
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
              </>
            ) : (
              <label>
                六位數驗證碼
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  className="totp-input"
                  autoFocus
                />
              </label>
            )}
            <button className="full-width" disabled={action.pending}>
              {action.pending
                ? "驗證中…"
                : step === "password"
                  ? "繼續安全驗證 →"
                  : "驗證並進入工作空間 →"}
            </button>
          </form>
          <Feedback value={action.feedback} />
          <p className="login-security">
            ◇ 管理身分與 LINE 會友身分完全分離。
            <br />
            所有操作均依有效職務、授權範圍與版本重新檢查。
          </p>
          <Link href="/app" className="quiet-link">
            ← 返回會友關懷平台
          </Link>
        </div>
      </section>
    </main>
  );
}
export function AdminShell({
  identity,
  children,
}: {
  identity: AdminIdentity;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const action = useAction();
  const router = useRouter();
  const [reauth, setReauth] = useState(false),
    [menu, setMenu] = useState(false);
  const roleText = [
    ...new Set(identity.roles.map((r) => roleLabels[r.role])),
  ].join("、");
  const scopeText = [...new Set(identity.roles.map((r) => r.scope))].join("、");
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#main">
        跳至主要內容
      </a>
      <aside className={`admin-sidebar ${menu ? "is-open" : ""}`}>
        <Link href="/admin" className="brand inverse">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <span>
            Mission Care<small>管理工作空間</small>
          </span>
        </Link>
        <p className="nav-caption">工作與關懷</p>
        <nav aria-label="管理導覽">
          {adminNavigation
            .filter((n) => identity.permissions.includes(n.permission))
            .map((n) => (
              <Link
                key={n.path}
                href={n.path}
                aria-current={
                  (
                    n.path === "/admin"
                      ? pathname === n.path
                      : pathname.startsWith(n.path)
                  )
                    ? "page"
                    : undefined
                }
                onClick={() => setMenu(false)}
              >
                <span aria-hidden="true">{n.icon}</span>
                {n.label}
              </Link>
            ))}
        </nav>
        <div className="sidebar-foot">
          <span aria-hidden="true">◇</span>
          <p>
            預設保護，逐案授權。
            <br />
            <small>所有示範資料均為虛構</small>
          </p>
        </div>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <button
            className="mobile-menu secondary"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            ☰ 選單
          </button>
          <div className="topbar-context">
            <span className="env-badge">{identity.environment}</span>
            <span>
              <strong>{roleText}</strong>
              <small>授權範圍：{scopeText}</small>
            </span>
          </div>
          <div className="topbar-actions">
            <button className="text-button" onClick={() => setReauth(!reauth)}>
              {identity.recentMfa ? "✓ 近期已驗證" : "⚠ 需要重新驗證"}
            </button>
            <button
              className="secondary compact-button"
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () => api("admin/auth/logout", {}),
                  "已登出",
                  () => {
                    router.replace("/admin/login");
                    router.refresh();
                  },
                )
              }
            >
              登出
            </button>
          </div>
        </header>
        {reauth && (
          <section className="reauth panel" aria-label="近期再次驗證">
            <h2>重新驗證高風險操作</h2>
            <p>請輸入尚未使用的驗證碼；同一組碼不可重複使用。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                action.run(
                  () => api("admin/auth/mfa", { code: form.get("code") }),
                  "安全驗證已更新",
                  () => setReauth(false),
                );
              }}
            >
              <label>
                六位數驗證碼
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </label>
              <button disabled={action.pending}>確認驗證</button>
              <button
                type="button"
                className="secondary"
                onClick={() => setReauth(false)}
              >
                取消
              </button>
            </form>
          </section>
        )}
        <div className="shell-feedback">
          <Feedback value={action.feedback} />
        </div>
        <main id="main" className="admin-main">
          {children}
        </main>
        <footer className="admin-footer">
          <span>Mission Care · 安全的關懷，從每個決定開始。</span>
          <span>時間顯示：台北 · 不提供個人代禱排行</span>
        </footer>
      </div>
    </div>
  );
}
type Overview = Awaited<ReturnType<AdminReads["overview"]>>;
export function AdminOverview({ value }: { value: Overview }) {
  const cards = [
    {
      key: "tasks" as const,
      label: "待審代禱信",
      hint: "等待指定版本審核",
      path: "/admin/tasks",
      icon: "▤",
    },
    {
      key: "access_requests" as const,
      label: "待核觀看權限",
      hint: "逐位核對，設定有效期限",
      path: "/admin/access",
      icon: "◇",
    },
    {
      key: "notification_jobs" as const,
      label: "通知發送異常",
      hint: "失敗或逾期候發工作",
      path: "/admin/notifications",
      icon: "▱",
    },
    {
      key: "incidents" as const,
      label: "未結安全事件",
      hint: "最小必要資訊，持續追蹤",
      path: "/admin/security",
      icon: "◈",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="工作總覽"
        title="把關懷放在心上，把安全落在細節。"
        description="這裡只呈現你目前有權處理的工作。從一項待辦開始。"
      >
        <span className="updated-at">
          更新時間
          <br />
          {formatDate(value.as_of)}
        </span>
      </PageHeading>
      <div className="overview-grid">
        {cards.map((card) => {
          const source = value[card.key] as { status: string; count?: number };
          return (
            <section className="panel metric-card" key={card.key}>
              <div>
                <span>{card.label}</span>
                <span className="metric-icon" aria-hidden="true">
                  {card.icon}
                </span>
              </div>
              {source.status === "available" &&
              source.count !== undefined &&
              source.count > 0 ? (
                <strong className="metric-number">
                  {source.count}
                  <small>件</small>
                </strong>
              ) : (
                <strong className="metric-state">
                  {source.status === "unavailable"
                    ? "⚠ 資料暫不可用"
                    : source.status === "not_authorized"
                      ? "目前無授權可見資料"
                      : "目前沒有待處理項目"}
                </strong>
              )}
              <p>{card.hint}</p>
              {source.status === "available" && (source.count ?? 0) > 0 && (
                <Link href={card.path} className="text-link">
                  前往處理 →
                </Link>
              )}
            </section>
          );
        })}
      </div>
      <div className="overview-body">
        <section className="panel">
          <div className="panel-heading">
            <h2>今日優先處理</h2>
            <span className="badge">依授權顯示</span>
          </div>
          {cards
            .filter((c) => value[c.key].status === "available" && (value[c.key].count ?? 0) > 0)
            .map((c, i) => (
              <Link href={c.path} className="priority-row" key={c.key}>
                <span className="priority-index">0{i + 1}</span>
                <div>
                  <strong>{c.label}</strong>
                  <p>{c.hint}</p>
                </div>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
        </section>
        <aside className="care-note">
          <span className="eyebrow">一個溫柔的提醒</span>
          <span className="care-symbol" aria-hidden="true">
            ✳
          </span>
          <h2>先保護，再分享。</h2>
          <p>
            每一次審核，都是對託付的回應。確認版本、當事人同意與安全界線後，再向前一步。
          </p>
          <span className="care-rule">雙人覆核 · 最少資料 · 每次留痕</span>
        </aside>
      </div>
      <div className="notice">
        ◇ 通知需另經發送資格與配額檢查。API 接受請求，不代表已送達。
      </div>
    </>
  );
}
type Row = Record<string, unknown>;
const columns: Record<string, { key: string; label: string }[]> = {
  tasks: [
    { key: "letterId", label: "代禱信代號" },
    { key: "revision", label: "審核版本" },
    { key: "status", label: "狀態" },
    { key: "dueAt", label: "到期時間" },
  ],
  missionaries: [
    { key: "code", label: "宣教夥伴代號" },
    { key: "governance", label: "安全級別" },
    { key: "active", label: "啟用狀態" },
  ],
  letters: [
    { key: "title", label: "代禱信" },
    { key: "revision", label: "版本" },
    { key: "status", label: "狀態" },
  ],
  "access-requests": [
    { key: "id", label: "申請代號" },
    { key: "missionaryId", label: "授權對象" },
    { key: "status", label: "申請狀態" },
    { key: "createdAt", label: "申請時間" },
  ],
  audit: [
    { key: "actorLabel", label: "操作者" },
    { key: "action", label: "操作紀錄" },
    { key: "outcome", label: "結果" },
    { key: "requestId", label: "request_id" },
    { key: "createdAt", label: "時間" },
  ],
  "notification-jobs": [
    { key: "letterId", label: "來源代禱信" },
    { key: "revision", label: "版本" },
    { key: "status", label: "發送狀態" },
    { key: "attempts", label: "嘗試次數" },
    { key: "errorCode", label: "失敗類別" },
  ],
  incidents: [
    { key: "category", label: "事件分類" },
    { key: "severity", label: "嚴重程度" },
    { key: "status", label: "處理狀態" },
    { key: "createdAt", label: "建立時間" },
  ],
};
function cell(key: string, value: unknown) {
  if (key === "active") return value ? "✓ 已啟用" : "— 未啟用";
  if (value === null || value === undefined) return "—";
  if (["createdAt", "dueAt", "expiresAt"].includes(key))
    return formatDate(String(value));
  if (
    ["status", "governance", "severity", "category", "errorCode"].includes(key)
  )
    return <Badge value={String(value)} />;
  if (key === "outcome") return value === "success" ? "✓ 成功" : "⚠ 未完成";
  if (key === "title") return value ? String(value) : "尚未公開的代禱信";
  if (key === "action")
    return (
      <span>
        管理操作 <code>{String(value)}</code>
      </span>
    );
  if (["id", "missionaryId", "letterId"].includes(key))
    return <code>{String(value).slice(0, 8)}</code>;
  return String(value);
}
export function DataTable({
  kind,
  items,
  actions,
}: {
  kind: ReadKind;
  items: unknown[];
  actions?: (row: Row) => React.ReactNode;
}) {
  if (!items.length) return <Empty />;
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">授權範圍內資料列表</caption>
        <thead>
          <tr>
            {columns[kind].map((c) => (
              <th scope="col" key={c.key}>
                {c.label}
              </th>
            ))}
            {actions && <th scope="col">操作</th>}
          </tr>
        </thead>
        <tbody>
          {(items as Row[]).map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {columns[kind].map((c) => (
                <td key={c.key}>{cell(c.key, row[c.key])}</td>
              ))}
              {actions && <td>{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function AdminListing({
  kind,
  value,
  offset,
  search,
}: {
  kind: ReadKind;
  value: Awaited<ReturnType<AdminReads["list"]>>;
  offset: number;
  search: string;
}) {
  const titles: Record<string, string> = {
    tasks: "我的工作台",
    missionaries: "宣教士管理",
    letters: "代禱信管理",
    audit: "稽核日誌",
  };
  const path =
    kind === "tasks"
      ? "/admin/tasks"
      : kind === "missionaries"
        ? "/admin/missionaries"
        : kind === "letters"
          ? "/admin/letters"
          : "/admin/audit";
  return (
    <>
      <PageHeading
        eyebrow="授權範圍內的工作"
        title={titles[kind]}
        description={
          kind === "audit"
            ? "僅保留必要的操作中繼資料，不包含原文、憑證或完整 LINE 身分。"
            : "只顯示目前授權範圍，直接網址同樣需要通過服務端檢查。"
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          {kind !== "audit" ? (
            <form method="get" className="search-form">
              <label className="sr-only" htmlFor="search">
                搜尋授權範圍內資料
              </label>
              <input
                id="search"
                name="search"
                defaultValue={search}
                placeholder={
                  kind === "missionaries" ? "搜尋代號" : "搜尋已發布標題"
                }
              />
              <button className="secondary">搜尋</button>
            </form>
          ) : (
            <span className="muted">稽核紀錄不可任意修改</span>
          )}
          <span className="muted">授權範圍內共 {value.count} 筆</span>
        </div>
        <DataTable
          kind={kind}
          items={value.items}
          actions={
            kind === "audit"
              ? undefined
              : (row) => (
                  <Link
                    className="text-link"
                    href={
                      kind === "missionaries"
                        ? `/admin/missionaries/${row.id}`
                        : `/admin/letters/${kind === "tasks" ? row.letterId : row.id}`
                    }
                  >
                    {kind === "tasks" ? "開啟審核" : "檢視詳情"} →
                  </Link>
                )
          }
        />
        <div className="pagination">
          {offset > 0 ? (
            <Link
              href={`${path}?offset=${Math.max(0, offset - 20)}&search=${encodeURIComponent(search)}`}
            >
              ← 上一頁
            </Link>
          ) : (
            <span />
          )}
          {value.next_offset !== null && (
            <Link
              href={`${path}?offset=${value.next_offset}&search=${encodeURIComponent(search)}`}
            >
              下一頁 →
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
