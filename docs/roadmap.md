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
- [x] Quick add (FR-REG-01, 03): species and sex chosen once for the session, tag entered on a
      large custom keypad, one tap per animal, with an undo log. Nothing else is asked for — the
      rest can be filled in later, from anywhere. Duplicate tags come back as the conflict message
      with the tag retained, so it can be corrected rather than retyped.

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

## Increment 5 — Offline foundation ⬤ server half done

The server side is built and tested; the device side — WatermelonDB and the queue — is next.

- [x] `POST /sync/pull` and `/sync/push` with the change-set protocol (scope §10)
- [x] Client-generated IDs end to end
- [x] **Append-only events cannot conflict.** Two shepherds recording two treatments on the same
      ewe from two phones produce two documents, not a conflict. Only `animals` and `groups` carry
      mutable fields. Re-pushing an event the server already has is a no-op, so a retry after a
      dropped connection is safe.
- [x] **Derived state is never trusted from the device.** After a push, every affected female's
      reproductive state is replayed from her whole event stream. A device offline for weeks can
      contribute events; it cannot dictate conclusions — and it cannot clear a withdrawal the
      server applied.
- [x] The replay is _total_: an event that cannot apply is skipped and counted rather than thrown,
      because the aim is the best state the evidence supports, not an animal left with no state.
- [x] One malformed row does not strand the batch — a fortnight of records must not be lost to a
      single bad one.
- [x] Events cannot be deleted by a client. An event is evidence of something that happened.
- [x] 14 tests including: fourteen days offline then a clean sync, events arriving out of order,
      an impossible event, a stale device trying to undo a withdrawal (NFR-01)
- [x] **Durable write queue on the device.** Every capture screen mints the record's id before
      anything is attempted, writes to disk, then tries the network. A write that cannot be sent
      waits in the outbox across app restarts and flat batteries, and retries on foreground and on
      a timer. Because the id travels with the record, a retry cannot duplicate it — the server
      now accepts a client-minted id on every breeding and health event.
- [x] Sync banner: what is waiting, what is stuck, and a way to try again now. Silence about
      queued work is the failure to avoid — a herder who cannot tell whether a birth was saved
      will write it on paper, and then the app has cost them time rather than saved it.
- [x] **Local flock cache fed by `sync/pull`.** The roster and the animal screen read from the
      device first and refresh behind that, so opening either in a pen with no coverage shows the
      flock rather than a connection error. Incremental: the first pull takes the farm, every
      later one takes only what moved, and nothing is written until the whole response is in hand
      — a connection that drops mid-pull leaves the previous cursor and cache intact.
- [x] Signing out forgets the cached flock, so the next person on that phone does not see it.
- [ ] **Carried: SQLite.** The cache is AsyncStorage, which is honest for the flocks this launches
      with — Palestinian holdings run to tens or low hundreds of head. It is not right for the
      commercial tier at 2,000 animals and 50,000 events (NFR-02). The interface in `cache.ts` is
      deliberately narrow so that swap is one file. Treatment history is still network-only.

**193 tests.** Verified by taking the API down: a mating recorded on the phone queued, showed in
the banner, and flushed on its own once the server returned — leaving the ewe `mated` with the
right due date.

### The bug this found

Opening the app with the server unreachable **signed the user out and destroyed their tokens**,
because `loadMe` treated any failure as a rejected session. A herder starting the app in a field
with no signal would have been logged out, unable to record anything, with the outbox orphaned —
the exact scenario NFR-01 exists for. Only a 401 ends a session now; anything else falls back to
the profile cached on the device, and the app comes up ready to record.

## Increment 6 — Breeding and lambing ✅ (mobile capture carried)

- [x] Mating, pregnancy check, birth, weaning and abortion as **immutable events**, each applying
      the state machine from `@nasl/shared` server-side. The device and the server reach identical
      conclusions from the same events, which is the property offline sync will rest on.
- [x] Breeding groups: a mating with no named ram flags paternity uncertain (FR-BR-02)
- [x] Birth creates each live lamb with dam and sire already linked, inheriting breed and pen
      (FR-LMB-03). A stillbirth is recorded on the birth, never added to the roster.
- [x] A lamb with no tag to hand gets a provisional tag from its dam's, rather than the record
      being refused — which is how births go unrecorded.
- [x] A dam that loses the whole litter is `lambed`, not `nursing`.
- [x] Foetus counts accepted only from an ultrasound.
- [x] Derived alerts — due, overdue, nursing — computed from state rather than stored as rows, so
      they are always in step with the events and can be recomputed on-device offline (FR-ALT-05)
- [x] Mobile **Today** screen reads those alerts, overdue first (FR-ALT-01)
- [x] Mobile capture forms for mating, pregnancy check, birth, weaning and abortion. The animal
      screen offers **only the actions her current state allows** — `actionsFor` lives in
      `@nasl/shared` beside the state machine, and a property test asserts every action it offers
      is one the machine actually accepts, so a screen can never present a form that comes back
      refused.

Pre-lambing booster and scan-window alerts wait on the protocol engine in Increment 7.

**139 tests.** Verified end to end: a mating recorded by API appears on the phone as
"الولادة بعد 8 يوم" / "Due in 8 days".

### A latent production bug this increment surfaced

Two tests started failing once more models existed: duplicate tag numbers and duplicate pen names
were being accepted. Mongoose builds indexes in the _background_, so a freshly started process
serves writes before its unique indexes exist — and tag uniqueness (FR-REG-02) is enforced **by**
an index. `connectDatabase` now waits for `createIndexes()` across every model before the server
listens, the test harness does the same, and `models/index.ts` registers them all so a model no
route happens to import cannot be missed.

## Increment 7 — Health and withdrawal ✅ (medicine cabinet carried)

