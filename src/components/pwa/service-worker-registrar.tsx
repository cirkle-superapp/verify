"use client";

import { useEffect } from "react";

/**
 * ServiceWorkerRegistrar — registers /sw.js on the client side.
 *
 * Mounts once at the root layout level. On the very first page load,
 * the service worker is installed and begins caching static assets
 * (Next.js chunks, CSS, fonts, PWA icons). On subsequent visits, the
 * cache-first strategy kicks in for those assets, network-first for
 * /api/ calls, and a navigations fall back to /offline.html when the
 * network is unreachable.
 *
 * Why a separate component: Next.js 16 App Router RootLayout is a
 * Server Component by default, so it can't call navigator.* or run
 * the SW registration directly. This tiny client component runs only
 * in the browser, after hydration.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // Only register on production-like origins (skip on localhost SSR
    // when the dev server has no real /sw.js served). However, since
    // we ship /sw.js as a static asset, it works in dev too.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Listen for updates and apply them as soon as they're ready
          reg.addEventListener("updatefound", () => {
            const inst = reg.installing;
            if (!inst) return;
            inst.addEventListener("statechange", () => {
              if (inst.state === "installed" && navigator.serviceWorker.controller) {
                // New SW took over — tell it to skip waiting so the next
                // reload serves the updated assets.
                inst.postMessage("skipWaiting");
              }
            });
          });
        })
        .catch(() => {
          // Silent — SW registration failures are non-fatal (e.g. Safari
          // with SW disabled, or insecure context).
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
