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
- Password login and manual account approval need no SMS, email delivery service or paid auth provider.

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

## Register and approve accounts

1. Register on the app or admin website with name, email, username and a password of 12-128
   characters. No tokens are issued. The account stays pending until approved.
2. Bootstrap the first administrator only after the intended person has registered. From
   apps/api with production environment variables loaded securely, run:
   `node --env-file-if-exists=.env scripts/grant-platform-admin.mjs <email-or-username>`.
   Verify the registered account belongs to the intended operator before granting access.
   This approves that existing account and grants staff access, with an audit record.
3. Sign in to Admin > Users, filter for pending accounts, open the user, and choose Approve or
   Reject. Approved users can sign in with either their email or username and password.
4. To revoke staff access use the same CLI with `--revoke`. This does not remove farm membership.

Passwords use salted scrypt (N=32768, r=8, p=3), never plaintext. New registrations cannot set
approval or staff privileges. Login failures are limited by account and IP across API instances.
Account status is checked for protected API requests and token renewal. Existing sessions renew
for 30 days. No email is sent; operators review the pending queue manually. Self-service password
recovery is not implemented in this pilot. Phone/OTP endpoints and SMS provider configuration
have been removed. Legacy phone-only records are preserved but cannot authenticate: transfer
farms to the person's new approved account using the admin ownership controls when needed.

## Validation

Run npm run check and npm test. Build the admin with npm run build -w @nasl/admin and the user
website with npm run build:web -w @nasl/mobile after npm run build:packages. Verify the exported
sites in a browser; Metro development mode alone does not verify production behavior.

## Sources

- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Vercel monorepos](https://vercel.com/docs/monorepos/monorepo-faq)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Expo web publishing](https://docs.expo.dev/guides/publishing-websites/)
- [Atlas free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [Atlas and Vercel](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
