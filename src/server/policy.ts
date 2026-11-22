export type Governance = 'public'|'invite_only'|'offline';
export type Grant = { userId: string; missionaryId: string; expiresAt: Date; revokedAt: Date|null };
export type Missionary = { id: string; active: boolean; governance: Governance };
export function canViewMissionary(userId: string|null, m: Missionary, grants: Grant[], now: Date) {
  return !!userId && m.active && m.governance !== 'offline' && (m.governance === 'public' || grants.some(g => g.userId === userId && g.missionaryId === m.id && !g.revokedAt && g.expiresAt > now));
}
export function canViewLetter(userId: string|null, m: Missionary, l: { missionaryId: string; status: string; visibility: string }, grants: Grant[], now: Date) {
  return l.missionaryId === m.id && l.status === 'published' && canViewMissionary(userId,m,grants,now) && (l.visibility === 'public' || grants.some(g => g.userId === userId && g.missionaryId === m.id && !g.revokedAt && g.expiresAt > now));
}
export const permissions = {
  church_owner: ['overview','audit','policy_approve','staff_manage'],
  mission_lead: ['overview','missionary_read','letter_read','assign','access_decide','publish','archive'],
  editor: ['overview','missionary_read','letter_read','draft_edit','submit_review'],
  reviewer: ['overview','missionary_read','letter_read','review'],
  access_reviewer: ['overview','access_decide'],
  security_auditor: ['overview','audit','incident_read','lockdown'],
  finance_link_manager: ['overview','donation_request','donation_approve'],
  support: ['overview','health'],
} as const;
export type Role = keyof typeof permissions;
export type Permission = typeof permissions[Role][number];
export type Assignment = { adminId: string; role: Role; missionaryId: string|null; expiresAt: Date; revokedAt: Date|null };
export function staffCan(adminId: string, assignments: Assignment[], permission: Permission, missionaryId: string|null, now: Date) {
  return assignments.some(a => a.adminId === adminId && !a.revokedAt && a.expiresAt > now && (a.missionaryId === missionaryId || (a.missionaryId === null && ['church_owner','support','finance_link_manager'].includes(a.role))) && (permissions[a.role] as readonly string[]).includes(permission));
}
export function canApprove(actor: string, requester: string) { return actor !== requester; }
export function hasDualControl(requester: string, approvers: string[], required = 2) { return new Set(approvers.filter(a => canApprove(a,requester))).size >= required; }
export function recentMfa(verifiedAt: Date|null, now: Date) { return !!verifiedAt && verifiedAt <= now && now.getTime() - verifiedAt.getTime() < 5 * 60_000; }
