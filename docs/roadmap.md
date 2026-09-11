# Delivery plan

Incremental. Each increment leaves the repo green — `npm run check && npm test` passes — and is
independently reviewable. Scope references point at [`scope.md`](scope.md).

---

## Increment 0 — Foundation ✅

- [x] npm-workspaces monorepo, TypeScript strict, eslint + prettier, CI
- [x] `@nasl/shared` — species biology, dates, animal, breeds, health, roles, IDs
- [x] `@nasl/shared` — the reproductive state machine (scope §6) with 19 tests
- [x] `@nasl/i18n` — Arabic + English catalogues, typed for parity, 15 tests
- [x] RTL direction, locale resolution, Hijri + Gregorian formatting, digit systems
- [x] Product scope committed to `docs/`

## Increment 1 — API skeleton and tenancy ✅

- [x] Express 5 + TypeScript app, env parsed and validated at boot, pino logging with phone
      numbers and tokens redacted, a stable `{ error: { code, message } }` envelope
- [x] MongoDB connection, Mongoose models for `farms`, `users`, `memberships`
- [x] **Tenant repository layer** — `farmId` a required first argument on every read and write,
      injected into the filter last so a caller cannot override it (NFR-07)
- [x] 19 isolation tests: cross-farm reads, writes, deletes, a `farmId` planted in a filter or
      payload, `farmId` inside `$or`, `$where`, an empty `farmId`, soft deletion, sync pull
- [x] Phone + OTP auth: scrypt-hashed codes, attempt limit, rate limiting, identical failure
      messages so the endpoint is not a phone-number oracle (FR-ACC-01)
- [x] Rotating refresh tokens bound to a device, with family revocation on reuse
- [x] Role and permission middleware from `@nasl/shared/roles`; expired and revoked memberships
      lose access, and a non-member cannot distinguish a farm they cannot see from one that does
      not exist (FR-ACC-02)

**70 tests across the workspace.** Not yet done here, deliberately deferred: refresh-token
cleanup job, SMS provider beyond the development stub, and observability beyond request logs.

## Increment 2 — Flock registry ✅

- [x] `animals` model with the derived `repro` sub-document and the indexes the Today list needs
- [x] Unique **partial** index on `{ farmId, tagNumber }` — duplicates rejected by the database
      rather than a read-then-write, which races between two phones. Partial on live animals, so a
      culled animal's tag can be reused; scoped per farm, so two farms may share a tag (FR-REG-02)
- [x] CRUD, filters (tag prefix, name, sex, species, breed, pen, repro state, withdrawal),
      status changes, soft delete (FR-REG-01, 05, 07)
- [x] Bulk registration that reports each row, so one bad tag does not discard the pen (FR-REG-03)
- [x] Client-minted ids accepted on create, ready for offline capture
- [x] Parentage validation: dam female, sire male, parent born first, parent on the same farm,
      no animal its own ancestor, cycle detection depth-capped (FR-PED-05)
- [x] Ancestor tree to 6 generations and descendant listing (FR-PED-01, 02)
- [x] `groups` and `movements` — pens with head counts, bulk moves writing immutable history,
      occupied pens protected from deletion (FR-GRP-01, 02, 05)
- [x] Reference libraries for breeds and diseases served from `@nasl/shared`
- [x] **Withdrawal enforcement on sale and slaughter brought forward from Increment 7** — the
      status change is the moment an animal would leave the farm as meat, so the check belongs
      here rather than being bolted on later (FR-HLT-03)

**95 tests across the workspace.**

## Increment 3 — Admin console ✅

Built as the **internal operator console** — see Q1 in scope §14. That remains the open question;
if the intent was a farm-owner console, this increment moves and the backend is unaffected.

Backend

- [x] `isPlatformAdmin` on users, `requirePlatformAdmin` answering **404 rather than 403**, so the
      console is not advertised to farm users
- [x] Append-only audit log; every privileged write records actor, before, after and a reason
- [x] Tenant directory with live head counts, farm detail with members (FR-ADM-01)
- [x] Plan changes require a written reason (FR-ADM-02)
- [x] DB-backed veterinary product library; withdrawal figures require a cited source, and every
      change is audited (FR-ADM-03, FR-ADM-06)
- [x] `scripts/grant-platform-admin.mjs` — there is deliberately no API path to the first admin

Console

- [x] Vite + React 19 + TanStack Router + TanStack Query
- [x] i18n wired to `@nasl/i18n`; `lang`/`dir` set on `<html>` **before first paint**
- [x] **Language toggle** on every screen including sign-in, naming the other language in its own
      script so a reader who cannot read the current interface can still leave it
- [x] Phone + OTP sign-in, token refresh with a single in-flight refresh, sign-out
- [x] Dashboard, farm directory, farm detail, product library, audit log
- [x] Direction-agnostic CSS: logical properties throughout, no `.rtl` class, no mirrored sheet
- [x] Workspace packages aliased to source in both Vite and tsc, so a stale `dist` can no longer
      masquerade as a missing translation

Reference-data curation for breeds and diseases is still served from `@nasl/shared` seeds rather
than the database; only veterinary products are curated so far.

