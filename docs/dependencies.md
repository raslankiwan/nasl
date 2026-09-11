# Dependency decisions

Notes on choices that are not obvious from `package.json`, so they are not re-litigated or
accidentally reverted.

## One React, pinned exactly

`overrides` in the root `package.json` pins `react` and `react-dom` to the exact version Expo
ships for the current SDK. React's hooks live in module-scoped state, so two copies in one tree
makes every hook read `null` internals — which is how this first showed up: the admin console's
tests died with `Cannot read properties of null (reading 'useState')` after the mobile app was
added, because `react-dom` had pulled a newer React to the workspace root.

The pin follows the **native** runtime, because that is the constraint with no give in it: React
Native peer-depends on a specific React, while the web app is happy with anything in the major.
The admin console additionally sets `resolve.dedupe: ['react', 'react-dom']` in its Vite config.

When the Expo SDK moves, update the override to whatever the new SDK pins, not to latest.

## Two TypeScript majors, deliberately

`apps/mobile` is on the TypeScript that Expo SDK 57 ships (6.x); everything else is on 5.7. Each
workspace runs its own compiler, so this is fine — but it does constrain dependency choices:
`react-i18next` v15 declares an optional peer of `typescript@^5` and cannot be installed
alongside TypeScript 6. The whole workspace is therefore on `i18next` 26 / `react-i18next` 17,
whose peer range is `^5 || ^6 || ^7`.

## Known audit findings we are not "fixing"

`npm audit` reports two moderate advisories, both reached through the Expo toolchain. In both
cases `npm audit fix --force` is a **downgrade**, not an upgrade, and would be far more dangerous
than the advisory:

| Advisory                                                                | Reached via                          | What `--force` would do             |
| ----------------------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| `decode-uri-component` — DoS on malformed input                         | `query-string`, inside `expo-router` | Downgrade `expo-router` 57 → 5.1.11 |
| `uuid` — missing buffer bounds check in v3/v5/v6 when `buf` is supplied | `xcode`, an iOS build-time tool      | Downgrade `expo` 57 → 46.0.21       |

Neither is reachable from code we wrote: we mint identifiers with `crypto.randomUUID()`, not the
`uuid` package's buffer API, and `xcode` never ships inside the app. The `decode-uri-component`
path is in the router and would need an attacker-supplied deep link to reach.

Re-check these when the Expo SDK next moves; they should clear on their own.
