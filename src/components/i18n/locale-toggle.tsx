"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "./use-i18n";
import { LOCALES } from "@/lib/i18n";

/**
 * Locale toggle button — switches between 'en' and 'ar' with a smooth
 * framer-motion animation. Uses the Lucide `Languages` icon.
 */
export function LocaleToggle() {
  const { locale, toggleLocale, t } = useI18n();
  const meta = LOCALES[locale];
  const next = locale === "en" ? "ar" : "en";
  const nextMeta = LOCALES[next];

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleLocale}
      aria-label={t("locale.toggle")}
      title={t("locale.toggle")}
      className="gap-1.5 px-2.5 h-9"
    >
      <Languages className="h-4 w-4 shrink-0" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={locale}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="inline-flex items-center gap-1 text-xs font-medium"
          dir="auto"
        >
          <span aria-hidden className="text-sm leading-none">{meta.flag}</span>
          <span className="hidden sm:inline">{meta.nativeLabel}</span>
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">→ {nextMeta.nativeLabel}</span>
    </Button>
  );
}
