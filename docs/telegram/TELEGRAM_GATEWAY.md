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
- A guest gets **one file** (`TELEGRAM_GUEST_FREE_UPLOADS`). The next one —
  and every `/start` — offers the **connect page** `/connect/<token>`:
  - *sign in to an existing account* or *create a new one*; both return to
    the connect page, where the student confirms;
  - on confirm the guest is **merged** into that account
    (`mergeGuestInto`, `lib/telegram/accounts.ts`): every row that points
    at the guest's user id is re-pointed at the account (the columns are read
    from the database catalog, so new tables are covered), the two "Telegram"
    folders become one, and the guest row is deleted. Where a unique rule
    allows one row per user (a day's usage counter, a game's progress) the
    account's own row is kept. Files are not copied or re-processed.
  - the bot then says so in the chat, and the page offers "back to Telegram".
- An existing student can also start from **حسابي → Telegram**: a one-time
  code (10 minutes) carried to the bot in `t.me/<bot>?start=link_<code>`.
  A guest that already has files is merged the same way.
- A guest who registers while signed in as the guest (e.g. from حسابي) has
  the same row completed in place (`upgradeGuestWithVerifiedPhone`).
- One Telegram per account, one account per Telegram: a second is refused
  until the first is unlinked from حسابي.

## Mini App (bot buttons open inside Telegram)

Added 2026-10-08. Every "open" button the bot sends is a Telegram *web app*
button to `/tg?to=<path>` (`lib/telegram/links.ts`, `openButton`):

- `app/tg/page.tsx` loads Telegram's SDK, takes `initData` (Telegram's
  signed launch data) and posts it to `/api/telegram/webapp-session`.
- The server checks the signature with the bot token
  (`lib/telegram/webapp.ts`, Telegram's documented HMAC; data older than one
  hour is refused), finds — or creates as a guest — the account of that
  Telegram user, and sets the ordinary session cookie. The page then goes
  to `to`. No link token is involved, so nothing can be forwarded.
- This signs a **registered** account in too. That is deliberate and
  different from a link: the proof is the Telegram account itself, the same
  trust as "log in with Telegram". Unlinking Telegram on حسابي ends it.
- Telegram Web shows Mini Apps in a frame, where the session cookie would be
  a third-party cookie. There the page opens the ordinary link (below) in a
  new tab instead. `/tg` is the only page whose headers allow that frame
  (`next.config.ts`).
- `TELEGRAM_MINI_APP=false` turns every button back into an ordinary link.
- The chat's menu button stays Telegram's command list (`setChatMenuButton`
  type `commands`; the owner wanted the commands kept). The way into the app
  is the last button of the bot's keyboard, a `web_app` keyboard button
  (`mainKeyboard()`), sent with `/start`. The command list and descriptions
  are set with `setMyCommands` / `setMyDescription`. These live in Telegram, not in the
  code: after creating a new bot they must be set again.
- **Verified:** the signature check and the session route by tests. **Not
  verified from here:** the real launch on a phone.

## Links and security

- `/t/<token>`: 32 random bytes, only the SHA-256 is stored, expires
  (`TELEGRAM_LINK_TTL_MINUTES`), revocable. Opening it changes nothing — the
  session starts on the confirm button's POST, which is refused from any
  other origin. So link previews and prefetches sign nobody in.
- Only a **guest** account can be entered by a link. A registered account's
  buttons go through `/api/telegram/open?to=<path>`: the page itself when
  already signed in, otherwise the normal login and then that page
  (`callbackUrl`, checked by `lib/safe-redirect.ts`).
- `/connect/<token>` never signs anyone in and never links on a GET: the
  student must be signed in to a real account and press confirm (a same-site
  POST). A guest session on that browser is ended before the login /
  sign-up step.
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
  `ADS_ENABLED=true`, one break after every `ADS_QUESTIONS_PER_BREAK` cards
  (`ADS_SCOPE=telegram` narrows it to files that came through the bot).
- Where a break can appear (2026-10-08): question files
  (`QuestionList`'s `renderBreak` slot), and in كتبي the quiz, the
  flashcards and Exam Focus (`components/ads/useAdBreak.tsx`: the viewer
  calls `advance()` when moving on and renders `node` in place of its
  card). No viewer knows what a break contains. Doctor sets, مِرآة and the
  admin library have none.
- Site ownership for AdSense: with `ADSENSE_CLIENT_ID` set the site serves
  `/ads.txt` and a `google-adsense-account` meta tag on every page. The
  AdSense script itself is loaded only when a break is shown.
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

- Cleaning up a stored file whose "which kind?" question was never answered.
- Admin dashboard for Telegram / ad numbers (the tables hold the data).
- Flutter: the app does not use saved answers, the «اربطها» line or ad breaks.
