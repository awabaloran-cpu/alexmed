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

## Growth: campaign links, invites, the share card

Added 2026-10-08 (`lib/telegram/growth.ts`, migration `0044_telegram_growth`:
six columns on `telegram_accounts`).

- **Campaign links** `t.me/<bot>?start=src_<label>`: one label per group /
  post. The label is stored on the account when it is first created, never
  changed afterwards. **الأدمن → Telegram** (`/admin/telegram`) makes the
  links and shows, per label, how many arrived, had a file processed, and
  registered — counts only.
- **Invites** `t.me/<bot>?start=ref_<code>`: every student has a code (bot
  button «🎁 ادعُ زميلًا», `/invite`). When an invited student — a brand-new
  Telegram account — has their first file reach processing, the inviter
  earns one extra file, once per invited student, at most
  `MAX_BONUS_UPLOADS` (30) in total, and is told in the chat.
- **Spending an earned file**: a guest past the free file uploads with it
  instead of being stopped; a registered student who hit the plan's daily /
  monthly count uploads with it too (`admitUpload`'s `skipQuota` — the
  size limit and key ownership still apply). It costs processing, not money.
- **Share card** (`components/growth/ShareResultCard.tsx`): under a question
  file whose every question is answered — the result and a "share on
  Telegram" button carrying the student's invite link (or a plain
  `src_web_share` link when Telegram is not connected).
- Not built: a public leaderboard, rewards other than files, the daily
  question in a channel (the owner declined it).

## Sharing a file by link (`lib/share-links.ts`)

Migration `0045_file_share_links` (table `file_share_links`, column
`book_shares.linkId`). A student shares a file they uploaded; classmates who
open the link study from the **same single copy** — nothing is copied or
re-processed, so a share costs no AI work.

- **Link**: `https://t.me/<bot>?start=sh_<16-char code>`. One live link per
  file, made by its owner only (bot: «📤 شارك الملف مع زملائك» under a ready
  file; web: the panel on the question-file page and the book page). No cap
  on how many classmates join (owner's decision, 2026-10-08).
- **Joining** writes an ordinary accepted `book_shares` row (with `linkId`),
  so a book uses the existing shared-book access (`lib/book-access.ts`) and a
  question file uses `lib/question-file-access.ts`. No owner approval step.
  A brand-new student who arrives this way gets `source = share` and is
  credited to the sharer like an invite.
- **What a classmate gets**: read and study only. Their answers and progress
  are their own rows; the file's storage key is never sent to them (shared
  images go through `/api/books/question-files/<bookId>/images/<imageId>`,
  which re-checks access on every request).
- **Never shareable**: a file still being read or failed, and a doctor's
  protected question set — also closed on read, so a forged `book_shares`
  row gives nothing.
- **Ending it**: the owner stops the link (everyone who joined through it
  loses access at once; a new link is a new code). A classmate the owner
  removed or blocked cannot rejoin. A suspended owner's link is dead.
  Deleting the file removes links and shares (cascade).
- **Abuse**: a classmate can report a shared file once; reports are listed
  in `/admin/telegram`, where an admin can stop the link — the owner cannot
  re-share that file afterwards.
- The older "shared with me" list (web home + the Flutter app) stays study
  books only; shared question files have their own list
  (`questionFiles.sharedWithMe`), shown on `/books/question-files`.
- Not verified on a phone: the whole flow inside Telegram. Not built: the
  Flutter app does not list shared question files yet.

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

## Page limit

The bot refuses a PDF longer than `TELEGRAM_MAX_PAGES` (default 100) before it
is stored or counted against the plan, and asks the student to split it. The
count comes from the same cheap read that detects the file's kind; a file
whose pages cannot be counted goes on to the real reader. The limit is the
bot's only: the site's upload page does not apply it.

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
