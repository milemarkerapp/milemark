const C = "milemark-v20", OCR = "milemark-ocr-v1", FILES = ["scan.js", "./", "index.html", "styles.css", "app.js", "schedules.json", "parts.json", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-32.png", "favicon-16.png", "logo-64.png", "terms.html", "privacy.html", "help.html", "features.js", "notify-core.js", "replace.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => /^milemark-v\d+$/.test(k) && k !== C).map(k => caches.delete(k)))).then(() => clients.claim())));
self.addEventListener("fetch", e => { if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  // The offline scanner files are large and never change: keep them in their own cache, served cache-first.
  if (new URL(e.request.url).pathname.includes("/ocr/")) return e.respondWith(caches.open(OCR).then(async c => { const hit = await c.match(e.request.url); if (hit) return hit;
    const r = await fetch(e.request); if (r.ok && r.status === 200) c.put(e.request.url, r.clone()); return r; }));
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request))); });
// Background check where the browser supports Periodic Background Sync (installed Chrome/Edge on Android/desktop).
self.addEventListener("periodicsync", e => { if (e.tag === "mm-check") e.waitUntil(check()); });
importScripts("notify-core.js");
async function check() {
  const c = await caches.open("mm-state"), r = await c.match("state"); if (!r) return;
  const s = await r.json(); if (!s.sum) return;
  const res = MMNotify.plan(s.sum, s.notified || {}, Date.now());
  await c.put("state", new Response(JSON.stringify({ sum: s.sum, notified: res.notified })));
  for (const f of res.fire) await self.registration.showNotification(f.title, { body: f.body, icon: "icon-192.png", tag: f.tag, data: f.odo ? { odo: f.odo } : {} });
}
self.addEventListener("notificationclick", e => { e.notification.close(); const odo = e.notification.data?.odo;
  e.waitUntil(clients.matchAll({ type: "window" }).then(w => { if (w[0]) { if (odo) w[0].postMessage({ odo }); return w[0].focus(); } return clients.openWindow(odo ? "./?odo=" + encodeURIComponent(odo) : "./"); })); });
