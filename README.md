# Mission Care｜宣教關懷與代禱平台

Step 1 security foundation. Proposal only; not church-approved or production-ready. All test data are fictional. No donation processing, AI calls, publishing workflows, or notification sending are enabled.

## Development

Node 22+ and pnpm 10: `pnpm install`, copy `.env.example` to `.env.local`, then `pnpm dev`. Run `pnpm check`, `pnpm test`, and `pnpm build`. Next.js 15 App Router, strict TypeScript, Tailwind, Drizzle/PostgreSQL. Tests use in-process PGlite and the checked-in SQL migrations; no database server required.

For a local PostgreSQL database set `DATABASE_URL` in your shell then `pnpm db:migrate`. Generate reviewed migrations with `pnpm db:generate`. Use a dedicated backend-only database credential; never expose database access to browsers. Rollback is by restoring a verified backup into a fresh database; destructive down migrations are intentionally not supplied.

## Authentication contract

All POST requests need exact `Origin: APP_ORIGIN`, JSON content type and `X-MC-CSRF: 1` (custom header prevents cross-origin simple requests; no CORS allowance). Cookies are always Secure, HttpOnly, SameSite=Lax and host-only. Use HTTPS in local auth testing.

1. POST `/api/auth/challenge` with `{}` obtains a nonce and a short-lived binding cookie. Pass that nonce into the LINE authorization transaction.
2. POST `/api/auth/line` with `{idToken, nonce}`. Server verifies with LINE and validates issuer, channel, expiry and nonce, consuming the challenge once. Session TTL: one hour. Only a SHA-256 subject digest is persisted; future messaging integration must add encrypted subject storage with explicit consent.
3. POST `/api/auth/logout` revokes the current member session.

Staff have independent `POST /api/admin/auth/password` (`{email,password}`), `/api/admin/auth/mfa` (`{code}`), and `/api/admin/auth/logout` (`{}`). Password stage expires in five minutes; successful TOTP rotates the session to aal2 for 30 minutes. TOTP codes cannot be reused within a timestep. Logout invalidates all staff sessions. Every staff request rechecks enabled state, session generation and live assignments. High-risk workflows must call `recentMfa` and dual-control policies when implemented.

Staff enrollment and recovery deliberately have no public endpoint. An authorized operator must provision a scrypt password hash and AES-256-GCM encrypted TOTP seed using `hashPassword` / `encryptSecret`, set enabled, and create an expiring assignment. Do not seed real staff or commit secrets. `AUTH_ENCRYPTION_KEY` must be a securely managed random 32-byte hex key.

## Architecture and resolved ambiguities

- `src/server/policy.ts` is pure default-deny policy. `services.ts` owns auth and visibility; `http.ts` owns common response, validation, CSRF and cookie handling. Route handlers are thin and invoke auth on every request. Database factories allow PGlite injection.
- Public published content still requires member login. Restricted letters require a specific grant even on a public missionary. Offline entries retain only an administrative code, never details; database guards reject secret/content records for offline missionaries. New missionaries are inactive and invite-only.
- Church owner is not a content superuser. Scoped operational roles require exact missionary assignments; NULL scope is not a wildcard for editors/reviewers/leads. Distinct non-author reviewers are required by dual-control policy; policy changes need a different approving account. Future workflows must enforce these in transactions.
- Global notification pause defaults on in migrations. Feature toggles default off. No direct anonymous database API is provided. Application authorization is the boundary, not Supabase Auth/RLS.
- Member and staff cookies/tables are separate. LINE identity does not confer staff access. Unrecognized input fields are rejected. Errors contain only safe codes and server-generated request IDs; raw text, LINE subjects, tokens and stacks are not returned.
- Default rate limiting is deliberately process-local and conservative (per endpoint, not untrusted forwarded IP). Production must inject a distributed trusted-edge limiter. Multi-instance rate limiting, deployment roles, audit isolation/retention, backup restoration exercises, MFA recovery and UI are later deployment gates, not claimed complete.
- GET `/api/missionaries`, `/api/letters` (items and filtered count) and `/api/letters/:id` demonstrate shared visibility. Media storage/proxy and admin workflow APIs are not exposed yet. The `/admin` placeholder returns no protected data.

## Safety gates

Do not use real missionary data. Do not enable production until governance approval, review/publishing state machines, assets sanitization, audit infrastructure, retention, backup/restore and adversarial end-to-end checks are complete. UI is a placeholder, not a visual design deliverable.
