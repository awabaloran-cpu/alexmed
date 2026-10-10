"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { COUNTRIES } from "@/lib/study-rooms/countries";
import {
  errorKey,
  translate,
  type RoomsKey,
  type RoomsLanguage,
} from "@/lib/study-rooms/i18n";
import { trpc } from "@/lib/trpc-client";
import s from "./rooms.module.css";

// 👥 Everything a rooms page needs before it draws anything: is the feature
// on, who the student is to the rooms (age group, gender, country), the
// language and its direction, and the look (day / night).
//
// A student with no date of birth on file meets the one-time questions
// first — the server treats such an account as the most restricted group
// either way; this only spares them a page of refusals.
type Viewer = import("@/lib/study-rooms/profile").Viewer;

type RoomsContext = {
  t: (key: RoomsKey, values?: Record<string, string | number>) => string;
  // The sentence for a refusal from the server.
  tError: (error: unknown) => string;
  language: RoomsLanguage;
  viewer: Viewer;
  refreshViewer: () => Promise<unknown>;
};

const Context = createContext<RoomsContext | null>(null);

export function useRooms(): RoomsContext {
  const value = useContext(Context);
  if (!value) throw new Error("useRooms outside RoomsProvider");
  return value;
}

const THEME_KEY = "nl-rooms-theme";

