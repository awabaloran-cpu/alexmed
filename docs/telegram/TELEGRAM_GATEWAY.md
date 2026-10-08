# Telegram gateway — how it works and how to switch it on

Written 2026-10-08 with the first implementation (branch
`feat/telegram-gateway`). Telegram is an **input channel**: a PDF sent to the
bot becomes an ordinary `books` row owned by an ordinary `users` row and runs
through the existing question-file / book pipelines. There is no second
viewer, no second AI pipeline and no copy of any content.

## Status

| Part | State |
|---|---|
| Code, migration `0043_telegram_gateway`, unit + PGlite tests | Done, green locally |
| Migration applied to any database | **No** — needs the owner (AGENTS.md rule 5) |
| A real bot, a real webhook, a real file end to end | **Not verified** — there is no staging environment and no test bot yet |
| 70 MB files | **Needs a self-hosted Bot API server** (below); until then the ceiling is 20 MB |
| Google AdSense | Code path ready; **needs an approved AdSense account** and the policy check below |

## Flow

```
Telegram ──► POST /api/telegram/webhook        verify secret, record the upload, reply, queue
                 │  QStash: telegram_intake
                 ▼
             POST /api/telegram/intake         bot file → storage → which kind? →
                 │                             lib/file-intake.ts (same start as the web upload)
                 │  QStash: telegram_watch (self-requeuing, delayed)
                 ▼
             POST /api/telegram/watch          reads books / coverage, edits the bot's
                                               progress message, announces the result
Button ──► /t/<token> ──POST──► /api/telegram/session ──► the existing page
```

| File | What |
|---|---|
| `lib/telegram/handler.ts` | What the bot does with one update (commands, files, buttons) |
| `lib/telegram/intake.ts` | The two queue steps and the retry button |
| `lib/telegram/accounts.ts` | Telegram user ↔ account, guests, linking |
| `lib/telegram/tokens.ts`, `web-session.ts`, `links.ts` | Link tokens and the guest web session |
| `lib/telegram/detect.ts` | Question file or book (no AI) |
| `lib/telegram/uploads.ts` | `telegram_uploads` state machine and limits |
| `lib/file-intake.ts` | The shared "admit + create row + queue" step (web routes use it too) |
| `lib/ads/policy.ts`, `components/ads/AdBreak.tsx` | Ad break rules and the break itself |
| `lib/db-question-attempts.ts` | Saved answers for question files |

## Identity

- First contact creates a **guest**: a `users` row with no phone, email or
  password, mapped in `telegram_accounts`. The Telegram id is never a user id.
- A guest gets **one file** (`TELEGRAM_GUEST_FREE_UPLOADS`). The next one asks
  them to create their account. Registering through `/register` while signed
  in as the guest **completes the same row** (`upgradeGuestWithVerifiedPhone`),
  so their file and progress stay.
- An existing student connects from **حسابي → Telegram**: a one-time code
  (10 minutes) carried to the bot in `t.me/<bot>?start=link_<code>`.
- A guest who already owns files is never merged into another account; they
  are told to register the guest account instead. A real merge is not built.

## Links and security

- `/t/<token>`: 32 random bytes, only the SHA-256 is stored, expires
  (`TELEGRAM_LINK_TTL_MINUTES`), revocable. Opening it changes nothing — the
  session starts on the confirm button's POST, which is refused from any
  other origin. So link previews and prefetches sign nobody in.
- Only a **guest** account can be entered by a link. A registered account's
  buttons open the page itself and go through the normal login. (After the
  login the student lands on `/subjects`; the file is in the "Telegram"
  folder. A return-to-file redirect after login is not built.)
- The webhook requires Telegram's secret header; workers require the QStash
  signature. No storage key, signed URL or file id ever appears in a message.
- Limits, in order: PDF only → size → already sent? → guest's free file →
  per-account burst → global daily ceiling → then, in the worker, the same
  job-creation limit and plan quota as a web upload.

## Switching it on (owner)

1. **Apply the migration** `drizzle/migrations/0043_telegram_gateway.sql`
   (five new tables + one nullable column; nothing existing is altered).
   On production follow the manual procedure used for earlier migrations.
2. **Create the bot** with @BotFather (`/newbot`). Keep the token out of chat
   and out of git. Create a second bot the same way for testing.
3. Set on the server: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `TELEGRAM_WEBHOOK_SECRET` (a long random string), `TELEGRAM_ENABLED=true`.
4. **Register the webhook** once (replace the placeholders; run it yourself):

   ```bash
   curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<your-domain>/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     -d 'allowed_updates=["message","callback_query"]' \
     -d "drop_pending_updates=true"
   ```

5. Send `/start` to the bot, then a small PDF.

A test bot must point at a **staging** deployment with its own database,
bucket and QStash (docs/mobile/ENVIRONMENTS.md §4–5). Pointing it at a local
machine with the current `.env` would write to production.

## Files above 20 MB

Telegram's cloud Bot API does not let a bot download a file above 20 MB
(core.telegram.org/bots/api#getfile). `TELEGRAM_MAX_FILE_MB=70` therefore only
takes effect with a self-hosted Bot API server
(github.com/tdlib/telegram-bot-api, needs an `api_id` / `api_hash` from
my.telegram.org) and `TELEGRAM_API_BASE` pointing at it. Without it the bot
refuses larger files and offers the web upload page instead.

Two more limits apply to a large file regardless of Telegram: the student's
**plan** (`plans.maxFileSizeMb`), and the web process's memory — the intake
holds the file in memory while copying it (`TELEGRAM_INTAKE_CONCURRENCY`
bounds how many at once), and the existing extraction worker loads it again.

## Ads

- Decided only in `lib/ads/policy.ts`: free plans only, off unless
  `ADS_ENABLED=true`, by default only on files that came through Telegram
  (`ADS_SCOPE`), one break after every `ADS_QUESTIONS_PER_BREAK` questions.
- The question viewer only exposes a `renderBreak` slot; it knows nothing
  about ads. Doctor sets pass no slot and are unchanged.
- With `ADSENSE_CLIENT_ID` + `ADSENSE_SLOT_QUESTION_BREAK` the break shows a
  standard responsive AdSense display unit and `/ads.txt` is served.
  Otherwise it shows NiroLearn's own card.

**Before turning AdSense on, the owner must confirm with Google:**

1. The site is approved in AdSense and the ad unit exists.
2. The pages are behind a login, so the AdSense crawler cannot read them
   unless a crawler login is configured (AdSense → Access and authorization →
   Crawler access). Without it, ads may be limited or not serve.
3. The break is a screen that sits between questions. Google's placement
   policies restrict ads on screens with little publisher content and
   anything that encourages accidental clicks; the break shows the student's
   own recap above the ad and keeps "متابعة" in a separate row for that
   reason, but whether this placement is acceptable is Google's call, not
   something the code can prove.
4. The uploaded files are users' own material; ads next to copyrighted
   content a user uploaded can be a policy problem.

Clicks inside a Google unit are measured by Google, not by `ad_events`
(which counts impressions, and clicks on NiroLearn's own card).

## Not built yet

- Merging a guest that owns files into an existing account.
- Returning to the file after a registered user's login.
- Cleaning up a stored file whose "which kind?" question was never answered.
- Admin dashboard for Telegram / ad numbers (the tables hold the data).
- Flutter: the app does not use saved answers, the «اربطها» line or ad breaks.
