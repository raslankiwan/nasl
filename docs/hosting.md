# Free pilot deployment

Nasl uses three Vercel Hobby projects and one MongoDB Atlas Free (M0) cluster. This is a personal,
non-commercial prototype with no customers yet. Reassess the Vercel plan before commercial use;
Hobby is restricted to personal, non-commercial projects.

| Project    | Root directory | Runtime / output                              |
| ---------- | -------------- | --------------------------------------------- |
| nasl-api   | apps/api       | Express on Node 22, one function in Frankfurt |
| nasl-admin | apps/admin     | Vite static website, dist                     |
| nasl-app   | apps/mobile    | Expo web SPA, dist                            |

The two frontends call the same HTTPS API. Native iOS/Android distribution is separate; no app
store accounts, EAS paid plans, domains, Redis, paid backups, or paid monitoring are required for
this web pilot. Use the included vercel.app domains. Do not enable trials or automatic upgrades.

## What keeps this small

- Only the API runs server code. Both frontends are served as static assets.
- Each build installs only the relevant npm workspaces. Shared packages are built first.
- MongoDB pools have at most five connections per function instance and zero minimum connections.
  A warm function reuses its connection, and idle pool connections close after a minute.
- Database indexes are prepared once during provisioning, not during every function cold start.
- Authentication rate limits live in MongoDB, so no Redis subscription is needed. Counters and
  expired refresh tokens have TTL indexes and are automatically removed.
- Ownership changes use database transactions in production; standalone local MongoDB retains
  the existing compensating-write implementation.
- No scheduled keep-alive pings, cron jobs, paid analytics, or always-running workers.
- Password login and farm-account approval need no SMS or paid auth provider. Administrator
  invitations use a configured transactional email sender; use its free tier for this pilot.

Atlas M0 allows 512 MB including indexes, up to 500 connections, and 100 operations per second.
It can pause after 30 days without connections. Free-tier quotas may change: check the linked
provider documentation before adding users. Paid backup options are deliberately not enabled;
export data before keeping anything irreplaceable in this pilot.

## Deploy

1. Push the repository and import it as three Vercel projects with the roots above. Enable
   **Include source files outside of the Root Directory in the Build Step**. Use Node 22.x.
   Each app's vercel.json specifies its install/build commands. Never upload .env files.
2. Provision an Atlas **Free/M0** cluster in AWS Frankfurt, matching the API region. Choose no
   paid backups or sample dataset. Use a dedicated database user scoped to the nasl database.
   Configure Atlas network access for the deployment. Vercel's free runtime uses dynamic IPs;
   static egress/private networking would require a paid setup.
3. Set API production environment variables:
   - NODE_ENV=production
   - MONGODB_URI: Atlas URI supplied by the integration
   - MONGODB_DB_NAME=nasl
   - JWT_SECRET: a generated secret of at least 32 characters, stable between deployments
   - CORS_ORIGINS: comma-separated exact admin/app HTTPS origins, no trailing slash
   - MONGO_MAX_POOL_SIZE=5
   - ACCESS_TOKEN_TTL_MINUTES=15 and REFRESH_TOKEN_TTL_DAYS=30
   - LOG_LEVEL=warn
4. Prepare the database once, from apps/api with the production environment loaded securely:
   `npm run db:prepare`. It creates the required collections/indexes without deleting data.
   The password-auth migration removes the legacy unique phone index and marks legacy accounts
   pending without deleting users or farms. Run this before deploying password authentication.
   Repeat this step when a release adds indexes. Do not attach it to every frontend build.
5. Deploy the API. Set VITE_API_URL on the admin and EXPO_PUBLIC_API_URL on the user website to
   the API's HTTPS origin (no /v1), then deploy those projects. Frontend variables are embedded
   at build time: redeploy after changing them. Never put credentials in public variables.
6. Test /health, the frontend sign-in screens, and direct navigation/refresh on nested routes.
   Test registration, approval, login, refresh persistence, farm creation, ownership transfer,
   and offline synchronization. Keep preview deployments separate from production data.

The configs include SPA rewrites for deep links. Farm/account API responses use private,
no-store caching. Only explicitly configured frontend origins receive CORS permission.

Share https://nasl-app.vercel.app and https://nasl-admin.vercel.app with users. A deployment's
generated Vercel URL is a separate browser origin, even when it serves the same production build.
If that URL must also work, verify its project and production target with `vercel inspect`, add
its exact HTTPS origin to the API's CORS_ORIGINS, and redeploy the API. Environment changes do
not update an already-running deployment. Never allow every vercel.app domain or every preview.
Check the registration preflight from each supported origin after deployment: OPTIONS
/v1/auth/register with Origin, Access-Control-Request-Method: POST, and
Access-Control-Request-Headers: content-type must return Access-Control-Allow-Origin matching
that origin. An unrelated origin must receive no such header.

## User registration and administrator invitations

Farm users register only in the user app. Accounts stay pending until an administrator approves
them in Admin > Users. Public registration cannot set approval, seed markers or staff privileges.
The admin website offers sign-in and invitation acceptance, with no self-registration form.

For a fresh database, create the first administrator from apps/api with the database environment
loaded securely and ADMIN_APP_URL set to the exact HTTPS admin origin:

