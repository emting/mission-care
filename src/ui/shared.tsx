"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { statusLabels } from "./navigation";
export const errorLabels: Record<string, string> = {
  unauthenticated: "登入已失效，請重新登入。",
  invalid_credentials: "帳號或密碼不正確。",
  invalid_mfa: "驗證碼不正確，請重新輸入。",
  replayed_mfa: "此驗證碼已使用，請等待下一組驗證碼。",
  mfa_required: "請先完成雙因素驗證。",
  recent_mfa_required: "此操作需要近期驗證，請重新輸入驗證碼。",
  revision_conflict: "版本已更新，請重新整理後再操作。",
  revision_frozen: "此版本審查中，請先退修再編輯。",
  self_approval: "不可審核自己提交或編輯的內容。",
  already_reviewed: "你已審核此版本，需由另一位審核人處理。",
  forbidden: "目前身分無權限執行此操作。",
  not_found: "此資料不存在或目前無權限檢視。",
  invalid_input: "請確認輸入內容與格式。",
  invalid_identity: "LINE 登入驗證失敗，請重新登入。",
  replayed_identity: "此登入憑證已使用，請重新取得 LINE 登入憑證。",
  rate_limited: "操作較頻繁，請稍候再試。",
  ai_disabled: "AI 匯入目前已停用。",
  policy_floor: "不可低於宣教士的安全政策。",
  dual_control_required: "提高公開程度必須另案提出雙人核准。",
  not_approved: "審核與當事人同意尚未完成。",
  invalid_state: "狀態已變更，請重新整理。",
  account_disabled: "此帳號已退出或停用。",
};
export class ClientError extends Error {
  constructor(
    public code: string,
    public requestId: string,
  ) {
    super(errorLabels[code] ?? "操作未完成，請稍後再試。");
  }
}
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<{ data: T; request_id: string }> {
  let response: Response;
  try {
    response = await fetch("/api/" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "x-mc-csrf": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ClientError("network_error", "無法取得");
  }
  const result = await response.json().catch(() => ({
    error: { code: "internal_error" },
    request_id: response.headers.get("X-Request-Id") ?? "無法取得",
  }));
  if (!response.ok)
    throw new ClientError(
      result.error?.code ?? "internal_error",
      result.request_id ?? "無法取得",
    );
  return result;
}
export function useAction(refresh = true) {
  const [pending, setPending] = useState(false),
    [feedback, setFeedback] = useState<{
      ok: boolean;
      text: string;
      id: string;
    } | null>(null);
  const router = useRouter();
  async function run<T>(
    work: () => Promise<{ data: T; request_id: string }>,
    text = "操作已完成",
    after?: (data: T) => void,
  ) {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    try {
      const result = await work();
      setFeedback({ ok: true, text, id: result.request_id });
      after?.(result.data);
      if (refresh) router.refresh();
    } catch (error) {
      const e =
        error instanceof ClientError
          ? error
          : new ClientError("internal_error", "無法取得");
      setFeedback({ ok: false, text: e.message, id: e.requestId });
    } finally {
      setPending(false);
    }
  }
  return { pending, feedback, run };
}
export function Feedback({
  value,
}: {
  value: ReturnType<typeof useAction>["feedback"];
}) {
  return value ? (
    <div
      className={`feedback ${value.ok ? "success" : "error"}`}
      role={value.ok ? "status" : "alert"}
    >
      <strong>
        {value.ok ? "✓" : "⚠"} {value.text}
      </strong>
      <small>request_id：{value.id}</small>
    </div>
  ) : null;
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge badge-${value}`}>
      {statusLabels[value] ?? value}
    </span>
  );
}
export function Empty({ text = "目前無授權可見資料" }: { text?: string }) {
  return (
    <div className="empty">
      <span aria-hidden="true">◇</span>
      <p>{text}</p>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </header>
  );
}
export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "尚無紀錄";
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "尚無紀錄";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-nu-latn", {
    timeZone: "Asia/Taipei", calendar: "gregory", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, "0")}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
