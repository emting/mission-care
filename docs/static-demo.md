# Public static demonstration

`pnpm demo:build` produces `demo-site/` (ignored by Git). It requires Node 22,
pnpm, OpenSSL and Chromium (`pnpm exec playwright install chromium`).

The output is **public, fictional, read-only HTML/CSS**: no JavaScript, login,
API, notifications, donations, or saved changes. Even restricted/editorial
screens contain only the normal fictional seed, never live data. The member
entry and eight admin role links select pre-rendered pages, not real accounts.

## Isolation and capture

The builder copies only source/configuration into a fresh temporary workspace,
symlinks dependencies, creates a separate production build, and starts a private
HTTPS server bound to loopback on a free port. It never uses the running preview,
repository `.local-data`, `.next`, `.env` files, or a production database URL.

Production intentionally disables the dev database and mock-login HTTP route.
The private worker seeds a fresh file-backed PGlite database and invokes the
existing `devLogin` function **in process**, before starting the production Next
server with that database injected into its process-local database slot. This
does not change or relax any application's production auth guards. Staff login
uses the normal password and TOTP endpoints. Credentials travel only over private
IPC/loopback; seed credential logging is suppressed. All temporary data and the
server are removed after success or failure.

Only the demo worker adds extra fictional work after the normal seed: pending
review/access requests, a failed notification, an open incident, and an unapproved
donation-link proposal. It uses the application workflows with temporary fixture
staff sessions, deleted before capture. A signed fictional follow event and an
in-process, permanently failing messaging stub exercise notification dispatch;
no messaging client can contact LINE. The temporary quota override is restored
and notifications are paused again before capture. Normal seeding is unchanged.

The church-owner role has governance/audit permissions, not the four operational
overview permissions. Its unavailable cards are intentional, not empty data.
The role picker explains this and recommends mission lead for reviews, access
requests and notification failures, security auditor for incidents, and finance
link manager for the pending donation proposal. No role receives extra permissions.

The fixed route families include signed-out member landing, member list,
authorized missionary/letter details, privacy/reading access, each role's allowed
console navigation, notification tabs, and authorized letter/missionary details.
Authorization/discovery failures abort the build, rather than publishing login,
error or empty substitutes. Links outside the capture set go to the explanatory
unavailable page. The entry page and persistent banner provide role navigation.

Capture waits for client rendering (including letter reauthorization), removes
Next scripts and active embeds/handlers, disables all controls and form actions,
and copies styles/fonts/images, fetching protected images with the capturing
session. Links and asset paths are relative, including nested routes, so the
same directory works at `/mission-care/` without a Next base-path configuration.
An output CSP blocks scripts, network connections and form submissions as an
additional safeguard; static navigation and local styles/images still work.

## Fail-closed safety scan

Before copying the staging output to `demo-site/`, every file is checked against
the freshly generated password, all TOTP/encryption secrets and captured session
cookie values. Text files are also checked for LINE UID patterns, identity/session
metadata, and full UUIDs outside resource link paths (including request IDs).
Visible UUIDs are replaced with a demo placeholder; resource UUIDs in relative
paths remain fictional navigation identifiers. HTML additionally rejects active
scripts/handlers, submission actions, enabled controls and nonrelative links.
The scanner reports only the category/file, never the matching secret.

## GitHub Pages

`.github/workflows/pages.yml` builds and deploys on pushes to `main` and manual
dispatch using the `github-pages` environment and official Pages artifacts.
In repository Settings → Pages, select **GitHub Actions** as the source. Repository
or environment approval requirements still apply; this change does not enable or
alter those settings. No credentials or application secrets are needed by CI.

For a local prefix check, mount `demo-site/` at `/mission-care/` in a static
server and open `/mission-care/index.html`. Do not serve source or the temporary
workspace publicly. Only the validated output is the Pages artifact.
