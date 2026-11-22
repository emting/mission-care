# Mission Care｜宣教關懷與代禱平台

**提案 MVP：所有資料均為虛構，未經教會核准，尚未具備正式上線條件。**

Member and admin UI with backend workflows. Proposal only; not church-approved or production-ready. All test data are fictional. No donation processing or external AI calls. Notification delivery requires explicit configuration and starts globally paused.

安全與治理文件：[威脅模型／殘餘風險](docs/threat-model.md)、[尚待教會決策（全部未核准）](docs/pending-church-decisions.md)、[驗收證據與未完成發布門檻](docs/checklist-coverage.md)。

## CI

`.github/workflows/ci.yml` 在 push／pull request 執行 Node 22、`pnpm install --frozen-lockfile`、`pnpm check`、`pnpm test`、`pnpm build`，另以獨立 gitleaks job 掃描 secrets。pnpm 版本取自 `package.json`；PGlite 測試不需要 PostgreSQL 或正式憑證。CI 通過不是教會批准或正式上線許可。

## 本機試用（不需 PostgreSQL）

需求：Node 22+、pnpm 10、OpenSSL。執行 `pnpm install` 後：

```sh
pnpm db:seed     # 首次建立檔案型 PGlite、套用相同 migrations、建立虛構資料
pnpm dev:local   # 自動執行冪等種子，再啟動 HTTPS 開發伺服器
```

開啟 **https://localhost:3000/app**，僅在本機接受自簽測試憑證。勾選資料說明後使用「開發專用模擬登入」。`/admin/login` 使用種子指令印出的 `角色@mission-care.test` 帳號、開發密碼與 TOTP 密鑰；可將密鑰加入本機驗證器。每個角色各有帳號，另有 `reviewer2`、`finance2` 供獨立覆核。相同時間步的 TOTP 不可重用；高風險操作超過五分鐘後，使用頂列「需要重新驗證」重新驗證。

種子含 M-01 公開、M-02 限定且預授權、M-03 限定未授權、M-04 不上線；會員只看到前兩位。代禱信涵蓋草稿、審查中、已核准、已發布及撤稿，並使用正常的雙人公開級別／內容審核服務建立資料。推播維持暫停、配額為零、未啟用奉獻目的地；測試收件人無真實 LINE 身分。

資料庫、私有圖片、憑證及隨機開發密鑰存於 Git 忽略的 `.local-data/`。種子重跑不覆寫既有工作；啟動與種子不可同時存取同一 PGlite 目錄。先停止開發伺服器再執行種子。此模式只供單一開發程序，**不是正式資料庫替代方案**。模擬登入需要 development、本機 DB 與專用開關同時開啟；production 一律回 404，且不接受客戶端指定身分。不要把 `.local-data`、種子輸出或測試憑證發布至網路。

會友介面在 `/app`；管理介面在 `/admin`。原稿只交給同範圍的內容編輯／審核角色；主管只讀安全草稿。導覽依權限隱藏，每個頁面仍重新驗證身分、職務與範圍，權限不足回 403。頁面與媒體採 no-store。所有時間使用台北時區，會友代禱只顯示自己的當日狀態與通過門檻的週統計。

視覺檢查（先啟動 `pnpm dev:local`）：

```sh
sudo -n apt-get install -y fonts-noto-cjk
pnpm exec playwright install chromium
pnpm exec tsx scripts/visual-check.ts
```

以全新無頭 Chromium 透過實際登入表單檢查六個畫面、獨立偏好、代禱重載、小樣本隱藏、未啟用 CTA、審核同意控制、403 與 no-store；截圖存於 `~/work/screenshots/`，不進 Git。重跑請使用下一個尚未使用的 TOTP 時間步。

## LIFF 接入

設定 `NEXT_PUBLIC_LIFF_ID` 與 `LINE_LIFF_CHANNEL_ID`（此 LIFF 所屬的 **LINE Login channel ID**，不是 LIFF ID）。由 LINE Developers 設定 HTTPS LIFF endpoint 為 `/app`，啟用 `openid` scope。SDK 僅在點擊 LINE 登入時載入；未登入時先跳轉 LINE，回來後再次點擊登入完成交換。瀏覽器不保存 token 到 localStorage，也不信任解碼後的客戶端 claims。

`POST /api/auth/liff` 接收 `{idToken,nonce}`：先呼叫 `/api/auth/challenge` 取得五分鐘、cookie 綁定的一次性 challenge；與 Origin／JSON／CSRF header 一同驗證。伺服器直接呼叫 LINE verify，檢查 `iss/aud/exp/iat`；拒絕超過五分鐘或未來超過三十秒的 iat。只保存已使用 ID token 的 SHA-256 hash，至 token 到期前皆拒絕重放；交易性寫入避免並行重播。過期記錄在後續登入清理。SDK 無法指定原流程的 OIDC nonce，因此 **`/api/auth/line` 維持原樣**，LIFF 使用獨立端點。若 LIFF 快取的 token 太舊，需重新 LINE 登入取得新 token，不會放寬新鮮度條件。真實 LINE／LIFF 接入仍需有效的部署設定，未在本機假資料中聲稱驗證。

