/**
 * Cirkle Identity Verification — Service Worker
 *
 * Strategy:
 *   - Cache-first for static assets (CSS, JS, fonts, images, manifest)
 *     — these are content-hash-named in Next.js so a stale cache is safe.
 *   - Network-first for API calls — always try the network, fall back
 *     to cache only when offline. POST / PUT / DELETE / PATCH are NEVER
 *     cached (mutating requests must hit the server).
 *   - Offline fallback: when a navigation request fails AND there's no
 *     cached response, serve /offline.html (a tiny static page that lets
 *     the user know they need connectivity to use Cirkle).
 *
 * Cache name: cirkle-v3.2
 */

const CACHE_NAME = "cirkle-v3.2";
const OFFLINE_URL = "/offline.html";

const STATIC_ASSET_PATTERNS = [
  /\/_next\/static\//,          // Next.js hashed static assets
  /\/_next\/chunks\//,          // JS chunks
  /\/_next\/css\//,             // CSS bundles
  /\.(?:css|js|woff2?|ttf|otf|png|jpg|jpeg|svg|gif|webp|ico)$/i,
  /\/manifest\.json$/,
  /\/icon-/,                    // PWA icons
  /\/sw\.js$/,
];

const API_PATTERN = /\/api\//;

// Skip caching these entirely (non-GET, EventSource, etc.)
function shouldNeverCache(request) {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  if (url.pathname === "/sw.js") return false; // re-fetch SW every reload
  if (url.protocol === "ws:" || url.protocol === "wss:") return true;
  return false;
}

function isStaticAsset(url) {
  return STATIC_ASSET_PATTERNS.some((p) => p.test(url));
}

function isApiCall(url) {
  return API_PATTERN.test(url);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Pre-cache the offline fallback so it works without a network round-trip.
      await cache.addAll([OFFLINE_URL]).catch(() => {
        // offline.html may not exist yet — don't fail install for it
      });
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (shouldNeverCache(request)) return;

  const url = new URL(request.url);

  // ─── Static assets — cache-first ──────────────────────────────────
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) {
          // refresh cache in background
          fetch(request).then((resp) => {
            if (resp && resp.status === 200) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            }
          }).catch(() => {});
          return cached;
        }
        try {
          const resp = await fetch(request);
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return resp;
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  // ─── API calls — network-first ────────────────────────────────────
  if (isApiCall(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const resp = await fetch(request);
          // Only cache successful GET responses (no POST side effects)
          if (resp && resp.status === 200 && request.method === "GET") {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return resp;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ error: "offline", message: "Network unavailable" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
      })(),
    );
    return;
  }

  // ─── Navigation (HTML) — network-first with offline fallback ───────
  if (request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const resp = await fetch(request);
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return resp;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response(
            "<!DOCTYPE html><html><head><title>Cirkle — Offline</title></head><body><h1>You are offline</h1><p>Cirkle needs connectivity to verify identities. Please reconnect and try again.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  // ─── Default — try network, fall back to cache ──────────────────────
  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match(request);
        return cached || Response.error();
      }
    })(),
  );
});

// Allow the page to trigger an immediate update
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
