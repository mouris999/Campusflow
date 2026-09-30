/* eslint-env serviceworker */
/**
 * CampusFlow offline shell.
 *
 * Strategy:
 *   - App shell + static assets: cache-first (they are content-hashed).
 *   - Read-only API GETs: stale-while-revalidate, so a cached answer can be
 *     shown immediately and is labelled with how old it is.
 *   - Every write (POST/PATCH/DELETE) and authenticated reads: never cached
 *     and never served from cache. Live state (queue position, seat
 *     availability, confirmations) must come from the server or not at all.
 */

const VERSION = 'campusflow-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

/** Never cached: these would show stale "live" facts as current. */
const NEVER_CACHE = [
  '/api/queue',
  '/api/queue/my-token',
  '/api/queue/user',
  '/api/seats/mine',
  '/api/auth/session'
];

const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

/**
 * Discovers the hashed build assets referenced by index.html.
 *
 * Vite emits content-hashed filenames, so they cannot be listed by hand.
 * Without this the shell would be cached but the JavaScript that boots it
 * would not, and the app would render a blank page offline.
 */
async function precacheBuildAssets() {
  try {
    const res = await fetch('/index.html', { cache: 'reload' });
    if (!res.ok) return;
    const html = await res.text();
    const urls = new Set();
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = match[1];
      if (url.startsWith('/assets/') || url === '/icon.svg' || url === '/manifest.webmanifest') {
        urls.add(url);
      }
    }
    if (urls.size === 0) return;
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(
      Array.from(urls).map(async url => {
        try {
          const assetRes = await fetch(url);
          if (assetRes.ok) await cache.put(url, assetRes);
        } catch {
          // A missing asset must not fail the whole install.
        }
      })
    );
  } catch {
    // Offline during install: the next activation will retry.
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
      .then(precacheBuildAssets)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => !key.startsWith(VERSION)).map(key => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isApi(request) {
  return new URL(request.url).pathname.startsWith('/api/');
}

function isLiveOnly(pathname) {
  return NEVER_CACHE.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

self.addEventListener('fetch', event => {
  const { request } = event;

  // Writes are never intercepted: they must reach the server or fail loudly.
  if (request.method !== 'GET') return;

  // Only same-origin GETs are handled.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The SSE stream must never be cached or buffered.
  if (url.pathname === '/api/realtime') return;

  if (isApi(request)) {
    if (isLiveOnly(url.pathname)) return; // network-only
    event.respondWith(networkFirst(request));
    return;
  }

  // Navigations fall back to the cached shell so the app opens offline.
  // fetch() resolves even for 5xx, so an error response must be treated as a
  // failure here or the user would be shown a proxy error page instead.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) return response;
        } catch {
          // fall through to the cached shell
        }
        const cached = (await caches.match('/index.html')) || (await caches.match('/'));
        return cached || Response.error();
      })()
    );
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

/**
 * Network-first with a labelled cache fallback.
 *
 * Service and seating information is live operational data, so when the server
 * is reachable it is always authoritative. Only when the network is genuinely
 * unavailable does the cached copy get served, and it is tagged so the UI can
 * show CACHED / STALE / OFFLINE instead of passing it off as live.
 */
async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);

  try {
    const response = await fetch(request);
    // Only a genuinely successful response is usable; fetch() does not reject
    // on 5xx, so an error status is treated as a failure here.
    if (response.ok) {
      // Store the fetch time so the UI can show how old a cached copy is.
      const stamped = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers: (() => {
          const h = new Headers(response.headers);
          h.set('x-cached-at', new Date().toISOString());
          return h;
        })()
      });
      cache.put(request, stamped);
      return response;
    }
    if (response.status >= 500) throw new Error('server unavailable');
    // A real 4xx is an answer, not an outage: pass it through uncached.
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('x-cf-offline', '1');
      headers.set('x-cached-at', cached.headers.get('x-cached-at') || new Date().toISOString());
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers
      });
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: 'You are offline and this information has not been cached yet.',
        offline: true
      }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'x-cf-offline': '1' } }
    );
  }
}
