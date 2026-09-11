# نَسْل · Nasl

**Arabic-first, offline-first flock management for sheep and goats.**

Built around the breeding female — her matings, pregnancies, lambings, medicines and line — rather
than around a herd roster. An Expo mobile app for the herder, a React web console for operations,
one Express + MongoDB backend behind both.

Dependency decisions and known audit findings: [`docs/dependencies.md`](docs/dependencies.md)

Full product scope: [`docs/scope.md`](docs/scope.md) · [PDF](docs/Nasl-Flock-Management-Scope.pdf)
Delivery plan: [`docs/roadmap.md`](docs/roadmap.md)

---

## Layout

```
nasl/
├── apps/
│   ├── api/       Express + MongoDB — one API for both clients
│   ├── admin/     React + Vite — operator console
│   └── mobile/    Expo / React Native — the herder's app
├── packages/
│   ├── shared/    @nasl/shared — domain types, species biology, the repro state machine
│   └── i18n/      @nasl/i18n  — Arabic + English catalogues, RTL and calendar helpers
└── docs/
```

npm workspaces. Node 22+.

## Commands

Run from the repo root.

```bash
npm install          # install every workspace
npm run build        # build all packages
npm run typecheck    # types across the monorepo
npm run test         # unit tests
npm run lint         # eslint
npm run check        # typecheck + lint + format check — run this before pushing
```

## Language

Arabic is the default locale, not a translation of an English original. Two rules keep it that way:

1. **`packages/i18n/src/locales/en.ts` is the structural source of truth**, and `ar.ts` is typed
   against it. A missing or misspelled Arabic key is a compile error — Arabic ships complete or it
   does not ship. A test additionally asserts key parity and that interpolation placeholders match.
2. **Direction is derived, never hard-coded.** Screens read `dirFor(locale)`; nothing assumes LTR.

Switching language is a toggle, not a menu — there are exactly two locales, and each names itself
in its own script (`العربية` / `English`).

Dates are available in both the Gregorian and Umm al-Qura Hijri calendars; the user chooses which
leads. Numbers use Western digits by default in both locales, with Eastern Arabic-Indic digits
(`١٤٧`) opt-in.

## Domain rules that are not negotiable

These are enforced in code, not by convention. See `docs/scope.md` for the reasoning.

- **Every document carries `farmId`**, and every read and write goes through a repository layer that
  takes it as a required argument. One forgotten filter leaks another farm's flock.
- **Events are immutable.** An animal's reproductive state is derived from its event stream and
  recomputed after every sync — never edited in place. This is what makes offline sync tractable.
- **IDs are minted on the device**, so a lamb recorded with no signal already has the identity its
  dam's birth record references.
- **Withdrawal periods are curated by us**, from manufacturer datasheets, and are never editable by
  farm users. An incorrect value can put treated meat into the food chain.