## Development

Node 22+ and pnpm 10: `pnpm install`, copy `.env.example` to `.env.local`, then `pnpm dev`. Run `pnpm check`, `pnpm test`, and `pnpm build`. Next.js 15 App Router, strict TypeScript, Tailwind, Drizzle/PostgreSQL. Tests use in-process PGlite and the checked-in SQL migrations; no database server required.

For a local PostgreSQL database set `DATABASE_URL` in your shell then `pnpm db:migrate`. Generate reviewed migrations with `pnpm db:generate`. Use a dedicated backend-only database credential; never expose database access to browsers. Rollback is by restoring a verified backup into a fresh database; destructive down migrations are intentionally not supplied.

## Authentication contract

All POST requests need exact `Origin: APP_ORIGIN`, JSON content type and `X-MC-CSRF: 1` (custom header prevents cross-origin simple requests; no CORS allowance). Cookies are always Secure, HttpOnly, SameSite=Lax and host-only. Use HTTPS in local auth testing.

1. POST `/api/auth/challenge` with `{}` obtains a nonce and a short-lived binding cookie. Pass that nonce into the LINE authorization transaction.
2. POST `/api/auth/line` with `{idToken, nonce}`. Server verifies with LINE and validates issuer, channel, expiry and nonce, consuming the challenge once. Session TTL: one hour. A SHA-256 subject digest is used for lookup; the subject is encrypted with AES-256-GCM using the separate `LINE_SUBJECT_ENC_KEY`. Only the delivery worker decrypts it. Existing identities are backfilled on their next verified login.
3. POST `/api/auth/logout` revokes the current member session.

Staff have independent `POST /api/admin/auth/password` (`{email,password}`), `/api/admin/auth/mfa` (`{code}`), and `/api/admin/auth/logout` (`{}`). Password stage expires in five minutes; successful TOTP rotates the session to aal2 for 30 minutes. TOTP codes cannot be reused within a timestep. Logout invalidates all staff sessions. Every staff request rechecks enabled state, session generation and live assignments. High-risk workflows must call `recentMfa` and dual-control policies when implemented.

Staff enrollment and recovery deliberately have no public endpoint. An authorized operator must provision a scrypt password hash and AES-256-GCM encrypted TOTP seed using `hashPassword` / `encryptSecret`, set enabled, and create an expiring assignment. Do not seed real staff or commit secrets. `AUTH_ENCRYPTION_KEY` must be a securely managed random 32-byte hex key.

## Architecture and resolved ambiguities

- `src/server/policy.ts` is pure default-deny policy. `services.ts` owns auth and visibility; `workflows/` contains editorial, member, delivery, media, governance and read services. `http.ts` and `workflow-http.ts` own validation, CSRF, cookies and safe responses. Route handlers invoke auth on every request. Database factories allow PGlite injection.
- Public published content still requires member login. Restricted letters require a specific grant even on a public missionary. Offline entries retain only an administrative code, never details; database guards reject secret/content records for offline missionaries. New missionaries are inactive and invite-only.
- Church owner is not a content superuser. Scoped operational roles require exact missionary assignments; NULL scope is not a wildcard for editors/reviewers/leads. Distinct non-author reviewers are required by dual-control policy; policy changes need a different approving account. Future workflows must enforce these in transactions.
- Global notification pause defaults on and monthly notification quota defaults to zero in migrations. No direct anonymous database API is provided. Application authorization is the boundary, not Supabase Auth/RLS.
- Member and staff cookies/tables are separate. LINE identity does not confer staff access. Unrecognized input fields are rejected. Errors contain only safe codes and server-generated request IDs; raw text, LINE subjects, tokens and stacks are not returned.
- Default rate limiting is deliberately process-local and conservative (per endpoint, not untrusted forwarded IP). Production must inject a distributed trusted-edge limiter. Multi-instance rate limiting, deployment roles, audit isolation/retention, backup restoration exercises and MFA recovery remain deployment gates.
- GET `/api/missionaries`, `/api/letters` (items and filtered count), `/api/letters/:id` and `/api/media/:id` enforce shared visibility. Server-rendered pages use the same service authorization layer. Binary media responses carry `X-Request-Id`; JSON responses also carry `request_id`.

## Backend workflow contracts

See [docs/backend-workflows.md](docs/backend-workflows.md) for API bodies, operational controls and resolved ambiguities; [docs/checklist-coverage.md](docs/checklist-coverage.md) maps every PRD §12 / admin §16 checkbox to tests or explicit deployment/UI limitations.

## Safety gates

Do not use real missionary data. Do not enable production until governance approval, deployed audit infrastructure, retention, backup/restore and adversarial end-to-end checks are complete. Local UI checks do not establish full WCAG conformance, actual LINE delivery, production infrastructure security or complete privacy deletion across backups.
