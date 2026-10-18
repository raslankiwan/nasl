# Delivery plan

## Password visibility and minimum length (18 October 2026)

- [x] Both login pages provide accessible show/hide password buttons, hidden by default. The
      same controls cover mobile registration and administrator invitation/setup fields.
- [x] New passwords require 8–128 characters through the shared credential policy. Arabic and
      English hints match; registration and first-admin setup tests cover the 7/8-character boundary.

## Device sign-in, email verification and 90-day sessions (18 October 2026)

- [x] Web/PWA passkeys in both apps use the device platform authenticator (Face ID, fingerprint,
      or screen lock). Enrollment requires the current password and approved-account access.
      Five-minute, single-use challenges bind purpose, account where applicable, device and exact
      allowed origin. Each app hostname has its own RP ID; no wildcard Vercel RP is trusted.
      Verification checks signatures and user verification with SimpleWebAuthn. Users can list and
      remove their own keys in Settings / Sign-in and security; password login remains available.
- [x] Native sessions migrate from AsyncStorage into SecureStore. Opt-in biometric unlock covers
      the app at startup and on backgrounding without unmounting unfinished capture forms. The OS
      can use the device passcode fallback. This is local session unlock; after expiry/sign-out,
      native users sign in with their password. Face ID permission is configured for native builds.
- [x] New registrations require a six-digit emailed code (15 minutes, five guesses, one minute
      between sends). Only an HMAC is stored. Verification never approves or signs in an account;
      admins cannot approve until the email is verified. Public resend supports interrupted signup.
      Delivery failure retains an unverified pending account for retry. Missing mail configuration
      rejects new registrations instead of bypassing verification. Existing approved accounts stay
      accessible; the preparation script marks pending/rejected non-staff accounts for verification.
- [x] Refresh sessions have a fixed 90-day deadline. Rotation retains that deadline, while existing
      valid legacy sessions upgrade on their next refresh. Access tokens remain short-lived, and
      sign-out/revocation and approval checks remain in place. No expired session is revived.
- [x] `prepare-auth-security.ts` creates credential/challenge/code indexes and TTL cleanup before
      API deployment. Production needs `RESEND_API_KEY` and a verified `EMAIL_FROM` (or the existing
      `ADMIN_INVITE_FROM`). No new paid service or database instance is required.
- [x] Tests exercise actual signed WebAuthn registration/authentication, replay/tampering/origin/
      device/expiry failures, account gates, code exhaustion/expiry/resend/delivery failure and the
      90-day boundary. Arabic phone browser checks cover code errors, Arabic digits and the pending
      approval outcome. Actual hardware biometric prompts and external email delivery still need
      a permitted device and configured sender; no simulator or emulator was launched.

## Birth timing, reminder choices and animal numbers (18 October 2026)

- [x] Sheep planning windows now span days 145–152 inclusive; overdue begins on day 153.
      Existing mating records use the new window immediately, while the stored day-147 reference
      and goat timing remain compatible with existing reproductive and health records.
- [x] Reminder checkboxes combine first day (default), 3 days before and 7 days before. Each
      selected milestone has its own delivery key; a previous reminder cannot suppress the next.
      A failed daily dispatch can catch up until the next selected milestone, never after day 145.
      Existing single 3/7-day preferences gain the first day; the retired 1-day choice becomes day zero.
- [x] One atomic number sequence per farm covers quick-add and births. Manual tags remain available;
      duplicate and archived tags are rejected, and client-ID retries return the existing animal.
      Number allocation can leave gaps after interrupted manual creation, but cannot share a number.
- [x] Births assign independent numbers and retain dam/sire links; assigned numbers are stored in
      the birth response/history. The roster shows a mother badge, and details link to her profile.
      Mothers outside the active roster remain available through the offline cache.
- [x] Production birth writes use a transaction covering number allocation, children, the birth,
      lactation and mother state. Tests cover duplicate litter tags, concurrent retries, and rollback
      after a simulated failure. Standalone development Mongo prevalidates tags; transactions require
      a replica set, as provided by Atlas and the dedicated transaction tests.
- [x] A pull that overlaps a birth commit no longer hides some twins. Successful captures request
      a fresh pull after any in-flight read; incremental reads overlap the previous cursor by five
      minutes to cover transaction timestamps assigned before commit. Empty outbox retries do not
      add farm reads. Regression tests cover overlap recovery and the post-write refresh.
