// Minimal offline support: cache the app shell on install, and cache-then-network
// for GET API calls (catalog, reports, budgets) so the last-seen data is still
// browsable with no connection. Writes (POST/PUT/DELETE) are never handled here —
// the app queues those itself (see offlineQueue.js) and replays them on reconnect.
const CACHE = "bazar-cache-v1";
const APP_SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache/intercept writes

  const url = new URL(request.url);
  const isApiGet = url.pathname.startsWith("/api/");

  if (isApiGet) {
    // Network-first for live data, falling back to the last cached copy offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell: cache-first so the UI loads instantly and offline.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).catch(() => caches.match("/")))
  );
});
