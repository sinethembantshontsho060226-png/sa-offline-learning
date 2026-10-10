// SA Offline Learning App — Service Worker
// Precaches the full app shell (HTML/CSS/JS/icons) so the installed app
// opens and runs with zero network. All actual content (notes, quizzes,
// homework, results) lives in IndexedDB, not here — this worker's only
// job is making sure the CODE that reads IndexedDB is always available.

const CACHE_NAME = "sa-offline-learning-shell-v1";
const APP_SHELL = [
  "/",
  "/static/index.html",
  "/static/css/style.css",
  "/static/js/db.js",
  "/static/js/api.js",
  "/static/js/sync.js",
  "/static/js/app.js",
  "/manifest.json",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept the API or auth routes — those must hit the network
  // (or fail fast offline) so app.js can handle the failure itself.
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (any hash route) always resolve to the cached
  // app shell — this is what makes the installed icon open with no signal.
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match("/static/index.html").then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Static assets: cache-first, falling back to network, and updating
  // the cache for next time when the network does succeed.
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return resp;
        }).catch(() => cached);
      })
    );
  }
});
