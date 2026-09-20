"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

/**
 * InstallPrompt — shows a dismissible "Install Cirkle" banner.
 *
 * Listens for the browser's `beforeinstallprompt` event (Chrome/Edge/Android
 * — Safari on iOS doesn't fire it, so the banner just doesn't show up there).
 *
 * Behavior:
 *   - When the event fires, stashes it in state and reveals the banner.
 *   - Click → call `prompt()` on the stashed event (triggers the native
 *     install dialog) and clears the state.
 *   - Dismiss → hides the banner and records the dismissal in localStorage
 *     with a 7-day cooldown so we don't nag the user.
 *
 * The banner slides in from the bottom-left on mobile and the bottom-right
 * on desktop, with a framer-motion spring for a polished feel.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSAL_KEY = "cirkle.pwa.install-dismissed-at";
const DISMISSAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function shouldShowAfterDismissal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ts = window.localStorage.getItem(DISMISSAL_KEY);
    if (!ts) return true;
    const dismissedAt = Number(ts);
    if (!Number.isFinite(dismissedAt)) return true;
    return Date.now() - dismissedAt > DISMISSAL_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function recordDismissal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSAL_KEY, String(Date.now()));
  } catch {
    // localStorage may be disabled (Safari private mode) — fail silently
  }
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // If the app is already installed (standalone mode), never prompt
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari uses navigator.standalone
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const handler = (e: Event) => {
      // The browser fires this event when it would otherwise show its own
      // mini-infobar. Calling preventDefault suppresses the default UI so
      // we can show our own banner instead.
      e.preventDefault();
      if (!shouldShowAfterDismissal()) return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // If the app gets installed while the banner is showing, dismiss it
  useEffect(() => {
    const handler = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", handler);
    return () => window.removeEventListener("appinstalled", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "dismissed") {
        recordDismissal();
      }
    } finally {
      setDeferredPrompt(null);
      setVisible(false);
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    recordDismissal();
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && deferredPrompt ? (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-40 max-w-md w-[calc(100%-2rem)] sm:w-96"
          role="dialog"
          aria-live="polite"
          aria-label="Install Cirkle"
        >
          <div className="rounded-xl border border-emerald-500/40 bg-card/95 backdrop-blur shadow-lg p-4 flex items-start gap-3">
            <div className="mt-0.5 shrink-0 rounded-lg bg-emerald-500/15 p-2">
              <Download className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Install Cirkle for faster access</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add to your home screen for a native-like, offline-capable experience.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" onClick={handleInstall} disabled={installing} className="h-8">
                  {installing ? "Installing…" : "Install"}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-8" aria-label="Dismiss install prompt">
                  Not now
                </Button>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition"
              aria-label="Close install banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
