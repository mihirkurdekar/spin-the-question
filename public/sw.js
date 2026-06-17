const CACHE = "spin-the-question-v1";
const SHELL = ["/", "/manifest.json", "/wildcards.js", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === "POST" && (url.pathname.endsWith("/question") || url.pathname.endsWith("/vibe"))) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })));
    return;
  }

  if (request.method === "GET" && url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })).catch(() => caches.match("/").then((cached) => cached || new Response(
        "<!doctype html><title>Offline</title><body style=\"font-family:sans-serif;background:#0f0f0f;color:white\">No connection right now.</body>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      ))))
    );
  }
});
