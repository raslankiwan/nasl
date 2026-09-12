# Hosting, auth and what it costs

Written 2026-09-12, when the question was "what is the cheapest way to put this in front of real
farms". Prices move; the shapes below do not.

## The shape of the thing

Three deployable pieces, and they do not all want the same host:

| Piece         | What it is                         | What it needs                        |
| ------------- | ---------------------------------- | ------------------------------------ |
| `apps/api`    | Express 5 + Mongoose, long-running | A process that stays up, and MongoDB |
| `apps/admin`  | Vite + React, static build         | Any static host or CDN               |
| `apps/mobile` | Expo / React Native                | App stores. Not hosted at all        |

Only the admin console is a website. The mobile app is the product, and it talks to the API
directly.

## Vercel

Fine for `apps/admin` — a static Vite build is exactly what it is good at.

**Two things to know before committing to it.**

First, **Hobby is non-commercial only**. Vercel defines that broadly: taking payments, being paid
to build or host, and advertising a product all fall outside it. A flock-management product
intended to be sold is a commercial use, so the free tier is for the prototype and nothing after
it. Commercial means Pro, at **$20 per user per month**.

Second, Vercel is a poor fit for `apps/api`. The API is a long-running Express server with a
Mongoose connection pool; Vercel runs serverless functions, which means cold starts, a new
connection per invocation, and a rewrite of `server.ts` into a handler. Possible, and not worth
doing to save a few dollars.

## Where the API should actually run

| Host        | Free tier                     | Cheapest real tier               | Notes                                                  |
| ----------- | ----------------------------- | -------------------------------- | ------------------------------------------------------ |
| **Render**  | Yes, sleeps after 15 min idle | $7/mo Starter                    | The only one here with a genuine free tier and no card |
| **Railway** | None                          | $5/mo Hobby                      | One-click Mongo included in usage credits              |
| **Fly.io**  | None for new accounts         | ~$2/mo for shared-cpu-1x / 256MB | Cheapest if you are comfortable with the tooling       |

**The sleep penalty matters more here than it usually does.** A herder opening the app in a pen
with one bar of signal, waiting fifty seconds for a cold start, will decide the app is broken. The
offline layer covers reads from cache, but a sign-in cannot be served from cache. Free tier for
development; **$5–7/month before anyone real uses it.**

MongoDB: **Atlas M0 is free at 512 MB** and is genuinely enough for the first farms — this schema
is small and text-only. Photos will need object storage and are the first thing to outgrow it.

## Clerk

Free to **50,000 monthly active users** (raised from 10,000), then $25/month plus $0.02 per user
above 50k. That is not the deciding number for us.

**What is:** the phone + OTP flow is already built and tested — `apps/api/src/auth/` is 300 lines,
with challenge expiry, attempt limits, rate limiting, refresh-token rotation and device binding,
and it survives the app opening with no signal. Adopting Clerk means deleting that and rebuilding
the mobile session layer around their SDK.

Three things to weigh:

- **SMS is billed separately either way.** Clerk does not make Palestinian SMS delivery free, and
  SMS to Palestinian numbers is the actual recurring cost of phone authentication.
- **Phone-first is the whole point here.** A Palestinian herder has a phone number, not an email
  address and not a Google account. Clerk does phone/OTP, but its value is mostly in the things we
  do not need: social login, organisations, hosted UI in English-first layouts.
- **Arabic and RTL are ours to get right.** Every string in this product is in two languages with
  the Arabic typed against the English so a gap fails the build. A hosted sign-in UI is the one
  screen that would sit outside that.

**Recommendation: keep what is built.** Revisit Clerk if the web console ever needs to serve farm
owners rather than our own operations team (open question Q1), because that is where social login,
password reset and organisation management start to matter.

## What this costs to start

|                                                | Monthly                      |
| ---------------------------------------------- | ---------------------------- |
| API on Render free / Fly shared-cpu            | $0–2                         |
| MongoDB Atlas M0                               | $0                           |
| Admin console on Vercel Hobby (prototype only) | $0                           |
| SMS                                            | Per message, from first user |
| Apple Developer Program                        | $99/year                     |
| Google Play, one-off                           | $25                          |

**Under $5/month plus SMS until there are real users**, and the store fees are unavoidable and
unrelated to hosting. The first thing that will actually cost money is SMS, then a paid API tier
the moment sign-in latency matters — not Clerk, and not Vercel.

## Sources

- [Vercel pricing](https://vercel.com/pricing)
- [Clerk pricing](https://clerk.com/pricing)
- [Clerk free plan change to 50k MAU](https://saasprices.net/blog/clerk-free-plan-changes)
- [Platforms with a real free tier for developers in 2026 — Render](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [Render vs Railway vs Fly.io: pricing compared](https://hostim.dev/blog/render-vs-railway-vs-fly-pricing/)