- [x] Browser checks with a temporary replica-set API cover automatic creation, blocked duplicate
      tags, two twin births appearing immediately, mother badges/profile/pedigree links, and all
      three reminder checkboxes in Arabic and English. OS push delivery still needs a permitted
      installed device; no simulator or emulator was launched.
- [x] Run `apps/api/scripts/prepare-animal-numbers.ts --apply` with the production environment
      before deploying the API. Its read-only default checks historical conflicts; applying creates
      indexes without renumbering animals. Existing partial indexes may coexist until later cleanup.

## Repository refactor and reliability audit (18 October 2026)

- [x] Mobile refresh propagates network, 429 and server failures without converting them to a
      rejected session. Browser tabs coordinate token rotation; delayed refreshes cannot undo
      sign-out. Sign-out revokes the refresh session and forgets every accessible farm cache.
- [x] Capture writes reach durable storage before HTTP. Serialized queue mutations prevent lost
      concurrent saves; retry counts never delete records. Permanent rejections pause automatic
      retries, and unsent work is bound to its author. Older unowned records require explicit
      recovery by a user with access to the farm. Full/unreadable storage reports failure.
- [x] Read sync pages by timestamp and id, preserves the cursor until the complete response, and
      filters financial collections by permission. The unused generic `/sync/push` model-upsert
      endpoint now responds 426 without modifying records: the shipped app already sends its
      outbox through validated capture routes. Legacy clients must upgrade, not discard work.
- [x] Retrying completed single-record breeding, weight, treatment and milk captures returns the
      saved record. Capture forms keep their id across retries. This does not claim atomic recovery
      of a server crash halfway through a multi-document operation; that remains separate work.
- [x] Treatment withdrawal updates use an atomic maximum so concurrent captures cannot shorten
      an existing hold. A single-treatment retry repairs any hold missing after an interrupted save.
- [x] Animal histories reload after capture; same-day weights use the latest entry. Read-only roles no longer see animal add/edit,
      breeding, weighing, movement or treatment actions on the roster/detail. Expired withdrawal
      badges use the shared inclusive-day rule; stored history and API enforcement are unchanged.
- [x] Weighing methods and veterinary product categories are translated and correctly labeled. Admin dashboard, products and audit
      show retryable failures instead of fabricated zero totals/empty lists. Veterinary withdrawal
      inputs start blank so each curated value, including zero, must be entered deliberately.
- [x] Compatible dependency security updates and a scoped, tested Xcode UUID override; remaining
      Expo/router advisories and upgrade constraints are documented in `docs/dependencies.md`.

## Birth-window push reminders (18 October 2026)

- [x] Opt-in Web Push in the user PWA, with 1/3/7-day lead time (default 3), Arabic/English
      messages, per-device disable and a rate-limited test notification. iOS installation guidance
      is shown when opened outside the Home Screen. Native Expo push remains an EAS/device task.
- [x] One daily morning cron on the existing Vercel Hobby API sends a digest of new eligible
      pregnancies per device. Sheep use the start of day 142, not the day-147 reference. Day 142
      is a catch-up; later days and resolved pregnancies are excluded. Farm-local calendar dates
      use its timezone. Provider delivery depends on network/device permissions and synced records.
- [x] Approved users and active, unexpired farm memberships are rechecked at dispatch; animal
      reads remain tenant-scoped. Leases prevent overlapping runs; remembered pregnancy keys and
      stable notification tags suppress repeat alerts. Failed deliveries remain eligible for retry;
      expired endpoints are removed. A crash after provider acceptance can still retry the same tag.
- [x] Sign-out/opt-out removes a local notification-owner preference even offline, preventing
      queued notifications for another account from appearing on a shared device. Notification
      links select only a farm the signed-in account may access; other open forms are not replaced.
- [x] Automated coverage includes timing boundaries, tenancy, account/device ownership, revocation,
      concurrency, retries, endpoint validation, cron authorization and service-worker display/clicks.
      Browser checks cover settings at phone widths and notification navigation. Actual OS push
      delivery still requires permission and a test on the user's installed device.

## Manual numeric entry (18 October 2026)

- [x] Tap any quantity/value to enter an exact number using the large keypad, typing or paste.
      Weight, birth weight, dose, stock, milk quantities, output, revenue and test-day yield share
      the same editor; plus/minus adjustments remain available. Counts allow whole numbers only.
