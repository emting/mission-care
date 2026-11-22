"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UiReads } from "../server/ui-reads";
import { api, ClientError, Feedback, useAction, Empty } from "./shared";
type List = Awaited<ReturnType<UiReads["memberList"]>>;
type Missionary = Awaited<ReturnType<UiReads["memberMissionary"]>>;
type Letter = Awaited<ReturnType<UiReads["memberLetter"]>>;
export function MemberShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="member-shell">
      <a className="skip-link" href="#main">
        跳至主要內容
      </a>
      <header className="member-header">
        <Link href="/app" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <span>
            Mission Care<small>宣教關懷與代禱</small>
          </span>
        </Link>
        <Link href="/app/privacy" className="quiet-link">
          資料與隱私
        </Link>
      </header>
      <main id="main" className="member-main">
        {children}
      </main>
      <footer className="member-footer">
        <span>以關懷相連，以代禱同行。</span>
        <small>開發測試階段 · 所有內容均為虛構</small>
      </footer>
      <nav className="member-bottom" aria-label="會友導覽">
        <Link href="/app">◎ 關懷同行</Link>
        <Link href="/app/privacy">◇ 資料與隱私</Link>
      </nav>
    </div>
  );
}
export function MemberLogin({ devEnabled }: { devEnabled: boolean }) {
  const action = useAction();
  const [consent, setConsent] = useState(false);
  const router = useRouter();
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  async function lineLogin() {
    return action.run(
      async () => {
        const { default: liff } = await import("@line/liff");
        await liff.init({ liffId: liffId! });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.origin + "/app" });
          return { data: null, request_id: "正在前往 LINE" };
        }
        const idToken = liff.getIDToken();
        if (!idToken) throw Error("Missing token");
        const challenge = await api<{ nonce: string }>("auth/challenge", {});
        try {
          return await api("auth/liff", {
            idToken,
            nonce: challenge.data.nonce,
          });
        } catch (error) {
          if (
            error instanceof ClientError &&
            ["invalid_identity", "replayed_identity"].includes(error.code)
          )
            liff.logout();
          throw error;
        }
      },
      "登入成功",
      () => router.refresh(),
    );
  }
  return (
    <MemberShell>
      <section className="member-welcome">
        <span className="eyebrow">在關懷中同行</span>
        <h1>
          每一份安靜的代禱，
          <br />
          都是同行的力量。
        </h1>
        <p>
          認識近況，守望需要。
          <br />
          在安全與尊重中，陪伴每一段服事的旅程。
        </p>
      </section>
      <section className="panel login-panel">
        <h2>開始關懷與代禱</h2>
        <p className="muted">
          我們只顯示你有權限閱讀的內容，不公開個人代禱紀錄。
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            我已閱讀<Link href="/app/privacy">資料使用說明</Link>
            ，了解關懷內容不應轉傳。
          </span>
        </label>
        {!consent && <p id="consent-helper" className="muted">請先勾選上方的資料使用說明</p>}
        {liffId ? (
          <button aria-describedby={!consent ? "consent-helper" : undefined} disabled={!consent || action.pending} onClick={lineLogin}>
            使用 LINE 登入
          </button>
        ) : (
          <p className="notice">
            尚未設定 LINE 接入。正式服務僅接受 LINE 驗證登入。
          </p>
        )}
        {devEnabled && process.env.NODE_ENV !== "production" && (
          <div className="dev-login">
            <strong>⚑ 僅限本機開發測試</strong>
            <p>登入虛構會友，不連接 LINE，不具管理權限。</p>
            <button
              className="secondary"
              aria-describedby={!consent ? "consent-helper" : undefined}
              disabled={!consent || action.pending}
              onClick={() =>
                action.run(() => api("auth/dev", {}), "已登入虛構會友")
              }
            >
              開發專用模擬登入
            </button>
          </div>
        )}
        <Feedback member value={action.feedback} />
      </section>
    </MemberShell>
  );
}
export function MemberList({ items }: { items: List }) {
  return (
    <>
      <section className="member-welcome">
        <span className="eyebrow">關懷同行</span>
        <h1>
          在日常裡，
          <br />
          為彼此留一份關懷。
        </h1>
        <p>
          從一則近況開始，安靜聆聽、自由代禱。
          <br />
          不需比較，也沒有進度需要追趕。
        </p>
        <div className="botanical" aria-hidden="true">
          <span>✳</span>
        </div>
      </section>
      <div className="section-heading">
        <h2>與我們同行的宣教夥伴</h2>
        <span className="muted">僅顯示授權內容</span>
      </div>
      {items.length ? (
        <div className="mission-grid">
          {items.map((m, i) => (
            <Link
              href={"/app/missionaries/" + m.id}
              key={m.id}
              className="mission-card"
            >
              <div className={`mission-art art-${i % 3}`} aria-hidden="true">
                <span>{i % 2 ? "◒" : "✳"}</span>
                <small>關懷 · 同行</small>
              </div>
              <div className="mission-body">
                <span className="eyebrow">{m.region}</span>
                <h3>
                  {m.code}
                  <span aria-hidden="true">↗</span>
                </h3>
                <p>{m.overview ?? "在關懷與代禱中，一起同行。"}</p>
                <span className="text-link">
                  閱讀近況 <span aria-hidden="true">→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty />
      )}
      <aside className="privacy-note">
        <span aria-hidden="true">◇</span>
        <div>
          <strong>保護彼此，讓關懷走得更遠</strong>
          <p>請勿截圖、轉傳或嘗試辨識服事者。此處僅使用代號與泛化區域。</p>
        </div>
      </aside>
    </>
  );
}
export function MemberMissionary({ value: initial }: { value: Missionary }) {
  const action = useAction();
  const [preferences, setPreferences] = useState({
    following: initial.following,
    pushOptIn: initial.pushOptIn,
  });
  const value = { ...initial, ...preferences };
  useEffect(()=>setPreferences({following:initial.following,pushOptIn:initial.pushOptIn}),[initial.following,initial.pushOptIn]);
  const update = (field: "following" | "pushOptIn", checked: boolean) => {
    return action.run(() => api<{following:boolean;pushOptIn:boolean}>("subscriptions", {
          missionaryId: value.id,
          [field]: checked,
          request_id: crypto.randomUUID(),
        }), "偏好已更新", data=>setPreferences({following:data.following,pushOptIn:data.pushOptIn}));
  };
  return (
    <>
      <Link className="back-link" href="/app">
        ← 返回關懷同行
      </Link>
      <section className="member-welcome compact">
        <span className="eyebrow">{value.region}</span>
        <h1>{value.code}</h1>
        <p>{value.overview}</p>
      </section>
      <section className="panel preference-panel">
        <h2>用適合自己的方式同行</h2>
        <label className="toggle-row">
          <span>
            <strong>關注近況</strong>
            <small>追蹤這位夥伴的關懷更新，不等於開啟推播。</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={value.following}
            disabled={action.pending}
            onChange={(e) => update("following", e.target.checked)}
          />
        </label>
        <label className="toggle-row">
          <span>
            <strong>接收 LINE 提醒</strong>
            <small>獨立選擇接收中性提醒，可隨時取消。</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={value.pushOptIn}
            disabled={action.pending}
            onChange={(e) => update("pushOptIn", e.target.checked)}
          />
        </label>
        <button
          className="text-button"
          disabled={action.pending}
          onClick={() =>
            action.run(
              () =>
                api("grants/request", {
                  missionaryId: value.id,
                  request_id: crypto.randomUUID(),
                }),
              "申請已送出，將由教會核對後處理",
            )
          }
        >
          申請或更新觀看授權 →
        </button>
        <Feedback member value={action.feedback} />
      </section>
      <div className="section-heading">
        <h2>近況與代禱</h2>
        <span className="muted">經人工審核發布</span>
      </div>
      {value.letters.length ? (
        <div className="letter-list">
          {value.letters.map((l) => (
            <Link
              href={"/app/letters/" + l.id}
              key={l.id}
              className="panel letter-link"
            >
              <span className="eyebrow">代禱信</span>
              <h3>{l.title}</h3>
              <p>{l.safeSummary}</p>
              <span className="text-link">閱讀與代禱 →</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty />
      )}
    </>
  );
}
export function MemberLetter({
  value,
  donation,
}: {
  value: Letter;
  donation: { url: string } | null;
}) {
  const action = useAction();
  const [recorded, setRecorded] = useState(false);
  return (
    <>
      <Link
        className="back-link"
        href={"/app/missionaries/" + value.missionaryId}
      >
        ← 返回 {value.code}
      </Link>
      <article className="member-letter">
        <header>
          <span className="eyebrow">
            {value.code} · {value.region ?? "泛化地區"}
          </span>
          <h1>{value.title}</h1>
          <p className="muted">一份經過審閱的近況，邀請你自由地關懷。</p>
        </header>
        {value.assetIds.map((id) => (
          <img
            className="letter-image"
            key={id}
            src={"/api/media/" + id}
            alt="經審核的關懷圖片"
          />
        ))}
        <section className="letter-summary">
          <h2>近況分享</h2>
          <p>{value.safeSummary}</p>
        </section>
        <section className="prayer-panel">
          <span className="eyebrow">安靜守望</span>
          <h2>一起為這些需要代禱</h2>
          <ul>
            {value.prayerPoints.map((p, i) => (
              <li key={i}>
                <span aria-hidden="true">✧</span>
                {p}
              </li>
            ))}
          </ul>
          <button
            className="prayer-button"
            disabled={action.pending || value.prayed || recorded}
            onClick={() =>
              action.run(
                () =>
                  api("prayers", {
                    letterId: value.id,
                    request_id: crypto.randomUUID(),
                  }),
                "已記錄今天的代禱",
                () => setRecorded(true),
              )
            }
          >
            {value.prayed || recorded
              ? "✓ 今天已代禱"
              : action.pending
                ? "記錄中…"
                : "♡ 我今天為此代禱"}
          </button>
          <small>
            依台北日期記錄，每日僅計一次。這不是衡量信仰或關懷的標準。
          </small>
          {!value.stats.suppressed && value.stats.distinct_members !== null && (
            <p className="muted">
              本週有 {value.stats.distinct_members} 位夥伴一同守望。
            </p>
          )}
          <Feedback member value={action.feedback} />
        </section>
        <aside className="privacy-note">
          <span aria-hidden="true">◇</span>
          <p>請勿截圖與轉傳，讓每一份分享都留在安全的關懷範圍。</p>
        </aside>
        {donation && (
          <section className="panel donation-cta">
            <h2>以其他方式支持</h2>
            <p>奉獻由官方平台處理，本平台不經手款項。</p>
            <a
              className="button secondary"
              href={donation.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              官方奉獻網站 ↗
            </a>
            <small>將前往外部網站</small>
          </section>
        )}
      </article>
    </>
  );
}
export function MemberPrivacy({ authenticated }: { authenticated: boolean }) {
  const action = useAction(false);
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [completed, setCompleted] = useState(false);
  return (
    <>
      <Link href="/app" className="back-link">
        ← 返回關懷同行
      </Link>
      <section className="member-welcome compact">
        <span className="eyebrow">你的資料，由你決定</span>
        <h1>資料使用與隱私</h1>
        <p>只保留關懷服務所需的最少資料。</p>
      </section>
      <section className="panel prose">
        <h2>我們如何使用資料</h2>
        <p>
          LINE
          身分用於登入驗證與獨立選擇的通知。代禱記錄只用於每日去重與經隱私抑制的匿名統計，不公開誰為誰代禱，也不建立排名。
        </p>
        <h2>安全的關懷界線</h2>
        <p>
          限定內容需要逐位宣教夥伴的有效授權。請勿截圖、轉傳或以其他資訊辨識當事人。退出後無法保證收回已下載或截圖的內容。
        </p>
        <h2>退出服務與刪除申請</h2>
        <p>
          登出會撤銷目前登入。提出刪除申請會立即停用帳號、撤銷授權與通知，並進入資料保留及刪除審查流程；不代表備份已即時清除。
        </p>
        {authenticated && !completed ? (
          <>
            <button
              className="secondary"
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () => api("auth/logout", {}),
                  "已登出",
                  () => {
                    router.replace("/app");
                    router.refresh();
                  },
                )
              }
            >
              登出服務
            </button>
            <hr />
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                我了解申請後將立即無法閱讀與接收通知，並確認退出服務。
              </span>
            </label>
            <button
              className="danger"
              disabled={!confirmed || action.pending}
              onClick={() =>
                action.run(
                  () =>
                    api("privacy/delete-request", {
                      request_id: crypto.randomUUID(),
                    }),
                  "刪除申請已受理，帳號已停用",
                  () => setCompleted(true),
                )
              }
            >
              退出服務並提出刪除申請
            </button>
          </>
        ) : (
          <p className="notice">
            {completed
              ? "申請已受理，帳號已關閉。後續將依保留政策處理。如想再次使用，請聯絡教會辦公室或關懷團隊，請同工協助。"
              : "請先登入，才能登出服務或提出刪除申請。"}
          </p>
        )}
        <Feedback member value={action.feedback} />
      </section>
    </>
  );
}