- [x] `healthEvents` as immutable records. Withhold dates are copied onto the event when it is
      recorded rather than recomputed later: the product library is curated and can change, and a
      treatment must be judged by the period that applied on the day it was given.
- [x] Withdrawal always **widens, never shortens** — a shorter hold from a later treatment cannot
      cancel a longer one still running
- [x] Sale and slaughter blocked inside a meat window (FR-HLT-03, brought forward in Increment 2)
- [x] **Milk given the same force as meat.** For a Palestinian dairy flock this is the gate that
      actually bites: milking happens twice a day and a treated ewe's milk contaminates the whole
      tank, where a meat hold only matters on the day she leaves. So milk leads the Today screen,
      leads the withdrawal view, and outranks the repro state on the roster pill.
- [x] The consequence is shown **before** the treatment is saved, not after
- [x] Group treatment writes one event per animal under a shared batch id (FR-GRP-03)
- [x] Flock-wide "under withdrawal" view, split by milk and meat (FR-HLT-04)
- [x] Treatment history per animal (FR-HLT-10)
- [x] Mobile treatment capture
- [ ] **Carried:** medicine cabinet — stock, batches, expiry (FR-HLT-05) — and the protocol engine
      (FR-HLT-07). Neither is worth building until the product library holds real datasheets.

**165 tests.** The library itself is still empty: the schema and the cited-source rule are built,
but real withdrawal figures are the one thing that cannot be invented.

## Increment 8 — Reports ✅ (pedigree UI and export carried)

- [x] Ancestor traversal and parentage validation shipped in Increment 2 (FR-PED-01, 05)
- [x] **Ewe productivity scorecard** (FR-RPT-01): lifetime lambings, lambs born and weaned,
      average litter size, mean lambing interval, kg weaned, assisted lambings — all derived from
      the event stream at read time rather than kept as running totals, because a total drifts and
      the number a culling decision rests on has to be one the events actually support.
- [x] **Cull signals** rather than a bare list of numbers: barren, never lambed, long since
      lambing, repeated difficult births, lost most of a litter, below the flock's litter average.
      Sorted worst-first, so the conversation starts at the top instead of the herder scanning.
- [x] Season summary — lambing percentage, weaning rate, lamb mortality, average birth weight
      (FR-RPT-02)
- [x] Flock composition by sex, species, breed, age band and reproductive state (FR-RPT-03)
- [x] Treatment register with batch numbers and withdrawal dates (FR-RPT-04)
- [x] Mobile reports tab, **gated on the permission matrix** — a worker records what happened;
      the owner decides which ewes stay, and the tab does not exist for roles without the right
- [x] **Pedigree tree on the phone** (FR-PED-01, gap G2 — no Arabic competitor renders one).
      Drawn as an indented list rather than a branching diagram: a phone is 375 points wide, a
      graphical tree stops being readable at two generations, and a buyer of breeding stock asks
      for four. Indentation runs along the inline axis, so the line of descent goes rightward in
      Arabic and leftward in English with no mirroring code. Unknown parents are shown as dashed
      placeholders rather than omitted — a gap in the record is information.
- [x] **CSV export** (FR-RPT-06): the flock register, the treatment register and the ewe
      scorecard. Headers are bilingual, parents appear as their tag rather than a uuid, and the
      file carries a UTF-8 BOM — without it Excel on Windows reads the system codepage and every
      Arabic name opens as mojibake. Cells starting with `=`, `+`, `-` or `@` are defused, because
      a tag number is user input and Excel executes those as formulas.
- [ ] **Carried:** PDF export

**192 tests.**

## Increment 9 — Today screen and notifications

- [x] **On-device alert computation** (FR-ALT-05). `deriveAlerts` lives in `@nasl/shared` beside
      the state machine and is the _only_ implementation: the server runs it over the database, the
      phone runs it over its local copy. One function, so the two cannot quietly disagree about
      whether a ewe is due.
- [x] Today list as the mobile home screen, working with no signal (FR-ALT-01)
- [ ] Expo push, batched into a morning digest (FR-ALT-03)

## Increment 10 — Hardening and release

- [x] **Weights and growth (M6).** Individual and whole-pen weighing, average daily gain between
      any two weighings, lifetime gain, and the adjusted 90-day weight that makes two lambs born
      five weeks apart comparable (FR-WGT-01…04). The arithmetic lives in `@nasl/shared` so the
      phone shows a gain without a round trip, and weights join the sync registry as append-only.
      `lastWeightKg` follows the latest weighing _by date_, not by entry order, so backfilling an
      old weight does not overwrite the current one.
- [x] **Finance basics (M8).** Sales, purchases, expenses and feed logs — deliberately not
      accounting. A herder will not maintain a chart of accounts, and the useful question is "did
      this season pay", not "does it balance". Buying animals registers them in the same action,
      because otherwise it happens twice or not at all. A feed log counts as feed spend wherever it
      was entered, so the answer does not depend on which screen was used. **The withdrawal gate is
      enforced on the sale as well as on the status change** — that is the other door an animal can
      leave through, and a sale is one act, so one blocked animal blocks the whole sale rather than
      half-completing it.
- [x] **Full data export** (FR-RPT-07) — every collection this farm owns as JSON, including the
      empty ones so the shape is predictable. The customer must be able to leave: a product that
      holds a herder's records hostage has stopped being a tool.
- [ ] Performance pass against NFR-02 on a mid-range Android
- [ ] Device DB encryption, refresh rotation, backup and restore drill
- [ ] EAS build pipeline, staged rollout

---

**Open questions that can change this order** — see scope §14. The largest is **Q1**: whether the
web console is for our operations team or for farm owners. Increment 3 assumes the former.