- [x] Manual decimals are independent of step size. Arabic/Persian digits and decimal separators
      are accepted; invalid precision and out-of-range values are explained without silently
      rounding/clamping them. Cancel preserves the value; clearing an optional field differs from zero.
- [x] The keypad retains keyboard focus between presses and reads left-to-right in both languages.
- [x] Parser/keypad tests and browser checks cover typing, touch entry, replacement, backspace,
      cancel, clear, zero, bounds and integer counts. Verified Arabic/light at 320px and English/dark
      at 390px against a temporary API/database, including saved 42.35 kg weight, 3.25 kg test-day
      yield and 199.95 revenue. Native device checks remain pending; no emulator was launched.

## Calendar selection and sheep lambing windows (18 October 2026)

- [x] All twelve editable date fields use a shared offline calendar with direct month/year
      selection, day grid, Today/Yesterday shortcuts and Done/Cancel. Event dates stop at today;
      expiry dates allow future years. Dates remain UTC calendar days and display Gregorian/Hijri.
- [x] Sheep show the requested inclusive day 142–150 planning window in the mating preview,
      animal details and Today list. Overdue starts on day 151. Shared domain logic drives both
      API and offline alerts; existing records/caches need no migration. The stored day-147
      reference and health-protocol timing remain unchanged; goats retain their day-150 estimate.
- [x] Returning from an event form refreshes the animal details, including its lambing window.
- [x] Tests cover leap days, month/year boundaries, calendar bounds, window boundaries, resolved
      pregnancies and API alerts. Browser checks cover Arabic/light and English/dark, 320px and
      390px layouts, selecting past and future leap dates, cancel, and saving a mating date.
      Native iOS/Android device checks are still pending; no simulator was launched.

## Mobile admin and farm provisioning on approval (October 2026)

- [x] Compact mobile navigation, labeled directory cards, stacked forms, larger touch targets
      and safe-area padding. Existing PWA installation/offline shell retained, with Users/Farms
      manifest shortcuts. Arabic and English checked at 320px and 390px; desktop tables retained.
- [x] Account approval offers a preselected farm-creation option with an editable name and
      species. Approval creates the free farm, links its active owner membership and sets the
      user's default farm. Existing farm access is preserved; staff can approve without a farm.
- [x] Production transactions make approval/provisioning/audit atomic. Concurrent and repeated
      requests cannot create duplicate farms; membership/audit failures roll everything back.
      The same failure paths have compensating-cleanup tests for standalone development MongoDB.
- [x] Browser validation exercised approval, the related farm/owner links and first-login farm
      access against a temporary replica set. Exported admin reopened with its static server
      unavailable. Actual iOS/Android home-screen installation remains a device check.

## Installable web apps and saved appearance (October 2026)

- [x] Both frontends have installation manifests, distinct home-screen icons and generated,
      versioned static-asset caches. API responses and writes remain outside the service worker.
      Existing offline records/outbox storage is preserved; updates do not force a reload.
- [x] System, Light and Dark preferences are available before and after login, saved per device
      and origin. Mobile screen/navigation tokens respond without remounting forms.
- [x] Arabic/English install help covers browsers without a direct install prompt. Phone-width
      browser checks verified both palettes; stopping the local servers verified offline reopening
      and the admin's retained-session connection message. Native device installation is not yet
      tested.
- [x] Fixed the shared radio control's accessibility state: a selected appearance now exposes
      checked=true rather than an unrelated selected attribute.

Export validation caught Metro reusing old transformed source and a development API setting
after source/environment changes. Production web exports now clear the bundler cache; deployment
checks inspect the generated entry bundle, not only the source or a successful build exit code.

## Authentication update (October 2026)

Email/username and password replace every phone/OTP login and registration route. New accounts
remain pending until platform staff approve them in the user directory. Approval and rejection
are audited; pending/rejected accounts cannot use access or refresh tokens. Farm owners must be
approved registered accounts. The admin console has no public signup: later administrators join through emailed invitations.
The first administrator is provisioned by a seed script or an explicit, audited database action;
claiming an email address never grants staff access. Historical OTP items below
record earlier increments and no longer describe the current authentication flow.

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
- [x] **Storage is injected, so the data-loss paths are tested.** The outbox and the cache take a
      `KeyValueStore` rather than importing AsyncStorage, which means the logic that decides
      whether a birth record survives can be exercised without a React Native runtime. 26 mobile
      tests cover it: order, deduplication by id, the attempt limit, surviving a restart, a corrupt
      store, cross-farm isolation, and the document mapping.
