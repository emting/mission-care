import type { Permission, Role } from "../server/policy";
export const roleLabels: Record<Role, string> = {
  church_owner: "教會治理負責人",
  mission_lead: "差傳主管",
  editor: "內容編輯",
  reviewer: "內容審核",
  access_reviewer: "權限審核",
  security_auditor: "安全稽核",
  finance_link_manager: "奉獻連結管理",
  support: "基本支援",
};
export const adminNavigation: {
  path: string;
  label: string;
  icon: string;
  permission: Permission;
}[] = [
  { path: "/admin", label: "管理總覽", icon: "◫", permission: "overview" },
  {
    path: "/admin/tasks",
    label: "我的工作台",
    icon: "☑",
    permission: "letter_read",
  },
  {
    path: "/admin/missionaries",
    label: "宣教士管理",
    icon: "◎",
    permission: "missionary_read",
  },
  {
    path: "/admin/letters",
    label: "代禱信管理",
    icon: "▤",
    permission: "letter_read",
  },
  {
    path: "/admin/access",
    label: "會友權限審核",
    icon: "◇",
    permission: "access_decide",
  },
  {
    path: "/admin/notifications",
    label: "LINE 推播中心",
    icon: "▱",
    permission: "assign",
  },
  {
    path: "/admin/donations",
    label: "官方奉獻連結",
    icon: "↗",
    permission: "donation_request",
  },
  {
    path: "/admin/security",
    label: "安全中心",
    icon: "◈",
    permission: "incident_read",
  },
  { path: "/admin/audit", label: "稽核日誌", icon: "≡", permission: "audit" },
  {
    path: "/admin/settings",
    label: "教會設定",
    icon: "⚙",
    permission: "overview",
  },
];
export const statusLabels: Record<string, string> = {
  draft: "草稿",
  pending_review: "審查中",
  approved: "已核准",
  published: "已發布",
  archived: "已撤稿",
  pending: "待處理",
  sent: "已接受",
  failed: "發送失敗",
  cancelled: "已取消",
  rejected: "已拒絕",
  approve: "已核准",
  reject: "已退修",
  superseded: "版本已更新",
  open: "待處理",
  investigating: "調查中",
  closed: "已結案",
  public: "公開關懷",
  invite_only: "限定關懷",
  restricted: "限定關懷",
  offline: "不上線",
  retryable: "可重試",
  permanent: "永久失敗",
  quota: "配額限制",
  ineligible: "資格失效",
  delivery_failure: "通知發送異常",
  suspected_disclosure: "疑似資訊外洩",
  access_violation: "存取權限異常",
  emergency_lockdown: "緊急安全封鎖",
  other: "其他安全原因",
  low: "低",
  medium: "中",
  high: "高",
  available: "正常",
  unavailable: "資料暫不可用",
};
export const riskLabels: Record<string, string> = {
  coordinates: "座標資訊",
  phone: "電話資訊",
  email: "電子郵件",
  url: "外部網址",
  location: "地點線索",
  minor_or_age: "年齡或未成年人",
  date_or_itinerary: "日期與行程",
  prompt_injection: "疑似指令注入",
};
export type AdminIdentity = {
  id: string;
  roles: { role: Role; scope: string }[];
  permissions: Permission[];
  environment: "TEST" | "PROD";
  recentMfa: boolean;
};