```bash
node --env-file-if-exists=.env --experimental-strip-types scripts/seed-first-admin.ts \
  --email operator@example.com --username operator --name 'Platform Operator' \
  --output /private/local/path/admin-setup.json
```

The seed creates an approved administrator without a default password. The private file (0600)
contains a one-use, 24-hour password-setup URL. Have the operator open it and choose a password.
The script is idempotent, never resets an active password, and refuses to overwrite an existing
ordinary account. Use --reissue with a new output path to replace a lost or expired unused link.
When the intended first operator already has an account, a database operator may explicitly
adopt that exact account and audit the role change. No automatic email-based promotion exists.

Subsequent administrators must receive and accept an email invitation from Admin > Users >
Administrator invitations. Configure these API production variables to enable delivery:

- ADMIN_APP_URL=https://nasl-admin.vercel.app
- RESEND_API_KEY: a restricted sending key, saved privately as a Vercel secret
- ADMIN_INVITE_FROM: an address on your verified sending domain

Resend's free transactional tier is sufficient for the pilot. Do not enable paid upgrades.
Its resend.dev testing sender cannot deliver to arbitrary recipients; verify your own domain
before inviting other administrators. Without sender configuration, the UI disables sending
and the API returns email_not_configured. It never pretends an email was sent. Sender failures
leave no usable invitation. There is no SMS dependency or paid authentication provider.

Invitation URLs keep their random token in the fragment, not a query parameter. Only its hash
is stored; tokens expire in 24 hours, are revocable and redeem once. Recipient email is fixed.
Existing accounts must provide their current password to accept an admin invitation, which
prevents an unverified pre-registration from retaining a password after someone else accepts.
Creating, accepting and revoking invitations is audited; production acceptance and audit writes
are transactional. Revoking an invitation does not revoke an already accepted administrator.
Use scripts/grant-platform-admin.mjs <email-or-username> --revoke to revoke existing staff access;
the script no longer grants access. Ordinary farm permissions are unchanged by staff revocation.

Passwords use salted scrypt (N=32768, r=8, p=3). Account status is checked on API requests and
renewals; sessions renew for 30 days. Self-service password recovery is not implemented.
Legacy phone-only records are preserved but cannot authenticate; transfer farms to the person's
new approved account using the admin ownership controls when needed.

## Installable apps and appearance

Both sites include a web manifest, home-screen icons and a service worker. No paid hosting or
app-store account is needed. Open the canonical HTTPS site and choose **Install app**. Supported
browsers show their installation prompt; on iPhone/iPad use Safari > Share > Add to Home Screen.
The admin app has a distinct icon/name so the two installations are easy to distinguish.

Each production build generates a versioned cache containing only that site's static assets.
After the first successful online load, the user app can reopen offline and use its existing
local records/outbox. Authentication, registration and administrative operations still require
the API. The service worker never caches API responses or writes. Updates wait until old tabs
close; they never force a reload during data entry or delete the existing record/outbox storage.
The admin shell can reopen offline and explain that the session is retained while disconnected.

**Appearance** offers System, Light and Dark on sign-in and in Settings (user app) or the sidebar
(admin). The choice is saved on that device/browser, separately for each origin. System follows
the device preference. Theme changes preserve forms and navigation state. Native app screens use
the same palettes, but native builds and device installation remain a separate validation step.

The PWA icons reuse the existing Material Design Icons sheep/account-shield glyphs from
@expo/vector-icons (Apache-2.0); no external image requests are made at startup.

## Optional custom domain

The existing vercel.app addresses are free and support installation. A custom domain is optional.
Register it in the operator's own registrar account, enable two-factor authentication and
auto-renewal, and keep recovery details current. Buying hosting or transferring the domain to
Vercel is unnecessary. A name is not reserved until registration succeeds.

After registration:

1. Add the apex domain to nasl-app, admin.<domain> to nasl-admin, and api.<domain> to nasl-api.
   Enter the exact DNS records Vercel shows for each project and wait for verification/HTTPS.
2. Add the exact new frontend origins to API CORS_ORIGINS, preserving the existing supported
   origins during migration. Set ADMIN_APP_URL to the new admin origin. Redeploy the API.
3. Set VITE_API_URL and EXPO_PUBLIC_API_URL to the new HTTPS API origin and rebuild both sites.
   Check login, registration preflight, invitation links and nested-route refresh.
4. Use the apex as the shared user-app address and redirect www to it after verification.
   Before redirecting an existing app origin, have users synchronize pending changes there:
   browser sessions, local records, outboxes and PWA installations do not transfer across origins.
   Users sign in and reinstall on the new domain. Keep the old origin usable during this transition.

## Validation

Run npm run check and npm test. Build the admin with npm run build -w @nasl/admin and the user
website with npm run build:web -w @nasl/mobile after npm run build:packages. Verify the exported
sites in a browser; Metro development mode alone does not verify production behavior. npm test
includes service-worker cache isolation/offline-fallback tests. Check theme persistence, install
instructions, manifest/icon responses and offline reopening against exported builds; development
servers do not generate the production service worker.

## Sources

- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Vercel monorepos](https://vercel.com/docs/monorepos/monorepo-faq)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Expo web publishing](https://docs.expo.dev/guides/publishing-websites/)
- [Atlas free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [Atlas and Vercel](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

- [Resend free pricing](https://resend.com/pricing)
- [Resend test-domain restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
