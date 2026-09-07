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

## Increment 1 — API skeleton and tenancy

- [ ] Express + TypeScript app, config from env, structured logging, error envelope
- [ ] MongoDB connection, Mongoose models for `farms`, `users`, `memberships`
- [ ] **Tenant repository layer** — `farmId` a required argument on every read and write (NFR-07)
- [ ] Integration tests asserting cross-farm isolation per collection
- [ ] Phone + OTP auth, JWT access token, rotating refresh token bound to device (FR-ACC-01)
- [ ] Role and permission middleware from `@nasl/shared/roles` (FR-ACC-02)

## Increment 2 — Flock registry

- [ ] `animals` model with the derived `repro` sub-document
- [ ] Unique partial index on `{ farmId, tagNumber }` — duplicates rejected at the database (FR-REG-02)
- [ ] CRUD endpoints, list with filters (FR-REG-01, 05, 07)
- [ ] `groups` and `movements` (FR-GRP-01, 02)
- [ ] Seed reference data — breeds and diseases from `@nasl/shared`

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
