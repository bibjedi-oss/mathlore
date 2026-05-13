const CACHE = "archimath-v6";
const MEDIA = "https://mklrocckfuoymqvunsmr.supabase.co/storage/v1/object/public/mathlore-assets/";

const STATIC = [
  "/app",
  "/style.css?v=6",
  "/app.js?v=6",
  "/curriculum.js?v=5",
  "/map.webp",
  "/bg-logic.jpg",
  "/bg-triz.jpg",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-180.png",
  MEDIA + "bg-3.jpg",
  MEDIA + "bg-7.jpg",
  MEDIA + "bg-8.jpg",
  MEDIA + "bg-9.jpg",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // API и авторизация — только сеть
  if (url.pathname.startsWith("/api/")) return;

  // Всё остальное — сначала кэш, при промахе — сеть + кэшируем
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
