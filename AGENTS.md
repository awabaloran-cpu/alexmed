# AGENTS.md — rules for any AI agent working on NiroLearn

Read this first, whatever model or tool you are (Claude Code, Cline, Roo
Code, OpenCode, Aider…). The owner writes in Arabic; answer in Arabic.

## Non-negotiable safety rules

1. **The local `.env` is PRODUCTION.** `DATABASE_URL` is the live Supabase
   database with real users; the R2 bucket `alexmed` holds real files; the
   QStash keys + `APP_BASE_URL` deliver jobs to the **production app**. So:
   - never run migrations, seeds, scripts, `next dev`, uploads or anything
     that writes, generates or publishes a job with this `.env`;
   - read-only inspection only, and never print secret values (names and
     hosts only). See `docs/mobile/ENVIRONMENTS.md`.
2. **Never** `git push`, merge to `main`, deploy, or change Railway /
   production variables without the owner saying so explicitly in this
   conversation. Local commits on the working branch are fine.
3. **Commit only after a green run** (below). Never commit with a failing
   test, never skip or delete a test to make it pass.
4. Never paste, log, commit or send secrets. `.env*` files stay out of git
   (only `*.example` files are committed). If the owner pastes a key in chat,
   don't store it and tell them to rotate it.
5. Backend changes must be additive and backward-compatible; the web app must
   keep working. New tables / migrations need the owner's approval (decision
   D3) and are never applied to production from here.
6. Don't mark anything done that isn't implemented **and verified**. If it
   can't be verified (no staging, no iOS), mark it `[!]` / `[~]` with why.

## Where things are

| Path | What |
|---|---|
| `docs/mobile/MOBILE_IMPLEMENTATION_ROADMAP.md` | **Source of truth** for the Flutter app: phases, status, quality gates, blockers, changelog. Update it in the same change as the work |
| `docs/mobile/MOBILE_ARCHITECTURE_BLUEPRINT.md` | Architecture (referenced as BP §n) |
| `docs/mobile/ENVIRONMENTS.md` | Production inventory + staging plan |
| `mobile/` | Flutter app (Riverpod 3, go_router, dio). Features in `mobile/lib/features/<name>/{data,domain,presentation}` |
| `app/`, `lib/`, `components/`, `drizzle/` | Next.js 15 web app + tRPC backend (Drizzle / Postgres) |
| `mobile/tool/export_*_fixtures.ts` | Run web code to produce fixtures for the Dart parity tests |
| `docs/telegram/TELEGRAM_GATEWAY.md` | Telegram bot gateway + ad breaks (`lib/telegram`, `lib/ads`): flow, security model, how to switch on, what is not verified / not built |

Current branch for mobile work: `feat/mobile-foundation`. Telegram gateway:
`feat/telegram-gateway` (migration `0043_telegram_gateway` not applied anywhere;
off by default behind `TELEGRAM_ENABLED` / `ADS_ENABLED`).

## Checks before every commit

Flutter (Windows; Flutter lives at `C:\Users\user\dev\flutter`):

```bash
cd mobile
export PATH="/c/Users/user/dev/flutter/bin:$PATH"
flutter gen-l10n            # after editing lib/l10n/*.arb
dart format lib test integration_test
flutter analyze             # must say "No issues found!"
flutter test                # must say "All tests passed!"
```

Web (only if web / backend files changed): `pnpm check` (tsc), `pnpm test`
(vitest), `pnpm build`.

On-device checks: Android emulator `Pixel_6_Pro_API_36`; integration tests in
`mobile/integration_test/` run with
`flutter test integration_test/<file> -d emulator-5554 --dart-define-from-file=env/dev.json`.
Don't run the emulator and a Gradle build at the same time (RAM); disk C: is
tight — `flutter clean` frees build outputs.

## How the app is written (follow the surrounding code)

- Web parity first: each screen mirrors its web page (same tRPC procedures,
  same rules, same Arabic copy). Port web logic and prove it with a parity
  test on the web code's own output rather than rewriting it.
- Arabic-first RTL. Mixed text: `AutoDirText` for paragraphs; names, titles,
  handles, codes and numbers inside a row use `isolate()` / `isolateLtr()`
  (`mobile/lib/core/ui/bidi.dart`). Equations and numbers read LTR.
- Strings in `mobile/lib/l10n/app_ar.arb` + `app_en.arb` (Arabic is the
  template). Design tokens in `mobile/lib/core/ui/tokens.dart` — no raw colours.
- Session cookie only to the API origin; never follow storage redirects with
  the session (`core/api/api_image.dart`, `pdf_range_source.dart`).
- Protected doctor-set content: memory only, never cached or written to disk,
  `SecureScreen` (FLAG_SECURE) on protected screens.
- Offline: queries opt in with `offline: true`, safe mutations with
  `queueOffline: true` (`core/offline/offline.dart`); never for protected data.
- No payment / upgrade UI anywhere in the app.

## Tool gotchas seen in this repo

- Files containing backslashes (regex, LaTeX, escapes): write them with a
  file-writing tool, not a shell heredoc — heredocs here mangled `\\` and
  broke on some Arabic text. Check with grep afterwards.
- No Python on this machine; use Node for small scripts.
- `adb` path: `C:\Users\user\AppData\Local\Android\Sdk\platform-tools`; in Git
  Bash prefix route arguments with `MSYS_NO_PATHCONV=1`.

## Current state and next step

See the **CURRENT STATUS** table in the roadmap. As of 2026-09-30: P9–P14 done
(P13 report and P14 SWR partial), P15 blocked; most live checks wait for
staging (D1). Next: P16 performance & security hardening — or the staging
setup once the owner creates the accounts in `docs/mobile/ENVIRONMENTS.md` §5.
