import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

/**
 * The server refuses any state-changing request that carries a session cookie
 * but no matching CSRF token. That is the correct behaviour, but it means every
 * client write must go through a path that attaches the token. A plain
 * `fetch(url, { method: 'POST' })` is silently rejected at runtime with no
 * build-time warning, so these tests scan the source and fail loudly instead.
 *
 * This caught a real regression: four components and the offline outbox were
 * writing directly and returned 403 in production.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/** Every `fetch(` call site that issues a write. */
function writeCallSites(): Array<{ file: string; snippet: string }> {
  const hits: Array<{ file: string; snippet: string }> = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf-8');
    for (let i = 0; i < src.length; i++) {
      if (src.startsWith('fetch(', i)) {
        // Capture the whole call so a nested secureWrite is not miscounted.
        const snippet = src.slice(i, i + 600);
        if (/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(snippet)) {
          hits.push({ file: relative(process.cwd(), file), snippet });
        }
      }
    }
  }
  return hits;
}

/**
 * Endpoints that are legitimately written without a CSRF token because the
 * caller has no session yet, so there is no ambient authority to abuse. The
 * server enforces exactly this rule: no session cookie means no CSRF check.
 */
const UNAUTHENTICATED_WRITES = ['/api/auth/login', '/api/auth/firebase'];

test('every client write goes through a CSRF-attaching path', () => {
  const offenders = writeCallSites().filter(hit => {
    // A write is acceptable if the same call already sets the header, or is
    // made through a helper that does.
    if (/x-csrf-token/.test(hit.snippet)) return false;
    if (/\bsecureWrite\(/.test(hit.snippet)) return false;
    // ...or if the endpoint is one that cannot carry a session at all.
    if (UNAUTHENTICATED_WRITES.some(path => hit.snippet.includes(path))) return false;
    return true;
  });

  assert.deepEqual(
    offenders.map(o => o.file),
    [],
    'these files call fetch() for a write without attaching the CSRF token; ' +
      'they will be rejected with 403 at runtime. Use secureWrite() from src/lib/api.ts ' +
      'or request() from AppContext, or attach the header explicitly.'
  );
});

test('the unauthenticated-write exemption stays minimal and justified', () => {
  // Each entry is a security decision, so it is asserted rather than assumed.
  for (const path of UNAUTHENTICATED_WRITES) {
    assert.ok(
      path.startsWith('/api/auth/'),
      `refusing to exempt ${path}: only auth endpoints may be written without a token`
    );
  }
});

test('the CSRF-aware helpers exist and are importable', () => {
  const api = readFileSync(join(SRC, 'lib', 'api.ts'), 'utf-8');
  assert.match(api, /export async function secureWrite/, 'secureWrite must be exported');
  assert.match(api, /export function currentCsrfToken/, 'currentCsrfToken must be exported');
  assert.match(api, /x-csrf-token/, 'the header name must be sent');
});

test('the offline outbox replays writes with the CSRF token', () => {
  // A queued action that is rejected on reconnect would strand the student.
  const pending = readFileSync(join(SRC, 'lib', 'pendingActions.ts'), 'utf-8');
  assert.match(pending, /currentCsrfToken/, 'replay must resolve the CSRF token');
  assert.match(pending, /x-csrf-token/, 'replay must send the header');
});

test('the offline outbox still replays with an idempotency key', () => {
  // Replay is a retry; it must not create a second ticket.
  const pending = readFileSync(join(SRC, 'lib', 'pendingActions.ts'), 'utf-8');
  assert.match(pending, /idempotency_key: action\.idempotency_key/);
});

test('signing out sends the CSRF token', () => {
  // Logout clears the cookie; without the header the server would 403 and the
  // student would appear to stay signed in.
  const ctx = readFileSync(join(SRC, 'context', 'AppContext.tsx'), 'utf-8');
  const logout = ctx.slice(ctx.indexOf('/api/auth/logout') - 400, ctx.indexOf('/api/auth/logout') + 200);
  assert.match(logout, /x-csrf-token/, 'logout must attach the CSRF header');
});

test('the server actually enforces the guard it is paired with', () => {
  // Guards the guard: if the server ever stops requiring the header, the client
  // helpers become dead weight and the tests above lose their meaning.
  const auth = readFileSync(join(process.cwd(), 'server', 'auth.ts'), 'utf-8');
  assert.match(auth, /export function csrfGuard/);
  assert.match(auth, /CSRF_HEADER/);
  const app = readFileSync(join(process.cwd(), 'server', 'api.ts'), 'utf-8');
  assert.match(app, /csrfGuard/, 'the guard must be mounted on the API router');
});
