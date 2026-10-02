import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import crypto from 'node:crypto';
import { authedGet, createIsolatedServer, postJson } from './helpers.js';

/**
 * POST /api/auth/firebase, exercised over real HTTP against an isolated server.
 *
 * The token is signed with a locally generated key and the JWKS fetch is
 * intercepted, so these tests never contact Firebase and never depend on the
 * network or the wall clock (R20, R22).
 *
 * Note on the mechanism: the key set is overridden by intercepting fetch, not by
 * an environment variable. The project id, by contrast, IS an environment
 * variable, because it is the trust decision rather than a test seam.
 */

const KID = 'firebase-endpoint-key';
const PROJECT_ID = 'campusflow-endpoint-project';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as crypto.JsonWebKey;

let app: Awaited<ReturnType<typeof createIsolatedServer>>;
let studentEmail = '';
let originalProjectId: string | undefined;

before(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('googleapis.com/service_accounts')) {
      return Promise.resolve(
        new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  originalProjectId = process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID;
  process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID = PROJECT_ID;

  app = await createIsolatedServer();
  studentEmail = app.db.getUsers().find(u => u.role === 'student')!.email;
});

after(async () => {
  await app.close();
  if (originalProjectId === undefined) delete process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID;
  else process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID = originalProjectId;
});

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function tokenFor(email: string, overrides: Record<string, unknown> = {}): string {
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER,
    aud: PROJECT_ID,
    exp: now + 3600,
    iat: now,
    sub: 'firebase-endpoint-uid',
    email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...overrides
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${signingInput}.${b64url(crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey))}`;
}

function sessionCookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ');
}

test('a verified Firebase sign-in returns a real CampusFlow session', async () => {
  const res = await fetch(`${app.base}/auth/firebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: tokenFor(studentEmail) })
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.user.email, studentEmail);
  assert.equal(body.user.role, 'student', 'the role comes from the database');

  // The session must be the app's own signed cookie, so every later guard works.
  const cookie = sessionCookieOf(res);
  assert.match(cookie, /^cf_session=/);
  assert.match(res.headers.getSetCookie().join(';'), /HttpOnly/i);

  const session = await authedGet(cookie, `${app.base}/auth/session`);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.email, studentEmail);
});

test('the provider is recorded in the audit trail', async () => {
  const res = await fetch(`${app.base}/auth/firebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: tokenFor(studentEmail) })
  });
  assert.equal(res.status, 200);

  const logs = app.db.getAuditLogs(200);
  const login = logs.find(e => e.details && /signed in with Google \(Firebase/.test(e.details));
  assert.ok(login, `expected a Firebase LOGIN audit entry, saw: ${logs.map(l => l.details).join(' | ')}`);
  assert.match(login.details, /google\.com/);
});

test('an unverifiable token is refused with 401 and no cookie', async () => {
  const res = await fetch(`${app.base}/auth/firebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: tokenFor(studentEmail, { email_verified: false }) })
  });
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.equal(body.success, false);
  assert.equal(res.headers.getSetCookie().length, 0, 'no session may be issued');
});

test('a token from another Firebase project is refused over HTTP', async () => {
  // The decisive end-to-end check on the project pin: this signature is genuine
  // because it was made with the key the server trusts, yet the project it
  // claims is not ours, so it must be refused.
  const res = await fetch(`${app.base}/auth/firebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: tokenFor(studentEmail, {
        iss: 'https://securetoken.google.com/attacker-project',
        aud: 'attacker-project'
      })
    })
  });
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.equal(body.success, false);
  assert.equal(res.headers.getSetCookie().length, 0);
});

test('an unregistered Google email is refused with 403 and is not provisioned', async () => {
  const before = app.db.getUsers().length;
  const res = await postJson(`${app.base}/auth/firebase`, { idToken: tokenFor('stranger@gmail.com') });

  assert.equal(res.status, 403);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /not registered/i);
  // The decisive assertion: no account was auto-provisioned.
  assert.equal(app.db.getUsers().length, before, 'an unknown Google email must not create a user');
  assert.equal(app.db.getUsers().some(u => u.email === 'stranger@gmail.com'), false);
});

test('a correctly signed token cannot elevate a student to admin', async () => {
  const res = await fetch(`${app.base}/auth/firebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: tokenFor(studentEmail, { role: 'admin', admin: true }) })
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.user.role, 'student', 'a claimed role in the token must be ignored');

  // And the privileges really are not admin's.
  const cookie = sessionCookieOf(res);
  const audit = await authedGet(cookie, `${app.base}/audit-logs`);
  assert.equal(audit.status, 403, 'the admin-only audit log must stay out of reach');
});

test('a missing ID token is a 400', async () => {
  const res = await postJson(`${app.base}/auth/firebase`, {});
  assert.equal(res.status, 400);
});

test('a non-string ID token is a 400', async () => {
  const res = await postJson(`${app.base}/auth/firebase`, { idToken: { nope: true } });
  assert.equal(res.status, 400);
});

test('the endpoint says plainly when Firebase is not configured', async () => {
  const saved = process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID;
  delete process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID;
  try {
    const res = await postJson(`${app.base}/auth/firebase`, { idToken: tokenFor(studentEmail) });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /not configured/i);
  } finally {
    process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID = saved;
  }
});

test('repeated failures are rate limited', async () => {
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    const res = await postJson(`${app.base}/auth/firebase`, {
      idToken: tokenFor(studentEmail, { email_verified: false })
    });
    seen.push(res.status);
  }
  assert.ok(seen.includes(429), `expected a 429 among the responses, saw ${seen.join(',')}`);
});
