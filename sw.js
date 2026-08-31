/* ============================================================================
 * The Gaze — Service Worker (Phase 18: オフライン対応)
 * ローカル資産を precache し、CDN(cross-origin)は初回オンライン時に runtime cache。
 * オフライン時はキャッシュから配信。少なくとも一度オンラインで開く必要あり。
 * ========================================================================== */
const CACHE = 'the-gaze-v1';
const LOCAL = [
  './', './index.html', './style.css',
  './app.js', './app2.js', './charts.js', './blocks.js', './db.js', './search.js',
  './templates.js', './canvas.js', './sync.js', './ui.js', './rich.js', './ai.js', './extras.js',
  './pwa.js', './graph-check.html', './manifest.json', './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(LOCAL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // ページ遷移: ネット優先、失敗時はキャッシュのindex.html
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((resp) => { const c = resp.clone(); caches.open(CACHE).then((cc) => cc.put('./index.html', c)).catch(() => {}); return resp; }).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }

  if (sameOrigin) {
    // アプリ本体: ネット優先（オンライン時は常に最新）、失敗時キャッシュ
    e.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.ok) { const clone = resp.clone(); caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {}); }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // CDN(cross-origin): cache-first + バックグラウンド更新（stale-while-revalidate）
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp && (resp.ok || resp.type === 'opaque')) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
