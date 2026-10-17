# NiroLearn environments — production inventory and the staging plan

Roadmap task 1.1 / decision **D1**. Written 2026-09-30 from a **read-only** look
at the repository and the local `.env` (values never printed; hosts only,
credentials masked). The production service on Railway itself was **not**
inspected — there is no Railway access from this environment — so its exact
variable list must be confirmed in the Railway dashboard (§3).

## 1. What the code needs (every `process.env` the app reads)

| Area | Variables | Used by |
|---|---|---|
| Database | `DATABASE_URL`, `DATABASE_POOL_MAX` | `lib/db.ts`, `drizzle.config.ts` (43 migrations in `drizzle/migrations`) |
| Storage (R2) | `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | `lib/storage.ts` (presigned PUT / GET, byte-range proxy) |
| Jobs (QStash) | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `APP_BASE_URL` (+ `QSTASH_URL`) | `lib/queue/client.ts` publishes to **`APP_BASE_URL`/api/queue/…**; `lib/queue/verify.ts` checks signatures |
| Queue limits | `QUEUE_MAX_ATTEMPTS`, `QUEUE_GLOBAL_CONCURRENCY`, `QUEUE_PER_USER_CONCURRENCY`, `JOB_CREATION_RATE_LIMIT_MAX`, `JOB_CREATION_RATE_LIMIT_WINDOW_MINUTES` | `lib/queue/rateLimit.ts` (DB-backed) |
| Auth | `AUTH_SECRET`, `AUTH_URL` / `NEXTAUTH_URL`, `TRUSTED_PROXY_HOPS` | `lib/auth.ts`, `lib/mobile-session.ts` (mobile tokens), `lib/db-phone.ts`, `lib/phone-signup-http.ts` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `lib/auth.ts` |
| SMS sign-up (Vonage Verify v2) | `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_BRAND`, `VONAGE_LOCALE`, `VONAGE_API_BASE`, `SMS_MAX_SENDS_PER_HOUR` | `lib/sms/vonage.ts`, `lib/db-phone.ts` — **no test mode**: unset → sign-up fails with "not configured" |
| AI | `LLM_PROVIDER`, `GEMINI_*` (key, default / fallback / vision / fast-text models, reasoning effort), `OMNIROUTE_*` (base URL, key, default / fallback / vision / fast-text models), `OPENROUTER_API_KEY`, `NVIDIA_OCR_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | `lib/ai/config.ts`, `lib/nemotron-ocr.ts`, embeddings |
| Doctor sets | `DOCTOR_SETS_ENABLED`, `QUESTION_SET_CODE_HMAC_KEY` | `lib/doctor-sets-config.ts`, `lib/question-set-codes.ts` |
| Misc | `NEXT_PUBLIC_SITE_URL`, `UPLOAD_MAX_MB`, `BILLING_TIMEZONE`, `NODE_ENV`, `PORT`, `LOG_LEVEL` | site metadata, admin upload limit, billing periods |

Not used by the code: **Redis / Upstash Redis** (`REDIS_URL` is in the local
`.env` but nothing reads it — rate limits and locks are in Postgres; the only
Upstash product in use is QStash). **WhatsApp**: no integration exists (SMS is
Vonage Verify only).

## 2. What the local `.env` points at today

| Variable | Points at | Production? |
|---|---|---|
| `DATABASE_URL` | Supabase pooler `aws-1-eu-west-1.pooler.supabase.com:5432/postgres` | **yes — the live database** |
| `STORAGE_*` | Cloudflare R2 account `2fd4…723d`, bucket **`alexmed`** | **yes — the live bucket** |
| `QSTASH_*` | `qstash-eu-central-1.upstash.io` (token + signing keys) | **yes** |
| `APP_BASE_URL` | `https://alexmed-production.up.railway.app` | **yes — production workers** |
| `REDIS_URL` | Upstash Redis `patient-gull-156600.upstash.io` | unused |
| `AUTH_SECRET` | set | presumably production's (unverified) |
| `NEXTAUTH_URL` | `http://localhost:3000` | local |
| `GOOGLE_CLIENT_*` | set | production OAuth client |
| `OMNIROUTE_*`, `OPENROUTER_API_KEY`, `NVIDIA_OCR_API_KEY`, `EMBEDDING_*` | OmniRoute on Railway, OpenRouter, NVIDIA, OpenAI embeddings | shared keys |
| Vonage, doctor-set key / flag, `AUTH_URL`, `NEXT_PUBLIC_SITE_URL`, … | **not in the local `.env`** | set only on Railway |

