/**
 * sw.js — minimal pre-cache service worker for the portfolio.
 *
 * Strategy: stale-while-revalidate for the static bundle, cache-only
 * for pre-cached critical routes, network-first for everything else.
 *
 * v9.2 — minimal viable offline. The portfolio is a static site; the
 * main pain point is the slow first-paint on cellular. Pre-cache the
 * 6 most-visited routes on install + the type/mono CSS token file.
 *
 * Note: the Cloudflare Pages `_headers` file already wires
 * `Cache-Control: public, max-age=31536000, immutable` on `/_astro/*`,
 * so the bundle is essentially free on repeat visits. The SW only
 * helps when the user is offline.
 */
const CACHE = 'cm-portfolio-v9-2';
const PRE_CACHE = [
  '/',
  '/proof/',
  '/projects/',
  '/certifications/',
  '/for-recruiters/',
  '/resume/',
  '/sitemap-index.xml',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRE_CACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML (always fetch fresh; fall back to cache offline).
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/'))),
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
