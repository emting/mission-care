# Acceptance checklist evidence

All fixtures are fictional. `pnpm test` applies **all checked-in migrations** to fresh in-process PostgreSQL (PGlite). Entries below describe tested portions, not production certification. Test names include the matching checklist labels. Step 1 test names were retained.

## Main PRD §12

| # | Checklist | Test file / extent |
| --- | --- | --- |
| 1 | Fake/expired/channel/nonce | `security.test.ts`: fake, issuer, audience, expiry, nonce and replay rejection |
| 2 | Forged client identity/role | `security.test.ts`, `editorial.test.ts`, `governance-reads.test.ts`: strict fields, staff/member separation, exact scope |
| 3 | A cannot see B letter/media/list/statistics | `security.test.ts`, `ai-media.test.ts`, `governance-reads.test.ts`, `policy.test.ts`: member counts and lists, staff search/count/pagination, B image/letter rejection |
| 4 | Revoked/expired grant blocks docs/media and queued sends | `security.test.ts`, `ai-media.test.ts`, `delivery-members.test.ts` |
| 5 | Unapproved direct reads/share/cache | `editorial.test.ts`: unpublished reads denied, API no-store, publish rejected; browser/CDN behavior requires deployment checks |
| 6 | Editor cannot lower restricted | `editorial.test.ts`, `governance-reads.test.ts`: floor and dual-control workflow |
| 7 | Edits invalidate review | `editorial.test.ts`, `ai-media.test.ts`: text/prayer points/assets, immutable history, stale revision conflict |
| 8 | Distinct non-author review | `editorial.test.ts`: self-review rejection, duplicate reviewer rejection, two reviewers plus consent |
| 9 | Injection/PDF/EXIF/location cannot auto-publish | `ai-media.test.ts`: deterministic flags, rejected PDF, removed EXIF, unchanged draft status; decoder exploit resistance and human contextual image review are not certified |
| 10 | No unauthorized external AI/raw logging | `ai-media.test.ts` spy provider and output schema; `governance-reads.test.ts` audit contents |
| 11 | Same-day concurrent prayers count once | `delivery-members.test.ts`: concurrent inserts, Taipei rollover, weekly distinct and suppression |
| 12 | Push retries do not duplicate success | `delivery-members.test.ts`: concurrent publish/dispatch, unique job, stable retry key, bounded attempts; real LINE acceptance/receipt needs sandbox integration |
| 13 | Unsubscribed/nonfriend/blocked/quota/webhooks | `delivery-members.test.ts`: pause/quota/consent/friend/block eligibility, HMAC and dedupe, failure classes |
| 14 | No unapproved donation CTA | `governance-reads.test.ts`: host/scheme/auth/port checks, null CTA until independent approval |
| 15 | Key/session compromise isolation/recovery exercise | `security.test.ts` session invalidation; `governance-reads.test.ts` lockdown/revocation/incident. **Partial:** actual database/key compromise, rotation, incident notification and infrastructure recovery exercise need deployment/authorized operators |
| 16 | Privacy/retention/backup/access audit evidence | `governance-reads.test.ts`: trackable deadline and immediate withdrawal, immutable metadata audit; all suites test migration application. **Partial:** physical deletion across storage/backups, approved audit retention and production backup restoration are operational gates, not tested here |

## Admin spec §16

| # | Checklist | Test file / extent |
| --- | --- | --- |
| 1 | Anonymous admin gets no protected data | `security.test.ts`: unauthenticated overview rejected; Step 3 server-rendered pages redirect to the separate staff login |
| 2 | LINE alone cannot use staff APIs | `security.test.ts`, `editorial.test.ts` |
| 3 | aal1 cannot perform admin actions | `security.test.ts`: MFA required, bad code fails, old aal1 invalidated; UI cancellation deferred |
| 4 | No cross-scope inference via search/page/count/media | `security.test.ts`, `governance-reads.test.ts`, `ai-media.test.ts` |
| 5 | Direct API/forged IDs/role fail | `security.test.ts`, `governance-reads.test.ts`, `editorial.test.ts`; no Server Actions are exposed |
| 6 | No self-review; edits invalidate approval | `editorial.test.ts`, `ai-media.test.ts` |
| 7 | Independent downgrade/donation approval | `governance-reads.test.ts` |
| 8 | Neutral restricted reminder | `delivery-members.test.ts`: exact message text and no content in job listings |
| 9 | Revoke/archive re-evaluate API/media/queue/cache | `security.test.ts`, `ai-media.test.ts`, `delivery-members.test.ts`, `governance-reads.test.ts`; no-store headers tested, deployed CDN/browser cache behavior deferred |
| 10 | Logout/disabled/expired staff invalidates open tabs | `security.test.ts`: server-side session generation, enabled and assignment expiry; open-tab UX deferred |
| 11 | Replay/concurrent action once, audited | `editorial.test.ts`, `delivery-members.test.ts`: atomic idempotency and live-scope replay recheck |
| 12 | Source failures unavailable, not 0 | `governance-reads.test.ts`: injected source failure; dashboard renders separate unavailable/unauthorized/empty states |
| 13 | Keyboard access and warnings not color-only | Step 3 includes labels, skip links, focus rings, native keyboard controls and text/icon warnings. Six screens visually inspected; complete assistive-technology/WCAG audit remains a release gate |
| 14 | No original text/full UID/path/token in logs | `governance-reads.test.ts`: metadata audit assertions and immutability; external host/APM log configuration is an operational check |
| 15 | Lockdown/archive/pause/incident/post-review | `governance-reads.test.ts`, `delivery-members.test.ts`: service controls and post-review alert; human exercise deferred |
| 16 | Fictional data and inspectable evidence | All eight `*.test.ts` files, checked-in migrations, fictional local seed and this map; no real identities/missionaries used |

## Additional boundaries

The SQL migrations and the same services run in PGlite tests; no live LINE endpoint or object-store service was contacted. Vitest exercises injected LINE/AI/storage dependencies and route-handler factories. Step 3 additionally exercises the actual local HTTPS/PGlite app in a fresh browser, not a deployed proxy. Production application DB roles, secret management, independent audit storage/retention, privacy fulfillment, recovery drills, distributed rate limiting, real LINE credentials/Provider ownership and governance/finance approvals remain release gates. No claim of security certification or complete PRD acceptance is made.

## Step 3 additions

- `tests/liff.test.ts`: fresh server-verified ID token, exact channel, issuer/expiry/fresh iat, fake token, missing/browser-mismatched/expired/consumed challenge, Origin rejection, concurrent token replay, hash-only persistence and secure cookies. The original nonce-required `/api/auth/line` tests are retained unchanged.
- `tests/ui.test.ts`: member-safe projections, exact visibility and archive checks, personal daily prayer state and suppressed counts, independent follow/push state, empty lists, scoped original-text permission, author identification, hidden navigation permissions, scoped notification filtering and production-disabled mock login.
- `scripts/visual-check.ts`: real local UI with fresh Chromium; independent follow/push controls, prayer state surviving reload, hidden small counts/disabled donation CTA, staff password→TOTP forms, overview, neutral notifications/preferences tabs, review consent gating, direct-page 403, no-store and browser errors. Screenshots live outside the repository at `~/work/screenshots/`.
- Visual evidence: `member-list.png`, `member-letter.png`, `admin-login.png`, `admin-overview.png`, `admin-letter-review.png`, `admin-notifications.png`.
- Still not certified: live LIFF/LINE login and delivery, deployed proxy/CDN cache behavior, every browser/screen reader, complete keyboard-only coverage, audit retention, production data removal and backups. Screenshots and local checks are not substitutes for those exercises.
