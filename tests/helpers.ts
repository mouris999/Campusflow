import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Boots an isolated CampusFlow instance against a scratch data directory so
 * tests never touch the real campus database.
 */
export async function createIsolatedCampus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusflow-test-'));
  process.env.CAMPUSFLOW_DATA_DIR = dir;

  const { db } = await import('../server/db.js');
  const { trafficIntelligence } = await import('../server/intelligence/index.js');
  const { trafficStore } = await import('../server/intelligence/store.js');

  trafficIntelligence.bootstrap();

  return { dir, db, trafficIntelligence, trafficStore };
}

/** Boots the full express API on an ephemeral port. */
export async function createIsolatedServer() {
  const campus = await createIsolatedCampus();
  // Use the real app factory so tests cover the shipped wiring (health check,
  // JSON 404 for unknown API routes, error handler), not a partial mount.
  const { createApp } = await import('../server/app.js');

  const app = createApp();

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api`;

  return {
    ...campus,
    base,
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}

export async function getJson(url: string) {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

export async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

export async function patchJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

/**
 * Signs in as one of the seeded demo accounts and returns a cookie jar that
 * every subsequent request can replay, so tests exercise the real session path.
 */
export async function signIn(base: string, email: string, password: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json();
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const jar = setCookie.map(c => c.split(';')[0]).join('; ');

  // Writes now require a CSRF token, so resolve it once per test session.
  let csrf: string | null = null;
  if (jar) {
    const session = await fetch(`${base}/auth/session`, { headers: { Cookie: jar } });
    if (session.ok) {
      const data = await session.json();
      csrf = data?.csrf_token ?? null;
    }
  }
  if (csrf && jar) csrfByCookie.set(jar, csrf);
  return { status: res.status, body, cookie: jar, csrf };
}

/** CSRF tokens are per session; cache them so test call sites stay simple. */
const csrfByCookie = new Map<string, string>();

export function authedFetch(cookie: string, url: string, init: RequestInit = {}, csrf?: string | null) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const token = csrf ?? csrfByCookie.get(cookie);
    if (token) headers.set('x-csrf-token', token);
  }
  return fetch(url, { ...init, headers });
}

export async function authedGet(cookie: string, url: string) {
  const res = await authedFetch(cookie, url);
  return { status: res.status, body: await res.json() };
}

export async function authedPost(cookie: string, url: string, body: unknown) {
  const res = await authedFetch(cookie, url, { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

export async function authedPatch(cookie: string, url: string, body: unknown) {
  const res = await authedFetch(cookie, url, { method: 'PATCH', body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
