"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UiReads } from "../server/ui-reads";
import type { AdminReads } from "../server/workflows/reads";
import {
  api,
  Badge,
  Empty,
  Feedback,
  formatDate,
  PageHeading,
  useAction,
} from "./shared";
import { DataTable } from "./admin";
import { riskLabels, roleLabels, type AdminIdentity } from "./navigation";
import { canRetryNotification } from "../server/policy";
type Review = Awaited<ReturnType<UiReads["adminLetter"]>>;
export function AdminLetter({ value }: { value: Review }) {
  const action = useAction();
  const [title, setTitle] = useState(value.content.title),
    [summary, setSummary] = useState(value.content.safeSummary),
    [points, setPoints] = useState(value.content.prayerPoints.join("\n")),
    [raw, setRaw] = useState(value.content.raw ?? ""),
    [consent, setConsent] = useState(false);
  const frozen = value.status === "pending_review";
  const editable = value.canEdit && !frozen;
  const dirty =
    title !== value.content.title ||
    summary !== value.content.safeSummary ||
    points !== value.content.prayerPoints.join("\n") ||
    raw !== (value.content.raw ?? "");
  const revision = () => ({
    expected_revision: value.revision,
    request_id: crypto.randomUUID(),
  });
  const decision = (choice: "approve" | "reject") =>
    action.run(
      () =>
        api(`admin/reviews/${value.taskId}/decision`, {
          ...revision(),
          decision: choice,
          consent,
        }),
      "審核決定已記錄",
    );
  const reviewDisabled =
    action.pending || value.self || value.reviewed || !value.taskId || !frozen;
  return (
    <>
      <Link href="/admin/letters" className="back-link">
        ← 返回代禱信管理
      </Link>
      <PageHeading
        eyebrow="版本限定 · 人工把關"
        title={value.content.title}
        description="所有決策只對目前修訂有效；文字、圖片與代禱事項異動皆會撤銷先前核准。"
      >
        <div className="revision-tag">
          修訂版本 <strong>{value.revision}</strong>
          <Badge value={value.status} />
        </div>
      </PageHeading>
      <Feedback value={action.feedback} />
      <div className="review-layout">
        <section className="panel editor-panel">
          <div className="panel-heading">
            <h2>編輯與來源對照</h2>
            <Badge value={value.content.visibility} />
          </div>
          {frozen && (
            <p className="notice">
              ◇ 此版本已凍結。需要修改時，先由獨立審核人退修。
            </p>
          )}
          {value.content.raw !== undefined ? (
            <details className="original-panel" open>
              <summary>原始投稿 · 僅限授權編輯與審核人</summary>
              {editable ? (
                <label>
                  原始稿
                  <textarea
                    value={raw}
                    maxLength={100000}
                    onChange={(e) => setRaw(e.target.value)}
                    rows={5}
                  />
                </label>
              ) : (
                <pre>{value.content.raw}</pre>
              )}
            </details>
          ) : (
            <p className="notice">
              ◇ 目前角色僅可閱讀安全草稿，不具原文檢視權限。
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.run(
                () =>
                  api(
                    `admin/letters/${value.id}`,
                    {
                      ...revision(),
                      content: {
                        ...value.content,
                        title,
                        safeSummary: summary,
                        prayerPoints: points
                          .split("\n")
                          .filter((p) => p.trim()),
                        raw,
                      },
                    },
                    "PATCH",
                  ),
                "已儲存新修訂，先前核准已失效",
              );
            }}
          >
            <label>
              標題
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                disabled={!editable || action.pending}
              />
            </label>
            <label>
              安全摘要
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={5000}
                rows={5}
                disabled={!editable || action.pending}
              />
            </label>
            <label>
              代禱事項 <small>每行一項，最多二十項</small>
              <textarea
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                rows={5}
                disabled={!editable || action.pending}
              />
            </label>
            {value.content.assetIds.length > 0 && (
              <div className="review-images">
                {value.content.assetIds.map((id) => (
                  <img
                    key={id}
                    src={"/api/media/" + id}
                    alt="待逐版審核的關懷圖片"
                  />
                ))}
              </div>
            )}
            {value.canEdit && (
              <div className="editor-actions">
                <button disabled={!editable || !dirty || action.pending}>
                  儲存新草稿
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    !value.canSubmit ||
                    dirty ||
                    value.status !== "draft" ||
                    action.pending
                  }
                  onClick={() =>
                    action.run(
                      () =>
                        api(
                          `admin/letters/${value.id}/submit-review`,
                          revision(),
                        ),
                      "已送交審核，目前修訂已凍結",
                    )
                  }
                >
                  送交審查
                </button>
              </div>
            )}
            {dirty && (
              <p className="muted">
                尚有未儲存的修改，請先儲存再進行其他操作。
              </p>
            )}
          </form>
          {editable && (
            <label className="upload-field">
              新增圖片（JPEG／PNG／WebP，最大 5 MB）
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={dirty || action.pending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  action.run(async () => {
                    if (file.size > 5 * 1024 * 1024) throw Error("oversize");
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let binary = "";
                    for (const byte of bytes)
                      binary += String.fromCharCode(byte);
                    return api(`admin/letters/${value.id}/assets`, {
                      ...revision(),
                      base64: btoa(binary),
                    });
                  }, "圖片已重新編碼並建立新修訂");
                  e.target.value = "";
                }}
              />
              <small>圖片會移除 EXIF；新增圖片後仍須重新審查。</small>
            </label>
          )}
        </section>
        <aside className="review-side">
          <section className="panel">
            <div className="panel-heading">
              <h2>安全風險檢視</h2>
              <span aria-hidden="true">◇</span>
            </div>
            <p className="muted">自動掃描只是提醒，不能取代人工判斷。</p>
            {value.riskFlags.length ? (
              <ul className="risk-list">
                {value.riskFlags.map((flag) => (
                  <li key={flag}>
                    ⚠ {riskLabels[flag] ?? "需人工檢視的風險"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="safe-note">
                ✓ 掃描未發現已知模式
                <br />
                <small>不代表內容已通過安全審核</small>
              </p>
            )}
            <div className="consent-state">
              <strong>當事人授權</strong>
              <span>
                {value.consent ? "✓ 此修訂已確認" : "⚠ 尚待審核人確認"}
              </span>
            </div>
            <p className="muted">
              限定內容需兩位不同審核人同意，且不得為作者或曾編輯此信者。
            </p>
          </section>
          <section className="panel ai-panel">
            <h2>AI 草稿建議</h2>
            <span className="badge">僅限本機 · 不外傳</span>
            {value.suggestion ? (
              <>
                <p>
                  {value.suggestion.safe_summary ||
                    "本機空白建議，請由編輯人工撰寫。"}
                </p>
                {value.suggestion.prayer_points.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <p className="muted">一律需要人工審閱，不會自動套用或發布。</p>
              </>
            ) : (
              <p className="muted">
                尚無建議。預設使用本機空白提供者，不會呼叫外部 AI。
              </p>
            )}
            {value.canEdit && (
              <button
                className="secondary full-width"
                disabled={action.pending || dirty || value.status !== "draft"}
                onClick={() =>
                  action.run(
                    () => api(`admin/letters/${value.id}/ai-draft`, revision()),
                    "本機草稿已準備，仍需人工撰寫與審核",
                  )
                }
              >
                準備本機 AI 草稿
              </button>
            )}
          </section>
        </aside>
      </div>
      <section className="panel review-decision">
        <div>
          <h2>對此修訂做出決定</h2>
          <p className="muted">
            修訂 {value.revision} · 已有{" "}
            {
              value.reviews.filter(
                (r) =>
                  r.revision === value.revision && r.decision === "approve",
              ).length
            }{" "}
            筆核准紀錄
          </p>
        </div>
        <div className="decision-controls">
          {value.canReview && (
            <>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={reviewDisabled}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>已核對本修訂的當事人同意及圖片安全</span>
              </label>
              {value.self ? (
                <p className="notice">
                  ⚠
                  你是作者或曾編輯此信，不可自行核准或退修。請交由獨立審核人處理。
                </p>
              ) : value.reviewed ? (
                <p className="notice">
                  ◇ 你已審核此版本，請由另一位審核人處理。
                </p>
              ) : null}
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={reviewDisabled}
                  onClick={() => decision("reject")}
                >
                  退修
                </button>
                <button
                  disabled={reviewDisabled || !consent}
                  onClick={() => decision("approve")}
                >
                  核准此版本
                </button>
              </div>
            </>
          )}
          {value.canPublish && (
            <button
              disabled={action.pending || dirty || value.status !== "approved"}
              onClick={() => {
                if (
                  window.confirm(
                    `確認發布修訂 ${value.revision}？服務端將重新檢查同意、審核與授權，並排入中性通知工作。`,
                  )
                )
                  action.run(
                    () => api(`admin/letters/${value.id}/publish`, revision()),
                    "已發布，通知仍須通過發送資格檢查",
                  );
              }}
            >
              發布已核准版本
            </button>
          )}
          {value.canArchive && (
            <button
              className="danger"
              disabled={action.pending || value.status === "archived"}
              onClick={() => {
                if (
                  window.confirm(
                    "撤稿會立即阻斷後續閱讀，並取消候發通知。確定繼續？",
                  )
                )
                  action.run(
                    () => api(`admin/letters/${value.id}/archive`, revision()),
                    "已撤稿，候發通知已取消",
                  );
              }}
            >
              撤稿並取消候發通知
            </button>
          )}
          {!value.canReview && !value.canPublish && !value.canArchive && (
            <p className="muted">目前角色只能編輯與送審，不能核准或發布。</p>
          )}
          {value.self && !value.canReview && (
            <>
              <p className="notice">
                ⚠ 你是作者或曾編輯此信，不可自行核准。請交由獨立審核人處理。
              </p>
              <button disabled aria-disabled="true">核准此版本</button>
            </>
          )}
        </div>
      </section>
    </>
  );
}
export function AdminMissionary({
  value,
}: {
  value: Awaited<ReturnType<UiReads["missionary"]>>;
}) {
  return (
    <>
      <Link className="back-link" href="/admin/missionaries">
        ← 返回宣教士管理
      </Link>
      <PageHeading
        eyebrow="去識別化行政資料"
        title={value.code}
        description="不上線的夥伴僅保留必要行政紀錄，不提供詳細內容。"
      />
      <div className="detail-grid">
        <section className="panel">
          <h2>安全概況</h2>
          <dl>
            <dt>安全級別</dt>
            <dd>
              <Badge value={value.governance} />
            </dd>
            <dt>啟用狀態</dt>
            <dd>{value.active ? "✓ 已啟用" : "— 未啟用"}</dd>
            <dt>照片政策</dt>
            <dd>{value.allowPhotos ? "允許逐版審核" : "不允許照片"}</dd>
            <dt>同意狀態</dt>
            <dd>{value.consent ? "已留存同意" : "尚未確認；逐篇仍需核對"}</dd>
          </dl>
        </section>
        <section className="panel">
          <h2>可顯示資訊</h2>
          <dl>
            <dt>泛化區域</dt>
            <dd>{value.generalRegion ?? "不保存"}</dd>
            <dt>關懷簡介</dt>
            <dd>{value.overview ?? "不保存"}</dd>
          </dl>
          <p className="notice">
            ◇ 提高公開程度不可直接切換，須經雙人政策核准與內容重新審核。
          </p>
        </section>
      </div>
    </>
  );
}
export function AdminAccess({
  requests,
  grants,
  offset,
}: {
  requests: Awaited<ReturnType<AdminReads["list"]>>;
  grants: Awaited<ReturnType<UiReads["grants"]>>;
  offset: number;
}) {
  const action = useAction();
  const [expiry, setExpiry] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  return (
    <>
      <PageHeading
        eyebrow="逐人核對 · 逐位授權"
        title="會友權限審核"
        description="請先透過既有教會流程核對申請人，沒有開放全部內容的總開關。"
      />
      <Feedback value={action.feedback} />
      <section className="panel">
        <div className="list-toolbar">
          <h2>觀看權限申請</h2>
          <label>
            核准有效期限
            <input
              type="date"
              value={expiry}
              required
              min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </label>
        </div>
        <DataTable
          kind="access-requests"
          items={requests.items}
          actions={(row) =>
            row.status === "pending" ? (
              <div className="button-row">
                <button
                  disabled={action.pending || !expiry}
                  onClick={() => {
                    if (
                      window.confirm(
                        "已透過教會既有流程完成身分核對，並確認授權對象與期限？",
                      )
                    )
                      action.run(
                        () =>
                          api(`admin/access-requests/${row.id}/decision`, {
                            request_id: crypto.randomUUID(),
                            approve: true,
                            expiresAt: new Date(
                              expiry + "T00:00:00+08:00",
                            ).toISOString(),
                          }),
                        "已核准指定觀看權限",
                      );
                  }}
                >
                  核准
                </button>
                <button
                  className="secondary"
                  disabled={action.pending}
                  onClick={() =>
                    action.run(
                      () =>
                        api(`admin/access-requests/${row.id}/decision`, {
                          request_id: crypto.randomUUID(),
                          approve: false,
                          expiresAt: new Date().toISOString(),
                        }),
                      "已拒絕申請",
                    )
                  }
                >
                  拒絕
                </button>
              </div>
            ) : (
              <span className="muted">已完成決定</span>
            )
          }
        />
        <div className="pagination">
          {offset > 0 ? (
            <Link href={`/admin/access?offset=${Math.max(0, offset - 20)}`}>
              ← 上一頁
            </Link>
          ) : (
            <span />
          )}
          {requests.next_offset !== null && (
            <Link href={`/admin/access?offset=${requests.next_offset}`}>
              下一頁 →
            </Link>
          )}
        </div>
      </section>
      <section className="panel section-gap">
        <h2>已授權紀錄</h2>
        {grants.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>授權代號</th>
                  <th>宣教士代號</th>
                  <th>會友代號</th>
                  <th>核准申請參照</th>
                  <th>有效期限</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <code title={g.id}>{g.id.slice(0, 8)}</code>
                    </td>
                    <td><code>{g.missionaryCode}</code></td>
                    <td><code>{g.memberCode}</code></td>
                    <td>{g.requestId ? <code title={g.requestId}>{g.requestId.slice(0, 8)}</code> : "無申請參照"}</td>
                    <td>{formatDate(g.expiresAt)}</td>
                    <td>
                      {g.revokedAt
                        ? "已撤銷"
                        : new Date(g.expiresAt) > new Date()
                          ? "有效"
                          : "已到期"}
                    </td>
                    <td>
                      <button
                        className="danger"
                        aria-label={`撤銷 ${g.memberCode} 對 ${g.missionaryCode} 的觀看授權`}
                        disabled={action.pending || !!g.revokedAt}
                        onClick={() => {
                          if (
                            window.confirm(
                              `確認撤銷 ${g.memberCode} 對 ${g.missionaryCode} 的觀看授權？撤銷後會立即阻斷存取，並取消候發通知。`,
                            )
                          )
                            action.run(
                              () =>
                                api(`admin/access-grants/${g.id}/revoke`, {
                                  request_id: crypto.randomUUID(),
                                }),
                              "觀看權限已撤銷",
                            );
                        }}
                      >
                        撤銷權限
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </section>
    </>
  );
}
export function AdminCreateLetter({
  missionaries,
}: {
  missionaries: { id: string; code: string }[];
}) {
  const action = useAction();
  const router = useRouter();
  return (
    <details className="panel section-gap" style={{ marginBottom: 24 }}>
      <summary>＋ 建立限定關懷草稿</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          action.run(
            () =>
              api<{ id: string }>("admin/letters", {
                request_id: crypto.randomUUID(),
                missionaryId: form.get("missionaryId"),
                content: {
                  title: form.get("title"),
                  raw: form.get("raw"),
                  safeSummary: "",
                  prayerPoints: [],
                  visibility: "restricted",
                  assetIds: [],
                },
              }),
            "限定草稿已建立",
            (data) => router.push("/admin/letters/" + data.id),
          );
        }}
      >
        <label>
          授權範圍內的宣教夥伴
          <select name="missionaryId" required>
            {missionaries.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          草稿標題
          <input name="title" required maxLength={200} />
        </label>
        <label>
          原始稿
          <textarea name="raw" rows={4} maxLength={100000} />
        </label>
        <button disabled={action.pending || !missionaries.length}>
          建立草稿
        </button>
      </form>
      <Feedback value={action.feedback} />
    </details>
  );
}
export function AdminNotifications({
  value,
  pause,
  tab,
  offset,
}: {
  value: Awaited<ReturnType<AdminReads["list"]>>;
  pause: boolean;
  tab: string;
  offset: number;
}) {
  const action = useAction();
  return (
    <>
      <PageHeading
        eyebrow="中性提醒 · 發送前再驗證"
        title="LINE 推播中心"
        description="不顯示收件人身分或訊息原文。官方 API 接受不代表確保送達。"
      >
        <span className="badge">
          {pause ? "Ⅱ 全域通知已暫停" : "✓ 發送仍需逐次檢查資格"}
        </span>
      </PageHeading>
      <div className="notification-layout">
        <section className="panel notification-table">
          <nav className="tabs" aria-label="推播分類">
            {[
              ["pending", "待發送"],
              ["sent", "傳送紀錄"],
              ["preferences", "通知偏好"],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={"/admin/notifications?tab=" + key}
                aria-current={tab === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Feedback value={action.feedback} />
          {tab === "preferences" ? (
            <div className="prose pad">
              <h2>尊重每一次通知選擇</h2>
              <p>
                關注近況與推播同意分開保存。會友可在自己的關懷頁面隨時取消 LINE
                提醒，管理者不可代為開啟。
              </p>
              <p>
                取消同意、撤銷授權、封鎖或取消加入好友後，候發工作將取消或於發送前被攔截。
              </p>
              <p className="notice">
                ◇ 全域狀態：
                {pause ? "通知暫停中" : "未暫停，仍需通過配額與資格檢查"}
                。如需緊急停用，請聯絡具安全職務的同工。
              </p>
            </div>
          ) : (
            <>
              <DataTable
                kind="notification-jobs"
                items={value.items.filter((item) => {
                  const row = item as { status: string };
                  return tab === "pending"
                    ? row.status === "pending"
                    : row.status !== "pending";
                })}
                actions={(row) => (
                  <div className="button-row">
                    <Link
                      className="text-link"
                      href={"/admin/letters/" + row.letterId}
                    >
                      來源版本 →
                    </Link>
                    {canRetryNotification({status:row.status,attempts:row.attempts,errorCode:row.errorCode},row.retryEligible===true) && (
                      <button
                        className="secondary"
                        disabled={action.pending}
                        onClick={() =>
                          action.run(
                            () =>
                              api(`admin/notification-jobs/${row.id}/retry`, {
                                request_id: crypto.randomUUID(),
                              }),
                            "已重新檢查資格並安排重試",
                          )
                        }
                      >
                        重試
                      </button>
                    )}
                  </div>
                )}
              />
              <div className="pagination">
                {offset > 0 ? (
                  <Link
                    href={`/admin/notifications?tab=${tab}&offset=${Math.max(0, offset - 20)}`}
                  >
                    ← 上一頁
                  </Link>
                ) : (
                  <span />
                )}
                {value.next_offset !== null && (
                  <Link
                    href={`/admin/notifications?tab=${tab}&offset=${value.next_offset}`}
                  >
                    下一頁 →
                  </Link>
                )}
              </div>
            </>
          )}
        </section>
        <aside>
          <section className="panel neutral-preview">
            <span className="eyebrow">限定內容 · 中性預覽</span>
            <div className="phone-preview">
              <div className="phone-top">關懷提醒</div>
              <div className="message-bubble">有新的關懷消息</div>
              <small>僅供範本預覽</small>
            </div>
            <p className="muted">不含人名、地點、圖片、奉獻資訊或具體近況。</p>
          </section>
          <section className="notice">
            <strong>◇ 每次發送前重新確認</strong>
            <p>
              發布狀態、有效授權、推播同意、好友與封鎖狀態、全域暫停及每月配額。
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
export function AdminDonations({
  value,
}: {
  value: Awaited<ReturnType<UiReads["donations"]>>;
}) {
  const action = useAction();
  return (
    <>
      <PageHeading
        eyebrow="只導流至核准的官方平台"
        title="官方奉獻連結"
        description="本平台不收款、不對帳。任何目的地異動都需要不同人提出與核准。"
      />
      <Feedback value={action.feedback} />
      <div className="detail-grid">
        <section className="panel">
          <h2>目前核准目的地</h2>
          {value.destinations.length ? (
            value.destinations.map((d) => (
              <p key={d.url}>
                {d.url}
                <Badge value={d.enabled ? "approved" : "pending"} />
              </p>
            ))
          ) : (
            <Empty text="尚未啟用核准目的地，會友端不顯示奉獻按鈕" />
          )}
          <p className="muted">只接受 HTTPS 與伺服器設定的官方白名單網域。</p>
        </section>
        <section className="panel">
          <h2>提出網址異動</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              action.run(
                () =>
                  api("admin/donation-links/change-request", {
                    request_id: crypto.randomUUID(),
                    expected_revision: value.revision,
                    url: form.get("url"),
                  }),
                "已提出異動，需另一位具權限同工核准",
              );
            }}
          >
            <label>
              官方網站 HTTPS 網址
              <input
                type="url"
                name="url"
                required
                placeholder="https://revival.eoffering.org.tw/"
              />
            </label>
            <p className="notice">◇ 需要近期 MFA。核准前不會改變會友端連結。</p>
            <button disabled={action.pending}>提出雙人覆核申請</button>
          </form>
        </section>
      </div>
      <section className="panel section-gap">
        <h2>待覆核異動</h2>
        {value.requests.length ? (
          value.requests.map((r) => (
            <div key={r.id} className="approval-row">
              <div>
                <strong>{r.url}</strong>
                <p className="muted">有效至 {formatDate(r.expiresAt)}</p>
              </div>
              <button
                disabled={
                  r.self ||
                  action.pending ||
                  new Date(r.expiresAt) <= new Date()
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `確認此網址已經官方核對，並核准啟用？\n${r.url}`,
                    )
                  )
                    action.run(
                      () =>
                        api(`admin/action-requests/${r.id}/approve`, {
                          request_id: crypto.randomUUID(),
                        }),
                      "官方目的地已核准",
                    );
                }}
              >
                {r.self ? "不可核准自己提出的異動" : "核准啟用"}
              </button>
            </div>
          ))
        ) : (
          <Empty />
        )}
      </section>
    </>
  );
}
export function AdminSecurity({
  incidents,
  canLockdown,
}: {
  incidents: Awaited<ReturnType<AdminReads["list"]>>;
  canLockdown: boolean;
}) {
  const action = useAction();
  const [target, setTarget] = useState("pauseNotifications"),
    [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="降低可見性 · 留下處置紀錄"
        title="安全中心"
        description="緊急控制只會封鎖或撤銷。恢復服務與提高公開程度需要獨立核准。"
      />
      <Feedback value={action.feedback} />
      <div className="detail-grid">
        <section className="panel security-controls">
          <h2>◈ 緊急安全控制</h2>
          <p className="notice">
            ⚠ 操作立即生效，無法收回已下載或截圖的內容。請確認影響範圍。
          </p>
          {canLockdown ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!reason || !confirmed) return;
                const form = new FormData(e.currentTarget);
                const body = {
                  request_id: crypto.randomUUID(),
                  reasonCode: reason,
                  [target]: ["pauseNotifications", "disableAi"].includes(target)
                    ? true
                    : form.get("targetId"),
                };
                action.run(
                  () => api("admin/security/lockdown", body),
                  "安全處置已執行，已建立事件與事後覆核提醒",
                  () => { setConfirmed(false); setReason(""); },
                );
              }}
            >
              <label>
                處置動作
                <select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="pauseNotifications">暫停全部對外通知</option>
                  <option value="disableAi">停用 AI 匯入</option>
                  <option value="letterId">封鎖指定代禱信</option>
                  <option value="grantId">撤銷指定觀看授權</option>
                  <option value="adminId">撤銷指定管理者登入</option>
                </select>
              </label>
              {!["pauseNotifications", "disableAi"].includes(target) && (
                <label>
                  目標資源完整識別碼
                  <input
                    name="targetId"
                    required
                    pattern="[0-9a-fA-F-]{36}"
                    placeholder="請貼上已核對的 UUID"
                  />
                </label>
              )}
              <label>
                處置原因
                <select name="reasonCode" required value={reason} onChange={(e) => { setReason(e.target.value); setConfirmed(false); }}>
                  <option value="" disabled>請選擇處置原因</option>
                  <option value="suspected_disclosure">疑似資訊外洩</option>
                  <option value="access_violation">存取權限異常</option>
                  <option value="delivery_failure">通知發送異常</option>
                  <option value="emergency_lockdown">緊急安全封鎖</option>
                  <option value="other">其他安全原因</option>
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  我已確認目標與原因，了解此操作立即生效，並需要事後覆核。
                </span>
              </label>
              <button
                className="danger"
                disabled={!reason || !confirmed || action.pending}
              >
                確認執行安全處置
              </button>
            </form>
          ) : (
            <p>目前角色無緊急停用權限。</p>
          )}
        </section>
        <section className="panel">
          <h2>建立安全事件</h2>
          <p className="muted">只記錄分類、嚴重性與處置狀態，請勿輸入原文。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const category = form.get("category");
              action.run(
                () =>
                  api("admin/incidents", {
                    request_id: crypto.randomUUID(),
                    category,
                    reasonCode: category,
                    severity: form.get("severity"),
                    status: "open",
                  }),
                "安全事件已建立",
              );
            }}
          >
            <label>
              事件分類
              <select name="category">
                <option value="suspected_disclosure">疑似資訊外洩</option>
                <option value="access_violation">存取權限異常</option>
                <option value="delivery_failure">通知發送異常</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              嚴重程度
              <select name="severity">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <button className="secondary" disabled={action.pending}>
              建立事件
            </button>
          </form>
        </section>
      </div>
      <section className="panel section-gap">
        <h2>事件追蹤</h2>
        <DataTable
          kind="incidents"
          items={incidents.items}
          actions={(row) =>
            row.status === "closed" ? (
              <span>已結案</span>
            ) : (
              <button
                className="secondary"
                disabled={action.pending}
                onClick={() =>
                  action.run(
                    () =>
                      api(
                        `admin/incidents/${row.id}`,
                        {
                          request_id: crypto.randomUUID(),
                          ...(row.missionaryId
                            ? { missionaryId: row.missionaryId }
                            : {}),
                          category: row.category,
                          severity: row.severity,
                          reasonCode: row.reasonCode,
                          status:
                            row.status === "open" ? "investigating" : "closed",
                        },
                        "PATCH",
                      ),
                    "事件狀態已更新",
                  )
                }
              >
                {row.status === "open" ? "開始調查" : "完成結案"}
              </button>
            )
          }
        />
      </section>
    </>
  );
}
export function AdminSettings({
  identity,
  health,
}: {
  identity: AdminIdentity;
  health: { database: string; as_of: string } | null;
}) {
  return (
    <>
      <PageHeading
        eyebrow="必要設定 · 不暴露密鑰"
        title="教會設定"
        description="此頁僅顯示服務與目前職務狀態，不提供任意改權或解除安全保護。"
      />
      <div className="detail-grid">
        <section className="panel">
          <h2>目前有效職務</h2>
          <ul className="setting-list">
            {identity.roles.map((r, i) => (
              <li key={i}>
                <strong>{roleLabels[r.role]}</strong>
                <span>{r.scope}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>服務與資料保留</h2>
          <dl>
            <dt>目前環境</dt>
            <dd>{identity.environment === "TEST" ? "測試環境" : "正式環境"}</dd>
            <dt>AI 提供者</dt>
            <dd>本機空白草稿，不呼叫外部服務</dd>
            <dt>服務健康</dt>
            <dd>
              {health
                ? health.database === "available"
                  ? "✓ 資料庫可用"
                  : "⚠ 資料暫不可用"
                : "目前角色未授權檢視"}
            </dd>
            <dt>資料保留</dt>
            <dd>原始草稿依期限進入保留審查，刪除申請不代表備份已即時清除。</dd>
          </dl>
          <p className="notice">
            ◇ 正式啟用前，仍需完成 LINE 接入、備份復原與教會治理核准。
          </p>
        </section>
      </div>
    </>
  );
}
