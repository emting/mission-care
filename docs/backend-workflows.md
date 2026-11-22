# Backend workflow contracts — step 2

All browser mutations require the Origin/JSON/custom-CSRF header contract in README. Unknown JSON keys are rejected. Use UUID `request_id` for safe retries. Editorial mutations require both `request_id` and positive `expected_revision`; the latter yields 409 on stale input. Other mutation endpoints accept an optional UUID `request_id` (server-generated if omitted). Reusing an ID for another actor, resource or payload returns 409. Replays recheck current authorization. Workflow effects and metadata-only audit records are committed together.

## Editorial

`content = {title, safeSummary, prayerPoints: string[], raw, visibility: "restricted"|"public", assetIds: UUID[]}`. Default visibility is restricted, default assets are empty. `raw` is encrypted at rest and never returned by read APIs. Titles/safe summaries/prayer points are intended-for-review content, not automatic redaction guarantees.

| Method / endpoint | Body / purpose |
| --- | --- |
| POST `/api/letters` | `{missionaryId, content, request_id?}` — requires member session and active `mc_submitter_assignments` delegation |
| POST `/api/admin/letters` | Same body — requires scoped editor + aal2 |
| PATCH `/api/admin/letters/:id` | `{content, expected_revision, request_id}` |
| POST `/api/admin/letters/:id/submit-review` | `{expected_revision, request_id}`; returns review task IDs |
| POST `/api/admin/reviews/:taskId/decision` | `{decision:"approve"|"reject", consent:boolean, expected_revision, request_id}` |
| POST `/api/admin/letters/:id/publish` | `{expected_revision, request_id}`; scoped mission lead, recent MFA |
| POST `/api/admin/letters/:id/archive` | `{expected_revision, request_id}` |
| POST `/api/letters/:id/ai-draft` | `{expected_revision, request_id}`; owning delegated member |
| POST `/api/admin/letters/:id/ai-draft` | Same, scoped editor |
| POST `/api/admin/letters/:id/assets` | `{base64, expected_revision, request_id}`; scoped editor, decoded image ≤5 MiB |
| POST `/api/admin/letters/:id/public-change-request` | `{consent:true, expected_revision, request_id}` |

A member delegation names an accountable staff editor, who is recorded as the initial editorial author; the actual submitting member is separately recorded. Provision delegations through a trusted operator, not a client role field. If a person has both identities, provision `mc_admin_user_links`; such a person cannot approve their member submission. Editing staff can never approve any revision of that letter. Staff enrollment/delegation management UI is outside this step.

Every title/text/asset/prayer-point edit appends an encrypted immutable revision. Editing an approved/published letter withdraws it immediately, clears publication/consent, supersedes tasks and cancels its queued deliveries. Pending-review revisions are frozen: reject first, then save a new revision. A rejected/reviewed revision cannot simply be resubmitted to recycle approvals. Prior reviews remain immutable history but cannot approve a new revision. Restricted letters require two different non-author/non-editor reviewers and at least one explicit consent confirmation. Public letters still require a non-author reviewer and consent. Publish rechecks live reviewer authority, missionary floor, consent, revision and reviewed sanitized media in a transaction.

Lowering visibility is only possible for a public-policy missionary through a separate proposal and another church-owner approval. Approval itself creates a new draft revision and invalidates previous approvals; it does not publish. Offline missionaries cannot hold content. There is no emergency route for increasing visibility.

AI defaults to a local empty-draft provider. Runtime never permits an external provider. The provider interface additionally refuses external processing for restricted/invite-only/high-risk content even if a future caller enables external processing for safe public text. Deterministic scanning is a conservative aid, not a claim of complete de-identification. AI output never alters publication status or the approved snapshot.

## Member and governance

| Endpoint | Body |
| --- | --- |
| POST `/api/prayers` | `{letterId, request_id?}`; Taiwan local date computed by server, unique user×letter×date |
| GET `/api/letters/:id/prayer-stats` | Week starts Monday in Asia/Taipei, distinct members; counts below `PRAYER_SUPPRESSION_THRESHOLD` are null, including zero |
| POST `/api/subscriptions` | `{missionaryId, following?, pushOptIn?, request_id?}`; fields independent |
| POST `/api/grants/request` | `{missionaryId, request_id?}`; opaque acceptance, including unknown/offline targets |
| POST `/api/admin/access-requests/:id/decision` | `{approve, expiresAt:ISO8601, request_id?}`; approval expiry must be future and ≤366 days |
| POST `/api/admin/access-grants/:id/revoke` | `{request_id?}`; cancels affected queued jobs |
| POST `/api/admin/donation-links/change-request` | `{url, expected_revision, request_id}`; finance role and recent MFA |
| POST `/api/admin/action-requests/:id/approve` | `{request_id?}`; different qualified staff account, recent MFA |
| GET `/api/donations/cta` | null until approved/enabled destination and feature flag exist; only HTTPS exact allowlisted hosts, no credentials/custom port |
| POST `/api/privacy/delete-request` | `{request_id?}`; records retention review due date, disables account/sessions/consent/grants/subscriptions and cancels jobs |

