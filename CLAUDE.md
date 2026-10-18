# Nasl — Agent Guide

Arabic-first, offline-first flock management for Palestinian sheep and goat farms. An Expo app for
the herder, an internal operations console, and one API behind both.

**Read `docs/scope.md` and `docs/roadmap.md` before planning anything.** They carry decisions that
are expensive to rediscover — a competitor teardown, numbered requirements, the data model, and a
record of every bug found and why it happened. This file is the map and the rules that hold
everywhere.

## The map

| Path              | What it is                                      | Stack                                  |
| ----------------- | ----------------------------------------------- | -------------------------------------- |
| `apps/api`        | The server — REST, tenant-scoped, offline sync  | Express 5, Mongoose 8, zod, pino, jose |
| `apps/mobile`     | The product — works with no signal              | Expo SDK 57, RN 0.86, Expo Router      |
| `apps/admin`      | Internal ops console (not for farm owners)      | Vite 6, React 19, TanStack Router      |
| `packages/shared` | The domain. Pure, no I/O                        | TypeScript only                        |
| `packages/i18n`   | Both catalogues, dates, direction               | i18next 26                             |
| `docs/`           | Scope, roadmap, hosting costs, dependency notes | —                                      |

## Commands

```bash
npm run dev -w @nasl/api      # :4000  (needs a local mongod and apps/api/.env)
npm run dev -w @nasl/admin    # :5174
npm run web -w @nasl/mobile   # :8081  — the app in a browser

npm run check                 # typecheck + eslint + prettier --check. Must pass.
npm test                      # every workspace
```

Farm users register with email, username and a password (12-128 characters); accounts verify their email and remain
pending until approved in Admin > Users. The admin console has no self-registration.
Administrators join only through an existing administrator's email invitation. The first admin
is created with `apps/api/scripts/seed-first-admin.ts`, which writes a private one-use setup link
instead of inventing a password. Existing first-operator accounts may be adopted explicitly by
the database operator, with an audit record, never through public signup or automatic email matching.
Tests seed approved fixtures and exercise real login; no public development bypass exists.

## Non-negotiables

Never weakened to make a change land.

**The three that can hurt someone**

- **Withdrawal periods** are curated from manufacturer datasheets, never invented, never editable
  by farm users. Overlapping treatments always **widen** the restriction, never shorten it. The
  gate is enforced on the sale as well as on the status change.
- **Health protocols** suggest, never prescribe. Every protocol cites its source in both languages
  and ships with a disclaimer. Ministry-campaign vaccines are marked `deliveredBy: 'official'` and
  get no "record as given" button. Routine worm dosing stays off by default — calendar dosing
  breeds resistant worms.
- **Zakat** is a calculation with a disclaimer, never a ruling. Needs scholar review before it
  ships.

**Tenancy**

- Every tenant-scoped read and write goes through `TenantRepository`, which strips a
  caller-supplied `farmId` and applies its own last. One forgotten `farmId` leaks another farm's
  flock — silent, and fatal for trust. Every collection gets an isolation test.

**Language**

- `packages/i18n/src/locales/en.ts` is the structural source of truth; `ar.ts` is typed against it
  as `Translated<Catalogue>`, so a missing or misspelled Arabic key is a **compile error**. Arabic
  ships complete or it does not ship.
- Direction is derived, never hard-coded. Logical properties on the web; `I18nManager.forceRTL`
  plus a restart on native. An Arabic date and a Latin code go in separate `<Text>` nodes — one
  bidi run scrambles the date.
- A tag number is an identifier, not a quantity. Never run it through a number formatter.

**Data**

- Events are immutable; state is derived. A correction is a new event, and repro state is
  recomputed by total replay that skips impossible transitions.
- Ids are minted on the device before any network attempt and travel with the record whether it
  goes now or waits in the outbox for days. That is what makes a retry safe.
- Domain logic that both the server and the phone need lives in `packages/shared` and has exactly
  one implementation. Alerts, the repro state machine, lactation, growth and protocol scheduling
  are all there, so the two can never quietly disagree.

**TypeScript**

- No parameter properties — Node's type-stripping cannot handle them, and an ESLint rule enforces
  it. Relative imports carry `.ts` extensions.

## Working rules

1. **Read before writing.** Match the local style even where you would do it differently.
2. **Smallest change that solves it.** No abstraction for a single use case.
3. **Verify in a browser, not only in tests.** Several of the worst bugs in this repo's history
   were invisible to the test suite: a farm that predated a field ran no vaccinations at all, and
   opening the app with the server unreachable signed the user out and destroyed their tokens.
   Run the API, open the app, click the thing.
4. **Report honestly.** Name the check that passed and the one you did not run.
5. **Commits are prose.** The subject says what changed, the body says why, and a deliberate
   trade-off is written down rather than left for someone to rediscover.

## Settled — do not reopen without asking

- The web console is for **internal operations**, not farm owners.
- **Palestine first.** ILS, `Asia/Hebron`, Levant breeds. The Saudi نما / سجل مربي compliance
  angle is retired.
- **Sheep and goats.** Camels and cattle are a configuration change, not a rewrite.
- The flock is **dual purpose** — lambs and milk — with per-ewe yield on **test days**.
- Milk is sold raw, made into cheese, or made into yogurt; a fourth route, kept for the house,
  carries no price.
- **EAS builds and the device performance pass come last**, after feature work.
- Auth uses email/username and password, with mandatory admin approval before login. Do not plan around MongoDB Atlas Device Sync — EOL Sept 2025.

Credentials live in `apps/api/.env` and EAS secrets. They are never pasted into a chat; an
assistant only needs to know which provider, never the values.
