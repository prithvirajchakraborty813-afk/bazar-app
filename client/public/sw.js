const CACHE_NAME = "bazar-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const cacheResponse = async (request, response) => {
  if (response && (response.ok || response.type === "opaque")) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // The public catalog is the only API response cached.  Admin reports and
  // budgets stay network-only so financial data never appears stale/shared.
  if (url.pathname === "/api/catalog") {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then((response) => cacheResponse(request, response));
      return cached || network;
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await cacheResponse(request, await fetch(request));
      } catch {
        return (await caches.match(request)) || (await caches.match("/"));
      }
    })());
    return;
  }

  // Cache frontend files after their first successful load, which lets the
  // installed app reopen without a connection.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return cacheResponse(request, await fetch(request));
    })());
  }
});
