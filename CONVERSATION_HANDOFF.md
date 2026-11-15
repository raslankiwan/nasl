# Nasl conversation handoff

This handoff summarizes the Codex and Claude work found on this Mac. Verify the current implementation and Git state before continuing; the recorded requests are context, not proof that a feature is complete or deployed.

## Repository

- Local checkout: `/Users/raslan/Projects/Personal/Nasl`
- Personal GitHub repository: `raslankiwan/nasl` (private)
- Stack: Arabic-first Expo mobile app, React admin, Express API, MongoDB.
- Read `AGENTS.md`, then `CLAUDE.md`, `docs/scope.md`, and `docs/roadmap.md` before changes.
- Current code is npm workspaces on Node 22. Standard checks: `npm run check`; also `npm run test` / `npm run build` as appropriate. Do not assume old setup notes about a different checkout or old default admin credentials remain valid.

## Latest open requests (Codex, Nov 2026)

1. Clear Jehad's farm content in production or leave him with an empty farm.
2. Make the count on the farm details page follow the active filter; it currently shows the unfiltered total.

The user asked for a portable handoff in the latest Nasl conversation. The existing handoff in `Documents/Codex/2026-09-29/co` says these requests were not verified as completed. For production data, first identify the exact account/farm using reliable IDs, retain the farm/account if an empty farm suffices, and inspect the exact affected records before any destructive operation. No production deletion should be inferred from the conversation alone.

## Product requirements recorded in Codex and Claude conversations

- Authentication: replace SMS/phone auth with email or username and password; registration requires email verification and admin approval; pending users cannot log in; admins join by invitation. Password minimum is 8 characters with show/hide; sessions last three months; add device biometrics where supported.
- Admin/farms: create farms, change/link owners, clickable user details with farms, invite admins, approve users and optionally create/link a farm, allow audited user impersonation with changes, mobile-friendly installable admin PWA, dark mode, installable user PWA.
- Sheep identity: per-farm automatic unique sequences: mothers `M#`, children `C#`, males on a separate sequence; separate mother/child lists; validate age before child-to-mother conversion; no pregnancy/birth while a child; reuse sequence after sale/death; support sale/death; link newborns to mothers and show the relationship. Ensure identifiers and parent-child links are farm-scoped.
- Pregnancy: 145–152 day window; notification options are multi-select for day 145, 3 days before, and 7 days before, with day 145 preselected; send push notifications. Dates should have a clear month/day/year picker; numeric inputs must support manual entry.
- UI/quality: native-feeling mobile tab navigation, fix oversized back controls and spacing, and address worthwhile product/design and code quality findings.
- Earlier infra note: check current CORS for production and preview origins; verify actual MongoDB collections and connections instead of relying on old TablePlus observations.

## Resume sequence

1. Inspect `git status`, current branches/remotes, and the implementation of the two latest requests.
2. Implement and validate the filtered count using the list's active filter semantics.
3. Treat the production-data request as a separate carefully scoped operation: verify identity and current records first, then report the proposed impact before changing production data.
4. Use current deployment settings and project instructions; do not expose credentials or claim deployment without verification.