Privacy requests are not claims that every backup has been erased. Authorized privacy operations must complete deletion/retention review within the recorded deadline using the church-approved retention policy. Immutable audit records need a separately controlled retention/archive procedure; the app credential has no audit-edit endpoint.

## Delivery and media

`POST /api/internal/dispatch` requires `X-MC-Dispatch-Secret`, not browser cookies. It is separately rate limited. Configure `LINE_SUBJECT_ENC_KEY`, `LINE_MESSAGING_ACCESS_TOKEN`, `LINE_MESSAGING_CHANNEL_SECRET`, and `DISPATCH_SECRET`. Before an approved test send, an operator must set `global_notification_pause=false` and `monthly_notification_quota.value` to an explicitly approved positive number in settings. Quota counts conservative API attempts, not guaranteed delivery. Quota and dispatch are serialized; send checks publication/revision, live per-missionary grant, user enabled, opt-in, friend/block status and global pause. All reminders use **有新的關懷消息**. A job's stable UUID is sent as `X-Line-Retry-Key`; accepted does not mean delivered. At most three attempts; transient/quota failures back off, permanent failures stop. Admin retry can accelerate an eligible pending/retryable job, not reset its bound or resend an accepted/cancelled/permanent job. Enqueue uniqueness is per letter×user, including across republishing revisions, per this step's requested idempotency scope.

Workflow writes and dispatch share a PostgreSQL transaction advisory lock. This intentionally favors safety over throughput for the MVP. The network call occurs inside that lock, with a five-second timeout in the production client; revocation/archive/lockdown serialize with dispatch. A crash after LINE acceptance can be retried using the same LINE retry key. No system can retract an already accepted notification.

`POST /api/line/webhook` verifies HMAC-SHA256 over the unmodified body and deduplicates webhookEventId transactionally. Follow/unfollow/block alter eligibility using a hashed subject lookup; no webhook payload or raw UID enters audit records. Member push consent is independent of follow status.

Private media storage defaults to `private-media/`, excluded from git and outside `public/`. The injectable storage interface supports another private object store. Upload identifies actual JPEG/PNG/WebP data, limits bytes and pixel count, and re-encodes to WebP without EXIF. Uploaded assets require human review for the specific revision before member delivery. `GET /api/media/:id` checks member access or scoped staff aal2 on every request, returns only bytes with no-store/nosniff/request ID, never a storage key or permanent URL. EXIF removal is not a substitute for visual/background or malware review; image decoder patching remains an operational responsibility.

## Admin reads and security

GET `/api/admin/{overview,tasks,missionaries,letters,access-requests,audit,health,notification-jobs,incidents}`; GET `/api/admin/letters/:id`. Lists use server-side scope filters, bounded `limit` (1–50), `offset` (0–10000), and optional `search` (≤100 characters; letter title/missionary code). Counts use the same scope. Overview uses distinct pending-review letters, pending access requests, failed/overdue delivery jobs and open incidents. Unauthorized sources are not_authorized; failed authorized sources are unavailable, not zero.

POST `/api/admin/security/lockdown`: `{request_id?, letterId?, grantId?, adminId?, pauseNotifications?:true, disableAi?:true, reasonCode}`. A globally assigned security auditor with recent MFA can only pause, archive, revoke or disable; the operation creates an incident and post-incident-review alert. No false/restore/publish field is accepted. Scoped auditors cannot perform global lockdown. Church-level security-auditor assignments are explicit global audit/security authority, not content-editor authority.

POST `/api/admin/incidents`; PATCH or DELETE `/api/admin/incidents/:id`. Body `{request_id?, missionaryId?, category, severity, reasonCode, status}`. Category/reason use only `suspected_disclosure|access_violation|delivery_failure|emergency_lockdown|other`, severity `low|medium|high`, status `open|investigating|closed`. DELETE is audited soft-close, not removal of security history. No free-text original content is accepted.

Rate limiting remains a conservative process-local endpoint limiter and must be replaced at the trusted edge for production/multi-instance deployment. No external service, browser UI, production database credential rotation or production backup procedure is certified by the in-process tests.