export default function RoomsProvider({
  children,
  // The room itself is a night desk by default; the lists follow the app.
  night = false,
}: {
  children: ReactNode;
  night?: boolean;
}) {
  const enabled = trpc.rooms.enabled.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  const me = trpc.rooms.me.useQuery(undefined, {
    enabled: enabled.data?.enabled === true,
    retry: 1,
  });

  const language: RoomsLanguage = me.data?.uiLanguage ?? "ar";
  const [theme, setTheme] = useState<"light" | "dark">(
    night ? "dark" : "light"
  );
  useEffect(() => {
    if (!night) return;
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      // Private mode: the default look stays.
    }
  }, [night]);

  const t = useCallback<RoomsContext["t"]>(
    (key, values) => translate(language, key, values),
    [language]
  );
  const tError = useCallback(
    (error: unknown) =>
      translate(
        language,
        errorKey(
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : null
        )
      ),
    [language]
  );

  const frame = (content: ReactNode) => (
    <div
      className={`${s.root} ${night ? s.night : ""}`}
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      data-theme={theme}
    >
      {content}
    </div>
  );

  const value = useMemo<RoomsContext | null>(
    () =>
      me.data
        ? { t, tError, language, viewer: me.data, refreshViewer: me.refetch }
        : null,
    [me.data, me.refetch, t, tError, language]
  );

  if (enabled.isLoading || (enabled.data?.enabled && me.isLoading)) {
    return frame(
      <div className={s.secs} aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={s.skeleton} />
        ))}
      </div>
    );
  }
  if (!enabled.data?.enabled) {
    return frame(
      <div className={s.empty}>
        <b>{translate("ar", "error.not_available")}</b>
      </div>
    );
  }
  if (!value) {
    return frame(
      <div className={s.empty}>
        <b>{t("rooms.loadFailed")}</b>
        <button className={s.btn} type="button" onClick={() => me.refetch()}>
          {t("rooms.retry")}
        </button>
      </div>
    );
  }
  if (value.viewer.banned) {
    return frame(
      <div className={s.empty}>
        <b>{t("error.banned_from_rooms")}</b>
      </div>
    );
  }

  return (
    <Context.Provider value={value}>
      {frame(
        value.viewer.birthDateSet ? (
          <>
            {night ? (
              <ThemeToggle
                theme={theme}
                onChange={next => {
                  setTheme(next);
                  try {
                    window.localStorage.setItem(THEME_KEY, next);
                  } catch {
                    // Not remembered; still applied.
                  }
                }}
              />
            ) : null}
            {children}
          </>
        ) : (
          <ProfileGate />
        )
      )}
    </Context.Provider>
  );
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: "light" | "dark";
  onChange: (theme: "light" | "dark") => void;
}) {
  return (
    <button
      type="button"
      className={s.chip}
      style={{ justifySelf: "end" }}
      aria-pressed={theme === "dark"}
      onClick={() => onChange(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// The one-time questions: date of birth, stage, country, and (optionally)
// gender. Asked plainly, without saying what any answer unlocks.
function ProfileGate() {
  const { t, tError, language, viewer, refreshViewer } = useRooms();
  const utils = trpc.useUtils();
  const save = trpc.rooms.setProfile.useMutation({
    onSuccess: async () => {
      await utils.rooms.invalidate();
      await refreshViewer();
    },
  });
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [stage, setStage] = useState<"university" | "high_school" | "">("");
  const [country, setCountry] = useState(viewer.country ?? "");
  const [gender, setGender] = useState<"female" | "male" | "">(
    viewer.gender ?? ""
  );
  const complete =
    !!day && !!month && year.length === 4 && !!stage && !!country;

  return (
    <form
      className={s.panel}
      onSubmit={event => {
        event.preventDefault();
        if (!complete || save.isPending) return;
        save.mutate({
          birthDate: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
          stage: stage as "university" | "high_school",
          country,
          ...(gender ? { gender } : {}),
        });
      }}
    >
      <h1>{t("gate.title")}</h1>
      <p className={s.meta}>{t("gate.intro")}</p>
      <fieldset
        className={s.field}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <legend>{t("gate.birthDate")}</legend>
        <div className={s.three}>
          <input
            id="rooms-birth-day"
            className={s.input}
            inputMode="numeric"
            placeholder={t("gate.day")}
            aria-label={t("gate.day")}
            value={day}
            onChange={event =>
              setDay(event.target.value.replace(/\D/g, "").slice(0, 2))
            }
          />
          <select
            id="rooms-birth-month"
            className={s.input}
            aria-label={t("gate.month")}
            value={month}
            onChange={event => setMonth(event.target.value)}
          >
            <option value="">{t("gate.month")}</option>
            {MONTHS.map(value => (
              <option key={value} value={String(value)}>
                {new Intl.DateTimeFormat(language === "ar" ? "ar-EG" : "en", {
                  month: "long",
                }).format(new Date(2000, value - 1, 1))}
              </option>
            ))}
          </select>
          <input
            id="rooms-birth-year"
            className={s.input}
            inputMode="numeric"
            placeholder={t("gate.year")}
            aria-label={t("gate.year")}
            value={year}
            onChange={event =>
              setYear(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
          />
        </div>
      </fieldset>
      <label className={s.field}>
        {t("gate.stage")}
        <select
          id="rooms-stage"
          className={s.input}
          value={stage}
          onChange={event => setStage(event.target.value as typeof stage)}
        >
          <option value="" />
          <option value="university">{t("gate.university")}</option>
          <option value="high_school">{t("gate.highSchool")}</option>
        </select>
      </label>
      <label className={s.field}>
        {t("gate.country")}
        <select
          id="rooms-country"
          className={s.input}
          value={country}
          onChange={event => setCountry(event.target.value)}
        >
          <option value="" />
          {COUNTRIES.map(item => (
            <option key={item.code} value={item.code}>
              {item[language]}
            </option>
          ))}
        </select>
      </label>
      {!viewer.gender ? (
        <label className={s.field}>
          {t("gate.gender")}
          <select
            id="rooms-gender"
            className={s.input}
            value={gender}
            onChange={event => setGender(event.target.value as typeof gender)}
          >
            <option value="" />
            <option value="female">{t("gate.female")}</option>
            <option value="male">{t("gate.male")}</option>
          </select>
          <span className={s.meta}>{t("gate.genderHint")}</span>
        </label>
      ) : null}
      <p className={s.meta}>{t("gate.private")}</p>
      {save.error ? (
        <p className={s.errorNote} role="alert">
          {tError(save.error)}
        </p>
      ) : null}
      <button
        className={`${s.btn} ${s.primary} ${s.wide}`}
        type="submit"
        disabled={!complete || save.isPending}
      >
        {t("gate.save")}
      </button>
    </form>
  );
}
