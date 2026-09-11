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

## Increment 3 — Admin console shell

- [ ] Vite + React + TanStack Router + TanStack Query
- [ ] i18n wired to `@nasl/i18n`, `dir` on `<html>`, **language toggle in the header**
- [ ] Auth flow, protected routes, role-aware navigation
- [ ] Farm directory and farm detail (FR-ADM-01)
- [ ] Reference data curation for breeds and diseases (FR-ADM-03)

## Increment 4 — Mobile shell

- [ ] Expo app, Expo Router, NativeWind or Unistyles
- [ ] i18n wired to `@nasl/i18n` + `expo-localization`, **language toggle in settings**
- [ ] `I18nManager.forceRTL` handled with the reload it requires — before first render
- [ ] Phone + OTP sign-in, session persistence
- [ ] Flock list with FlashList, animal detail (NFR-02)
- [ ] Add-animal form and quick-add mode (FR-REG-01, 03)

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
