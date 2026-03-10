/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst, NetworkOnly } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

const NAV_CACHE = "nav-shell-v1";
const SHELL_URL = "/index.html";

// ---------------------------------------------------------------------------
// Precache all build artifacts (self.__WB_MANIFEST is injected by VitePWA).
// This covers every hashed JS/CSS/image/font file produced by Vite.
// ---------------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ---------------------------------------------------------------------------
// Install — skip waiting immediately so the new SW takes over on all tabs.
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  console.log("[SW] Installing...");
  event.waitUntil(self.skipWaiting());
});

// ---------------------------------------------------------------------------
// Activate — claim all clients so the new SW controls every open tab without
// requiring a reload, then re-cache a fresh copy of index.html so the app
// shell is never stale after a deployment.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating...");
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await refreshIndexHtml();
    })(),
  );
});

/**
 * Fetch a fresh copy of index.html from the network and store it in
 * NAV_CACHE.  Validates that the response is a real HTML document before
 * caching so we never store a partial, empty, or error page.
 * If the network is unavailable we keep the existing cached copy untouched.
 */
async function refreshIndexHtml(): Promise<void> {
  try {
    const response = await fetch(SHELL_URL, { cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && contentType.includes("text/html")) {
      const cache = await caches.open(NAV_CACHE);
      await cache.put(SHELL_URL, response);
      console.log("[SW] index.html re-cached on activate");
    } else {
      console.warn("[SW] refreshIndexHtml: unexpected response", response.status, contentType);
    }
  } catch {
    // Network unavailable — keep whatever is already cached.
    console.log("[SW] Could not refresh index.html (offline) — keeping cached copy");
  }
}

// ---------------------------------------------------------------------------
// Fetch routing
// ---------------------------------------------------------------------------

// Supabase API — always go to the network; never serve from cache.
registerRoute(
  ({ url }) => url.hostname.includes("supabase.co"),
  new NetworkOnly(),
);

// Static code bundles (hashed filenames, e.g. index-Abc123.js) — cache-first.
// These are also in the precache manifest so they should already be warm.
registerRoute(
  ({ request }) => request.destination === "script" || request.destination === "style",
  new CacheFirst({
    cacheName: "static-code-v1",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
);

// Images and fonts — cache-first.
registerRoute(
  ({ request }) => request.destination === "image" || request.destination === "font",
  new CacheFirst({
    cacheName: "static-assets-v1",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
);

// Navigation requests (page loads, tab restores, PWA launches) — network-first
// with a 5-second timeout.  Only falls back to the cached index.html shell
// when the network is genuinely unavailable.  Never returns an empty or
// undefined response.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: NAV_CACHE,
      // 5 s gives mobile browsers enough time to re-establish a connection
      // after being foregrounded — the previous 2 s was too aggressive.
      networkTimeoutSeconds: 5,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
      ],
    }),
    // Keep OAuth and raw API paths out of the SPA navigation handler.
    { denylist: [/^\/~oauth/, /^\/api/] },
  ),
);
