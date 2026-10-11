"use client";

// What every Discover screen stands on: the language (remembered on the
// device, and the one thing that decides which quizzes, channels and
// banners are shown), its words and its direction.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DiscoverLanguage } from "@/lib/discover/data";
import { directionOf, translate, type DiscoverKey } from "@/lib/discover/i18n";
import s from "./discover.module.css";

const LANGUAGE_KEY = "nl-discover-language";

type Context = {
  language: DiscoverLanguage;
  setLanguage: (language: DiscoverLanguage) => void;
  t: (key: DiscoverKey, params?: Record<string, string | number>) => string;
};

const DiscoverContext = createContext<Context | null>(null);

export function useDiscover(): Context {
  const value = useContext(DiscoverContext);
  if (!value) throw new Error("useDiscover outside DiscoverProvider");
  return value;
}

export function DiscoverProvider({
  children,
  // A screen about one quiz or channel speaks that content's language.
  fixed,
}: {
  children: ReactNode;
  fixed?: DiscoverLanguage;
}) {
  const [chosen, setChosen] = useState<DiscoverLanguage>("ar");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANGUAGE_KEY);
      if (saved === "ar" || saved === "en") setChosen(saved);
    } catch {
      // No storage: Arabic, the app's own language.
    }
  }, []);
  const setLanguage = useCallback((next: DiscoverLanguage) => {
    setChosen(next);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // The choice lasts for this visit.
    }
  }, []);
  const language = fixed ?? chosen;
  const value = useMemo<Context>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(language, key, params),
    }),
    [language, setLanguage]
  );
  return (
    <DiscoverContext.Provider value={value}>
      <div className={s.root} dir={directionOf(language)} lang={language}>
        {children}
      </div>
    </DiscoverContext.Provider>
  );
}