**119 tests.** Verified end to end in a browser against a live API and MongoDB.

### Three bugs this increment surfaced, all now covered by tests

1. `mongoose.set('sanitizeFilter', true)` rewrote `{ _id: { $in: [...] } }` into an equality check
   against the operator object and turned the tenant directory into a 500. The tests could not
   catch it because the test harness connected without the server's mongoose settings — that
   fidelity gap was the real bug, and the harness now shares one `applyMongooseSettings()`.
2. The router was built inside a component with an inline handler among its dependencies, so it
   was replaced on every render and never settled on a match. The page went blank with nothing
   thrown and nothing logged. A shell smoke test now asserts the navigation renders.
3. A signed-in farm user reaching the console saw an empty dashboard of zeros instead of being
   told it was not for them.

## Increment 4 — Mobile shell ✅ (one item carried)

- [x] Expo SDK 57 / React Native 0.86, Expo Router, Metro configured for the workspace
- [x] i18n wired to `@nasl/i18n`, **language toggle in settings and on the sign-in screen**
- [x] `I18nManager.forceRTL` handled properly: switching direction is a _restart_, not a
      re-render, so the app asks first rather than vanishing under the user's hands. Web applies
      immediately and needs no restart.
- [x] Phone + OTP sign-in, tokens in AsyncStorage, single in-flight refresh
- [x] Flock roster on FlashList, animal detail with both calendars on every date
- [x] Withdrawal period shown as a blocking notice on the animal, not a footnote
- [ ] **Carried to Increment 5:** add-animal form and quick-add mode (FR-REG-01, 03). The API and
      the bulk endpoint are done and tested; only the on-device form is outstanding.

Verified in a browser through Expo's web target: Arabic RTL by default, Umm al-Qura dates beside
Gregorian, and a clean flip to English LTR with the tab bar reordering.

### Two bugs found by clicking through, both fixed

1. Tag numbers rendered as `1,001` — they were being run through a number formatter. A tag is an
   identifier, not a quantity: never grouped, never localised into other digits, and not
   necessarily numeric at all. It now prints verbatim, left-to-right, in either language.
2. The auth gate keyed on being inside the `(tabs)` route group rather than on being
   authenticated, so tapping an animal bounced straight back to the home tab.

### A dependency fault this increment exposed

Adding React Native put a second React in the tree and the console's tests died with
`Cannot read properties of null (reading 'useState')`. The workspace now pins one React through
root `overrides`, following the version Expo ships, and the whole reasoning is written down in
[`dependencies.md`](dependencies.md) along with two audit findings whose only "fix" is a downgrade
of Expo by fifty major versions.

## Increment 5 — Offline foundation

- [ ] WatermelonDB schema mirroring the server collections
- [ ] `POST /v1/sync/pull` and `/push` with the change-set protocol (scope §10)
- [ ] Client-generated IDs end to end
- [ ] Conflict handling: append-only events, last-write-wins per field on mutable documents
- [ ] Sync status UI, offline banner, queued-write indicator
- [ ] Test: 14 days offline, then a clean sync (NFR-01)

## Increment 6 — Breeding and lambing

- [ ] Mating, pregnancy check, birth, weaning endpoints, each applying the state machine server-side
- [ ] Breeding groups and paternity attribution (FR-BR-02)
- [ ] Birth flow creating lambs with dam and sire pre-linked (FR-LMB-03)
- [ ] Mobile flows for all four events, optimised for one hand in a pen
- [ ] Derived alerts: scan window, pre-lambing booster, due, overdue, weaning (FR-ALT-02)

## Increment 7 — Health and withdrawal

- [ ] `healthEvents`, veterinary product library, withdrawal computation
- [ ] **Sale and slaughter blocked inside a withdrawal window** (FR-HLT-03)
- [ ] Flock-wide "under withdrawal" view (FR-HLT-04)
- [ ] Treatment history per animal (FR-HLT-10)

## Increment 8 — Pedigree and reports

- [ ] Ancestor traversal, 4+ generations, RTL-correct rendering (FR-PED-01)
- [ ] Parentage validation: no cycles, no impossible sire/dam (FR-PED-05)
- [ ] Ewe productivity scorecard and cull list (FR-RPT-01)
- [ ] Season summary, flock composition, treatment register
- [ ] PDF and Excel export (FR-RPT-06)

## Increment 9 — Today screen and notifications

- [ ] On-device alert computation so alerts fire offline (FR-ALT-05)
- [ ] Today list as the mobile home screen (FR-ALT-01)
- [ ] Expo push, batched into a morning digest (FR-ALT-03)

## Increment 10 — Hardening and release

- [ ] Weights and growth (M6), finance basics (M8)
- [ ] Full data export (FR-RPT-07)
- [ ] Performance pass against NFR-02 on a mid-range Android
- [ ] Device DB encryption, refresh rotation, backup and restore drill
- [ ] EAS build pipeline, staged rollout

---

**Open questions that can change this order** — see scope §14. The largest is **Q1**: whether the
web console is for our operations team or for farm owners. Increment 3 assumes the former.