- [x] The cache knows nothing about HTTP. Fetching a change set is `pullFlock`'s job; the cache is
      storage and merge, which is the part worth testing in isolation.
- [ ] **Carried: SQLite — the store _inside the phone_, not the server database.** Worth saying
      plainly, because the two get conflated. The server's database is MongoDB and is not in
      question; this item is about the copy of the flock the Expo app keeps on the handset so the
      roster works in a pen with no signal, which today is AsyncStorage — a key-value store where
      reading one ewe means parsing the whole flock out of a JSON blob.
- [ ] Postgres and MongoDB are not alternatives _here_. Both are servers — a separate process
      listening on a port — and there is no such process inside an iOS or Android app. SQLite is
      the only one of the three that is a _file_ plus a library linked into the app, which is why
      every offline mobile app on both platforms uses it and why `expo-sqlite` exists.
- [ ] AsyncStorage is honest for the flocks this launches with — Palestinian holdings run to tens
      or low hundreds of head — and wrong for the commercial tier at 2,000 animals and 50,000
      events (NFR-02), where the parse cost per read stops being free. With the dependency
      injected, the swap is a new `KeyValueStore` in `storage.native.ts` rather than a rewrite.
      Treatment history is still network-only.

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

## Pens on the phone ✅

The API had pens and movements from Increment 2, but the phone could not move an animal — and
moving ewes to the drop pen before lambing is a daily job.

- [x] Pen list with live occupancy, and creating a pen from the phone
- [x] Pen detail listing who is in it, with **multi-select**: a herder does not move one ewe to
      the drop pen, they move the five that are close, so animals are tapped and moved together
- [x] Single-animal move from the animal screen, queued through the outbox like every other write
- [x] Pens are read from the network rather than cached — a farm has a handful and they change
      rarely, so being wrong offline costs a short list rather than a lost record

## Milk and lactation ✅

Answers the milk question raised when the launch market moved to Palestine, where 72.4% of sheep
are kept for milk: **both lambs and milk**, with per-ewe yield from **test days**.

- [x] Lactation opens automatically at lambing — a ewe that has lambed is in milk whether or not
      anyone has weighed her, and a separate "start lactation" step would be skipped
- [x] Lambing again closes the previous lactation on the new lambing date
- [x] Test-day recording for a group of ewes, with re-entry correcting rather than duplicating
- [x] **Fleischmann (test-interval) lactation estimation**, the method ICAR schemes use: yield
      changes linearly between tests, the first test's rate holds back to lambing and the last
      forward to drying off. A worked example gives 297 kg over 150 days, inside the 125–330 kg
      range reported for Awassi flocks in the West Bank.
- [x] Standardised 150-day yield so ewes that lambed months apart compare. A lactation cut short is
      **not** extrapolated — reporting milk she did not give would flatter a ewe who dried off
      early, and drying off early is itself the thing worth seeing.
- [x] A ewe under a milk withdrawal is recorded but **named back in the response**: the measurement
      is real, her milk must not reach the tank, and the parlour is where that needs saying
- [x] Tank collections as the flock's milk income line
- [x] **Milk in the ewe scorecard**, and in its ranking. A ewe who rears one lamb but milks well is
      not the one to cull, and ranking on lambs alone would say she is.
- [x] **Mobile test-day entry at the parlour**: every milking ewe on one screen with a stepper
      each, because the parlour is a production line and the ewe is in front of you for seconds.
      Nothing is sent until the session is finished, so a wrong entry can be corrected before it
      commits, and a ewe under a milk withdrawal is named back on screen rather than navigated
      past — whose milk stays out of the tank is the one thing that has to reach the parlour.
- [x] Tank collection capture, and her lactation on the animal screen beside her breeding record

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
- [x] **Medicine cabinet** (FR-HLT-05). Stock is held **per batch**, not per product, because the
      batch number is what a treatment record carries: a recall or a contamination investigation
      asks which animals got which batch, and a per-product total cannot answer that. Expiry,
      expiring-soon and low-stock warnings. Recording a treatment takes the dose off the shelf —
      off the named batch, or off the bottle expiring soonest, which is the one a herder reaches
      for. Unlike the product library, the cabinet is the farm's own data, so it is usable today.
