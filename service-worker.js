const CACHE_VERSION = "xiaocolour-pwa-v5";
const CORE_ASSETS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/icons/favicon-16.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("xiaocolour-pwa-") && name !== CACHE_VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match("/offline");
      return cached || new Response("XiaoColour 当前处于离线状态，请恢复网络后重试。", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }));
    return;
  }

  const networkFirst = ["style", "script", "worker", "manifest"].includes(request.destination);
  const cacheable = networkFirst || ["image", "font"].includes(request.destination)
    || CORE_ASSETS.includes(url.pathname);
  if (!cacheable) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async (response) => {
      const disposition = response.headers.get("content-disposition") || "";
      if (response.ok && response.type === "basic" && !/attachment/i.test(disposition)) {
        const cache = await caches.open(CACHE_VERSION);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);
    if (networkFirst) return (await network) || cached || Response.error();
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || Response.error();
  })());
});
