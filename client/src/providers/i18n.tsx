"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppLanguage = "en" | "cs";

const LANGUAGE_STORAGE_KEY = "loftn8-language";

type I18nContextValue = {
  ready: boolean;
  lang: AppLanguage;
  isCz: boolean;
  locale: string;
  setLang: (lang: AppLanguage) => void;
  toggleLang: () => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";

  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "cs") return stored;
  } catch {
    // ignore storage failures
  }

  const browserLang = window.navigator.language.toLowerCase();
  return browserLang.startsWith("cs") ? "cs" : "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLangState(resolveInitialLanguage());
    setReady(true);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // ignore storage failures
    }

    if (typeof document !== "undefined") {
      document.documentElement.lang = lang === "cs" ? "cs" : "en";
    }
  }, [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({
      ready,
      lang,
      isCz: lang === "cs",
      locale: lang === "cs" ? "cs-CZ" : "en-US",
      setLang: setLangState,
      toggleLang: () => setLangState((current) => (current === "cs" ? "en" : "cs")),
    }),
    [lang, ready]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