- [x] **Carried, then done:** the protocol engine (FR-HLT-07) — it wanted real vaccination
      schedules, which arrived with the research below.

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
- [ ] Device DB encryption, refresh rotation, backup and restore drill

## Where the milk goes ✅

- [x] **Raw, cheese, yogurt or the house** (FR-MLK-06). A day's milk rarely has one destination,
      and those are four different prices for the same litre. `summariseDispositions` reports what
      each route earned **per kilogram of raw milk** — the only comparison that settles whether the
      vat was worth the work — and names the winner. Milk kept for the house earns nothing and can
      never win it; the route exists so that milk does not look like a recording error.
- [x] **Cheese yields are sheep yields.** ~4.5kg of milk per kilogram of pressed white cheese
      against ~1:1 for laban, because sheep milk runs ~18–19% total solids against cow's ~12%. The
      ratios only ever flag an implausible entry; the output weight stored is always what the farm
      actually made, and a flagged batch still saves. Asking the question while someone is standing
      at the vat is the point — a slipped decimal is untraceable a month later.
- [x] **Milk collected and never allocated shows as a gap**, not spread across the routes. A farm
      losing thirty kilos a week wants to be told.
- [x] Milk revenue reaches the profit and loss as its own line, read from the batch records rather
      than posted as a second transaction, so editing a sale cannot leave two numbers disagreeing.
      Plain `income` transactions were being dropped from the P&L entirely; they are counted now.

## Herd health protocols ✅

- [x] **The routine dose schedule** (FR-HLT-07), derived per animal from `@nasl/shared` — the same
      derivation on the server and on a phone with no signal, so the two cannot disagree about
      whether a ewe is owed a booster. Six protocols drawn from WOAH/FAO and regional guidance and
      narrowed to what is endemic here: clostridial and pasteurella cover, PPR, sheep and goat pox,
      Rev-1 brucellosis, FMD, and worm control. Every protocol carries its source.
- [x] **A second dose is measured from when the first was actually given**, never from a date on a
      calendar. A primary course started three weeks late is still a valid course, and telling a
      farm otherwise would have them start it again.
- [x] **Routine worm dosing is off by default.** Treating the whole flock on a calendar is how a
      flock breeds resistant worms; the guidance is to dose on faecal egg counts and condition.
      Switching it on is a deliberate act.
- [x] **Four of the six are ministry campaigns**, marked `deliveredBy: 'official'`. Rev-1 in
      particular is a live zoonotic vaccine restricted to young females and given once in a
      lifetime by the veterinary service. The app says a dose is due and unrecorded. It does not
      tell anyone to inject anything, and the disclaimer travels with every response in both
      languages.
- [x] Tasks are grouped by dose, not listed per animal. Eighty lines saying "pre-lambing booster"
      is a list nobody reads; "24 ewes, booster due this week" is a job.
- [x] A worker or a visiting vet can see the schedule and cannot change it — new `farm:manage`
      permission. Switching off a brucellosis reminder is a management act.

### The bug this found

Opening the schedule on a farm created **before** this shipped showed an empty list — where a
flock of fifteen was seven doses overdue. A Mongoose schema default only applies when a document
is created, and a lean read does not hydrate defaults either, so `protocolIds` was simply absent
on every existing farm and `protocolIds ?? []` read that as _this farm has chosen to run nothing_.
Never chose now means the defaults; an empty array is still a choice and is still respected. Both
cases have a test.

Two smaller things the browser caught and the tests could not: the protocol sources were
English-only, which is no answer at all for the Arabic-first half of the product, and the
produced-weight field opened at the exact expected yield — 21.11 kg — which is not a number
anyone wants to step up from.

**346 tests** across the four packages — 198 API, 107 shared, 26 mobile, 15 admin — and verified
end to end against a live API with the app running in Arabic.

## Last — ship

Deliberately after the feature work. Both of these are about a build going to real phones, and
neither tells us anything about whether the product is right.

- [ ] Performance pass against NFR-02 on a mid-range Android
- [ ] EAS build pipeline, staged rollout
- [ ] Store listings, Arabic-first screenshots

---

**Open questions that can change this order** — see scope §14. The largest is **Q1**: whether the
web console is for our operations team or for farm owners. Increment 3 assumes the former.