⚠️ **Risk found:** a local `next dev` / script run with this `.env` does not
only read production data — any job it publishes goes through production
QStash to **`APP_BASE_URL` = the production app**, whose workers then write to
the production database and bucket. Uploading or generating anything from a
local machine today is a production action. The staging plan below removes
this; until then, local runs must not upload or start jobs.

## 3. To confirm in the Railway dashboard (owner — no access from here)

Variables of the production service, compared with §1: in particular
`AUTH_URL`, `NEXT_PUBLIC_SITE_URL`, `DOCTOR_SETS_ENABLED`,
`QUESTION_SET_CODE_HMAC_KEY`, `VONAGE_*`, `TRUSTED_PROXY_HOPS`,
`DATABASE_POOL_MAX`, `BILLING_TIMEZONE`, the `OMNIROUTE_*` model lists, and
whether `AUTH_SECRET` there equals the local one. Only names / hosts need
sharing, never values.

## 4. Staging: what must be separate, and why

| Service | Staging | Why / notes |
|---|---|---|
| **Postgres** | **New Supabase project** (free tier is enough), same region as the staging Railway service | Tests must never touch real users. Fresh DB → `DATABASE_URL=<staging> npx drizzle-kit migrate` applies all 43 migrations (the tracking-table issue in memory is specific to the live DB) |
| **R2** | **New bucket** `nirolearn-staging` in the same Cloudflare account, with **its own API token scoped to that bucket only**; CORS for the staging web origin | A production key must never reach staging; a leaked staging key then can't read real files |
| **QStash** | Separate signing keys + token — a separate Upstash account/project for staging (free tier) | QStash delivers to whatever `APP_BASE_URL` a job names; separate keys stop staging and production from accepting each other's messages |
| **Redis / Upstash Redis** | **None** | Not used by the code; `REDIS_URL` can be removed from the local `.env` |
| **Railway** | New service (or environment) for staging from the same repo, its own variables, its URL as `APP_BASE_URL` / `AUTH_URL` / `NEXT_PUBLIC_SITE_URL` | Jobs from staging land on staging workers only |
| **Auth** | New `AUTH_SECRET` (e.g. `openssl rand -base64 32`), new `QUESTION_SET_CODE_HMAC_KEY` | A production session / access code must not be valid on staging, and the reverse |
| **Google OAuth** | New OAuth client (or a separate "staging" client in the same Google Cloud project) with redirect `https://<staging>/api/auth/callback/google` | Keeps production's client and consent screen untouched; the Android / iOS client IDs for G2 are created against staging first |
| **Vonage** | Optional (**paid, owner decision**): a Vonage sub-account with a low spend cap. Without it, phone sign-up can't be tested on staging — test accounts are created directly in the staging DB (seed) | Real SMS costs money and reaches real numbers |
| **AI keys** | Separate OpenRouter / NVIDIA / embeddings keys with **low monthly limits** (or the same accounts with separate keys); `LLM_PROVIDER=openrouter` (OmniRoute keys currently 401 — memory) | A staging load test must not spend production's AI budget |
| **Doctor sets** | `DOCTOR_SETS_ENABLED=true` on staging | Test the whole flow before production |
| Sentry (later) | A staging environment inside the mobile Sentry project | — |

**Seed data (synthetic only):** a student, an approved doctor and an admin
(passwords set directly, since SMS isn't needed), two folders, a small text PDF
and a scanned one, a question file, a doctor set with codes, a share between
two students. To be written as a script against `DATABASE_URL` of staging
only, refusing to run when the host matches production.

## 5. Order (each step needs the owner's accounts)

1. Owner creates: Supabase project, R2 bucket + scoped token, Upstash (QStash)
   for staging, Railway staging service, Google OAuth client; decides Vonage.
2. Fill `.env.staging` (template: `.env.staging.example`, git-ignored) and the
   Railway staging variables.
3. Apply the migrations to the staging DB; run the seed.
4. Deploy the current `main` (or this branch) to staging; smoke test on the
   web (login, upload, a job, AI answer).
5. Point the app at it: `mobile/env/staging.json` (`API_BASE_URL=https://<staging>`)
   → then the live checks blocked in P4–P14 can run.
6. Change the local `.env` to staging so local work can no longer reach
   production.
