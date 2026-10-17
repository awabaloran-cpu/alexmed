# The public site (marketing pages, SEO, AI answers)

Last change: 2026-10-17, the redesign that added studying together.

## Pages (all keep their URLs)

| Path | What | Source |
|---|---|---|
| `/` | Landing: every earlier section kept, plus the hero reel and the together sections | `components/landing/Landing.tsx` |
| `/pdf-summary`, `/flashcards`, `/mind-map`, `/how-to-study` | Tool pages; each gained «شاهد كيف يعمل» (a reel) and the together band | `app/<path>/page.tsx` |
| `/telegram-bot`, `/past-exam-questions`, `/solve-questions` | Question-file pages; same additions, and share images (`opengraph-image.tsx`) | `app/<path>/page.tsx` |
| `/study-rooms` (new) | Free study rooms: voice, shared PDF with ink, YouTube together, group quizzes | `app/study-rooms` |
| `/quiz-with-friends` (new) | Discover's quizzes played with friends | `app/quiz-with-friends` |
| `/quizzes`, `/quizzes/<slug>` | Discover's public quiz pages (unchanged) | `app/quizzes` |

`lib/site.ts` lists them (`PUBLIC_BASE_PATHS`, `TOOL_PAGES`, `QUESTION_PAGES`,
`TOGETHER_PAGES`); the header, footer, related links and `app/sitemap.ts` read
those lists. `lib/site.test.ts` and `app/seo-routes.test.ts` pin them.

## The reels

`components/landing/Reels.tsx`: three or four scenes that play like a short
video, built from markup (no video files: nothing to download, and the text
is readable by search engines and AI answers). CSS does the motion
(`showcase.module.css`); under `prefers-reduced-motion` a reel stands still on
its key scene.

The reels start paused and a small script in `SiteChrome.tsx` (`START_REELS`)
starts them once the fonts are ready (or after 3 s). A reel moving before the
fonts arrive made the browser paint the hero in its fallback face first.

## Rules learned the hard way

- **Keep the hero text as it is** unless you measure CLS after the change. The
  Arabic web font and its fallback wrap differently, so a longer title, kicker
  or lede adds a line when the font lands and shifts everything below it
  (measured 2026-10-17: a longer title took CLS from 0 to 0.117). Check with
  `node ~/.claude/skills/performance-audit/lh.mjs <url>` several single runs,
  not one median.
- Never change a public page's URL or remove its title words: the pages rank
  on them («تلخيص PDF», «فلاش كارد», «خريطة ذهنية», …). Add, don't replace.
- Numbers on the pages come from data (`DISCOVER_FACTS` reads the public
  catalogue), never typed in by hand.
- `public/llms.txt` describes the product for AI answers; update it with every
  public feature.

## Checking locally without production

Build, then start with a dummy database so nothing reaches production (the
public pages need none):

```bash
npx pnpm build
DATABASE_URL="postgres://none:none@127.0.0.1:1/none" npx next start -p 3100
node ~/.claude/skills/seo-audit/seo-check.mjs http://127.0.0.1:3100 / /study-rooms
```
