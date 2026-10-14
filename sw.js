const C = "milemark-v15", FILES = ["./", "index.html", "styles.css", "app.js", "schedules.json", "parts.json", "manifest.webmanifest", "icon.svg", "icon-192.png", "terms.html", "privacy.html", "help.html", "features.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(clients.claim()));
self.addEventListener("fetch", e => { if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request))); });
// Background check where the browser supports Periodic Background Sync (installed Chrome/Edge on Android/desktop).
self.addEventListener("periodicsync", e => { if (e.tag === "mm-check") e.waitUntil(check()); });
async function check() {
  const c = await caches.open("mm-state"), r = await c.match("state"); if (!r) return;
  const s = await r.json(), seen = s.bg || {};
  for (const d of s.due) if (d.at <= Date.now() && !seen[d.key] && !s.notified[d.key]) {
    seen[d.key] = 1; await self.registration.showNotification(d.title, { body: "Coming due soon (estimated). Tap to open MileMark.", icon: "icon-192.png", tag: d.key }); }
  s.bg = seen; await c.put("state", new Response(JSON.stringify(s)));
}
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(clients.matchAll({ type: "window" }).then(w => w[0] ? w[0].focus() : clients.openWindow("./"))); });
