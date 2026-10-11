"use client";

import Link from "next/link";
import { Compass, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// 🧠 ألعاب الذاكرة — the bottom bar's "ألعاب" tab: every game with the
// player's real saved progress.
export default function BrainGamesHome() {
  const overview = trpc.brainGames.overview.useQuery();

  const header = (
    <header className="bg-hero">
      <h1>🧠 ألعاب الذاكرة</h1>
      <p>درّب عقلك واكسر رقمك القياسي.</p>
    </header>
  );

  if (overview.isLoading) {
    return (
      <section className="bg-page" aria-busy="true">
        {header}
        <div className="bg-grid">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-card bg-skeleton" />
          ))}
        </div>
      </section>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <section className="bg-page">
        <div className="bg-state">
          <h2>تعذر تحميل الألعاب</h2>
          <p>تحقق من الاتصال وحاول مرة ثانية.</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => overview.refetch()}
          >
            <RotateCcw size={16} aria-hidden="true" /> إعادة المحاولة
          </button>
        </div>
      </section>
    );
  }

  const games = overview.data;
  // 🧭 Ready quizzes to study or play with friends live next door.
  const discoverLink = (
    <Link href="/discover" className="bg-discover">
      <Compass size={22} aria-hidden="true" />
      <span>
        <strong>اكتشف اختبارات جاهزة</strong>
        <small>معلومات عامة، علوم، جغرافيا وأكثر — وحدك أو مع أصدقائك.</small>
      </span>
    </Link>
  );
  const isNewPlayer = games.every(game => !game.progress);

  return (
    <section className="bg-page">
      {header}
      {discoverLink}

      {isNewPlayer && (
        <div className="bg-welcome">
          <h2>أهلًا بك في ألعاب الذاكرة 🧠</h2>
          <p>تحدَّ ذاكرتك وسرعتك وتفكيرك المنطقي.</p>
          <Link href="/games/math" className="primary-button">
            ابدأ أول لعبة
          </Link>
        </div>
      )}

      <div className="bg-grid">
        {games.map(game => {
          const progress = game.progress;
          const completed = progress?.completedStages.length ?? 0;
          const stage = progress?.currentStage ?? 1;
          const percent = Math.round((completed / game.totalStages) * 100);
          return (
            <Link
              key={game.id}
              href={`/games/${game.id}`}
              className={`bg-card bg-card-${game.id}`}
              aria-label={`${game.titleAr} — المستوى ${stage} من ${game.totalStages}`}
            >
              <span className="bg-card-icon" aria-hidden="true">
                {game.emoji}
              </span>
              <strong className="bg-card-title">{game.titleAr}</strong>
              <span className="bg-card-tagline">{game.taglineAr}</span>
              {progress ? (
                <>
                  <span className="bg-card-meta">
                    <span>
                      المستوى{" "}
                      <bdi dir="ltr">
                        {stage}/{game.totalStages}
                      </bdi>
                    </span>
                    {progress.bestScore > 0 && (
                      <span>
                        أفضل نتيجة{" "}
                        <bdi>{progress.bestScore.toLocaleString("en")}</bdi>
                      </span>
                    )}
                  </span>
                  <span
                    className="bg-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={game.totalStages}
                    aria-valuenow={completed}
                    aria-label="المستويات المكتملة"
                  >
                    <span style={{ width: `${Math.max(2, percent)}%` }} />
                  </span>
                  <span className="bg-card-cta">▶ تابع المستوى {stage}</span>
                </>
              ) : (
                <span className="bg-card-cta is-new">▶ ابدأ المستوى 1</span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
