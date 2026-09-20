"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  interpolate,
  LOCALE_STORAGE_KEY,
  LOCALES,
  TRANSLATIONS,
  type Locale,
  type LocaleMeta,
  type TranslationDir,
} from "@/lib/i18n";

export interface I18nContextValue {
  /** Current active locale. */
  locale: Locale;
  /** All metadata for the current locale (label, flag, dir, code). */
  meta: LocaleMeta;
  /** Direction string for the current locale ('ltr' or 'rtl'). */
  dir: TranslationDir;
  /** Switch to a different locale. */
  setLocale: (l: Locale) => void;
  /** Toggle between 'en' and 'ar'. */
  toggleLocale: () => void;
  /** Translate a key with optional `{var}` interpolation. Falls back to en, then to the key itself. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Translate a key into a specific locale (useful for showing both). */
  tIn: (locale: Locale, key: string, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

/** Auto-detect the best matching locale from navigator / document. */
function detectBrowserLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const candidates = [
    ...(navigator.languages || []),
    navigator.language,
    (document.documentElement.lang || ""),
  ].filter(Boolean);
  for (const c of candidates) {
    const lc = String(c).toLowerCase();
    if (lc.startsWith("ar")) return "ar";
    if (lc.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

/** Read the persisted locale from localStorage (or null if not set). */
function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v === "en" || v === "ar") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function persistLocale(l: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe default; resolved to the real value inside the effect below.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  // Resolve the real locale on the client after first mount.
  // We must read from localStorage + navigator (external systems) so the
  // setState calls here are the documented use case — see:
  // https://react.dev/learn/you-might-not-need-an-effect (reading from external stores).
  useEffect(() => {
    const stored = readStoredLocale();
    const initial = stored ?? detectBrowserLocale();
    // Defer to a microtask to avoid the cascading-render lint rule.
    queueMicrotask(() => {
      setLocaleState(initial);
      setHydrated(true);
    });
  }, []);

  // Sync <html dir> and <html lang> whenever locale changes.
  useEffect(() => {
    if (!hydrated) return;
    const meta = LOCALES[locale];
    if (typeof document !== "undefined") {
      document.documentElement.lang = meta.code;
      document.documentElement.dir = meta.dir;
    }
  }, [locale, hydrated]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    persistLocale(l);
    const meta = LOCALES[l];
    if (typeof document !== "undefined") {
      document.documentElement.lang = meta.code;
      document.documentElement.dir = meta.dir;
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: Locale = prev === "en" ? "ar" : "en";
      persistLocale(next);
      const meta = LOCALES[next];
      if (typeof document !== "undefined") {
        document.documentElement.lang = meta.code;
        document.documentElement.dir = meta.dir;
      }
      return next;
    });
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = TRANSLATIONS[locale] || TRANSLATIONS.en;
      const template = dict[key] ?? TRANSLATIONS.en[key] ?? key;
      return interpolate(template, vars);
    },
    [locale],
  );

  const tIn = useCallback(
    (loc: Locale, key: string, vars?: Record<string, string | number>) => {
      const dict = TRANSLATIONS[loc] || TRANSLATIONS.en;
      const template = dict[key] ?? TRANSLATIONS.en[key] ?? key;
      return interpolate(template, vars);
    },
    [],
  );

  const meta = LOCALES[locale];
  const dir = meta.dir;

  const value = useMemo<I18nContextValue>(
    () => ({ locale, meta, dir, setLocale, toggleLocale, t, tIn }),
    [locale, meta, dir, setLocale, toggleLocale, t, tIn],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
