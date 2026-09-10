// Minimal offline support: cache-then-network for API GETs, and network-first
// for the app shell (HTML/JS/CSS) so a fresh deploy is never masked by a stale
// cached index.html pointing at an old, now-404ing JS bundle. Offline visitors
// still get the last successfully loaded shell as a fallback.
const CACHE = "bazar-cache-v2";
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

  // App shell (HTML/JS/CSS/icons): network-first, so a new deploy's hashed
  // bundle is always used when online. Cache is only a fallback for offline
  // use, updated on every successful fetch.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
  );
});
