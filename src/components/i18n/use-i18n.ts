"use client";

import { useContext } from "react";
import { I18nContext, type I18nContextValue } from "./i18n-provider";

/**
 * Access the i18n context.
 * Throws if used outside <I18nProvider> (helps catch missing-provider bugs early).
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error(
      "useI18n() must be used inside <I18nProvider>. Wrap your application with <I18nProvider> in src/app/layout.tsx.",
    );
  }
  return ctx;
}
