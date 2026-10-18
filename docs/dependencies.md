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

## Security updates and scoped overrides (18 October 2026)

The lockfile updates `shell-quote` to 1.12.0, `compression` to 1.8.2, `source-map-js` to 1.2.2,
and both `brace-expansion` branches to 1.1.21 / 5.0.12. These are compatible releases fixing
the advisories reported by the audit without changing the Expo or React Native versions.

Only `xcode` overrides `uuid` to 11.1.1. This fixes
[missing buffer bounds checks](https://github.com/advisories/GHSA-w5hq-g745-h8pq) while retaining
the CommonJS `uuid.v4()` API used by its project writer. The dependency compatibility test runs
through the actual Xcode project ID generator. Remove this override when the upstream `xcode`
dependency range includes a patched release; do not move to an ESM-only UUID major blindly.
Application identifiers continue to use `crypto.randomUUID()`.

## Remaining upstream advisories

The audit is **not clean**. It reports dependent packages as well as the following three root
advisories, so its package count is larger than this table. Recheck these before an Expo SDK
upgrade and whenever upstream patched releases become available.

| Package                                                                     | Path / impact                                                                     | Why it remains                                                                                                                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`decode-uri-component`](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | `query-string` in Expo Router; malformed external URLs can stall decoding         | The patched 0.5.0 is ESM-only, but `query-string` 7 calls it as a CommonJS function. A direct override breaks that API. Resolve through a compatible router/SDK upgrade. |
| [`braces`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)               | Metro/micromatch build tooling; deeply nested glob patterns can exhaust the stack | No patched release is published. The app does not accept user-supplied build patterns.                                                                                   |
| [`node-forge`](https://github.com/advisories/GHSA-86w9-cpqp-85rv)           | Expo CLI and code-signing tooling; RSA signature validation flaw                  | No patched release is published. Application authentication uses Node crypto, not this dependency.                                                                       |

Do not apply `npm audit fix --force` indiscriminately: it proposes an Expo downgrade for the
unpatched tooling dependencies and a different Expo Router major for the decoder. This audit
does not establish that every transitive dependency is safe or that these issues are unreachable
in every native/update configuration.
