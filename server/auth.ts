import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import { DATA_DIR } from './paths.js';
import type { UserProfile } from '../src/types/index.js';

export type Role = 'student' | 'staff' | 'admin';

export const SESSION_COOKIE = 'cf_session';
/** Sessions are valid for 12 hours. */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Demo credentials.
 *
 * These exist so the platform can be evaluated without a mail provider. They
 * are refused outright when CAMPUSFLOW_DEMO_AUTH is explicitly "false"; the
 * seeded accounts can be given real passwords through db.setUserPassword().
 */
const DEMO_PASSWORDS: Record<string, string> = {
  'usr-student-1': 'student123',
  'usr-student-2': 'student123',
  'usr-staff-1': 'staff123',
  'usr-staff-2': 'staff123',
  'usr-admin-1': 'admin123'
};

export function demoAuthEnabled(): boolean {
  return process.env.CAMPUSFLOW_DEMO_AUTH !== 'false';
}

// ---------------------------------------------------------------- passwords

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

/** Hashes a password with scrypt and a per-user random salt. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return ['scrypt', SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p, salt.toString('hex'), derived.toString('hex')].join('$');
}

/** Constant-time verification of a password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Resolves the stored hash for a user: an explicit password set through
 * setUserPassword always wins, otherwise the demo password is used.
 */
export function passwordHashFor(userId: string): string | null {
  const stored = db.getPasswordHash(userId);
  if (stored) return stored;
  if (!demoAuthEnabled()) return null;
  const demo = DEMO_PASSWORDS[userId];
  return demo ? hashPassword(demo) : null;
}

export function authenticate(emailOrCode: string, password: string): UserProfile | null {
  const identifier = String(emailOrCode ?? '').trim().toLowerCase();
  if (!identifier || !password) return null;

  const user = db.getUsers().find(
    u => u.email.toLowerCase() === identifier || u.id.toLowerCase() === identifier || u.id_code.toLowerCase() === identifier
  );
  if (!user) {
    // Burn comparable time so a missing account is not distinguishable by timing.
    crypto.scryptSync(password, 'absent-user-salt', SCRYPT_KEYLEN, SCRYPT_PARAMS);
    return null;
  }

  const hash = passwordHashFor(user.id);
  if (!hash) return null;
  return verifyPassword(password, hash) ? user : null;
}

// ----------------------------------------------------------------- sessions

/**
 * Sessions are stateless and signed rather than looked up in a table.
 *
 * Serverless platforms run many short-lived instances with no shared memory or
 * disk, so a session stored in process memory only exists on the instance that
 * created it: a login would land on one instance and the very next request
 * could hit another and be rejected. Signing the identity means any instance
 * can verify a session with nothing but the shared secret.
 */
export interface Session {
  token: string;
  user_id: string;
  issued_at: number;
  expires_at: number;
  /** A session issued before this instant is refused; used to revoke all. */
  revoked_before?: number;
}

let cachedSecret: Buffer | null = null;

/**
 * The signing secret. Set CAMPUSFLOW_SESSION_SECRET in the environment for a
 * real deployment; otherwise a per-deployment secret file is generated so
 * local development still works without configuration.
 */
function sessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.CAMPUSFLOW_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = crypto.createHash('sha256').update(fromEnv).digest();
    return cachedSecret;
  }

  const secretFile = path.join(DATA_DIR, '.session-secret');
  try {
    if (fs.existsSync(secretFile)) {
      cachedSecret = Buffer.from(fs.readFileSync(secretFile, 'utf-8').trim(), 'hex');
      if (cachedSecret.length === 32) return cachedSecret;
    }
  } catch {
    // Fall through and regenerate.
  }

  const generated = crypto.randomBytes(32);
  try {
    fs.writeFileSync(secretFile, generated.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Read-only bundle: the secret is still valid for this instance's lifetime.
  }
  cachedSecret = generated;
  return cachedSecret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function createSession(userId: string): Session {
  const issued = Date.now();
  // Carry the user's current revocation floor so a token minted before a
  // revoke-all is rejected afterwards.
  const revokedBefore = db.getSessionRevocationFloor(userId) ?? 0;
  const payload = b64url(
    JSON.stringify({ u: userId, iat: issued, exp: issued + SESSION_IDLE_MS, r: revokedBefore })
  );
  return {
    token: `${payload}.${sign(payload)}`,
    user_id: userId,
    issued_at: issued,
    expires_at: issued + SESSION_IDLE_MS,
    revoked_before: revokedBefore
  };
}

/**
 * Invalidates every session issued for a user before now. The next sign-in
 * mints a token carrying the new floor, so older cookies stop working without
 * any server-side session table.
 */
export function revokeAllSessionsFor(userId: string): void {
  db.setSessionRevocationFloor(userId, Date.now());
}

/** Verifies the signature and expiry. Returns null for anything untrusted. */
export function resolveSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      u: string;
      iat: number;
      exp: number;
      r?: number;
    };
    if (typeof decoded?.u !== 'string' || typeof decoded?.exp !== 'number') return null;
    if (Date.now() >= decoded.exp) return null;
    // A user must still exist for the session to mean anything.
    if (!db.getUserById(decoded.u)) return null;
    // Revoked if the user asked to sign out everywhere after this was issued.
    const floor = db.getSessionRevocationFloor(decoded.u) ?? 0;
    if (decoded.iat < floor) return null;
    return {
      token,
      user_id: decoded.u,
      issued_at: decoded.iat,
      expires_at: decoded.exp,
      revoked_before: floor
    };
  } catch {
    return null;
  }
}

/**
 * Sessions cannot be revoked individually once signed, so signing out clears
 * the cookie. This keeps the audit record of the event.
 */
export function destroySession(_token: string): void {
  // No server-side state to delete; the client drops the cookie.
}

// -------------------------------------------------------------- cookies

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_IDLE_MS / 1000)}${secure}`
  );
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

// ------------------------------------------------------- CSRF protection

export const CSRF_COOKIE = 'cf_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF token.
 *
 * The token is derived from the session token and the signing secret, so it
 * needs no extra storage, and it is bound to the session it was issued for.
 * Safe methods are exempt; a cross-site form cannot read the cookie, so it
 * cannot produce a matching header.
 */
export function csrfTokenFor(sessionToken: string): string {
  return crypto
    .createHmac('sha256', sessionSecret())
    .update(`csrf:${sessionToken}`)
    .digest('base64url')
    .slice(0, 43);
}

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejects state-changing requests that do not prove same-origin intent.
 *
 * Two independent checks, because either alone has a gap:
 *   1. Origin/Referer must match the request host (blocks classic form posts).
 *   2. When a session cookie is present, the CSRF header must match the token
 *      derived from that session (blocks subdomain and same-site attackers).
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Sign-in is exempt from the token check, and must stay exempt.
  //
  // Login *establishes* a session rather than acting with one, so there is no
  // ambient authority for a third-party site to ride. Requiring a token derived
  // from the existing session has a real, observed failure: a browser carrying
  // any session cookie - including a stale, expired, or same-host cookie left by
  // another deployment - cannot sign in at all, and is locked out on a CSRF
  // error. The Origin check still applies to login, which is the part that
  // actually matters against a cross-site sign-in attempt.
  if (isSignInRoute(req)) {
    if (originMatchesHost(req)) {
      next();
      return;
    }
    res.status(403).json({ success: false, error: 'Request blocked: cross-origin sign-in refused.' });
    return;
  }

  // A JSON client that sends no cookies at all is not doing ambient-authority
  // work, so there is nothing for a third-party site to ride on.
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE];
  if (!sessionToken) {
    next();
    return;
  }

  if (!originMatchesHost(req)) {
    res.status(403).json({ success: false, error: 'Request blocked: cross-origin request refused.' });
    return;
  }

  const header = req.headers[CSRF_HEADER];
  if (typeof header === 'string' && header.length > 0) {
    if (timingSafeEquals(header, csrfTokenFor(sessionToken))) {
      next();
      return;
    }
  }

  res.status(403).json({
    success: false,
    error: 'Request blocked: missing or invalid CSRF token. Refresh the page and try again.'
  });
}

/**
 * Sign-in routes, mounted at /auth or behind /api.
 *
 * These establish a session rather than using one, so they are exempt from the
 * token check; the Origin check still applies. Any new entry here is a security
 * decision, which is why `tests/auth.test.ts` and `csrf-coverage.test.ts` both
 * assert the list rather than assuming it.
 */
const SIGN_IN_ROUTES = ['/auth/login', '/auth/firebase'];

function isSignInRoute(req: Request): boolean {
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
  return SIGN_IN_ROUTES.some(route => path === route || path === `/api${route}`);
}

/**
 * True when the request's Origin, or failing that its Referer, is the same host
 * it was sent to.
 *
 * A header that is present but unparseable is refused rather than treated as
 * absent, so a malformed Origin cannot be used to skip the check.
 */
function originMatchesHost(req: Request): boolean {
  const host = req.headers.host;
  const origin = req.headers.origin;

  if (origin) {
    try {
      if (host && new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
    return true;
  }

  const referer = req.headers.referer;
  if (referer) {
    if (!host) return true;
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // Neither header present. Same-origin browser XHR sends at least one, so this
  // is a non-browser client; the token check still applies to it.
  return true;
}

// ------------------------------------------------------------- middleware

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  session?: Session;
}

/**
 * Resolves the caller from the session cookie but never rejects. Read-only
 * public routes use this so handlers can personalise output when possible.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = resolveSession(token);
  if (session) {
    const user = db.getUserById(session.user_id);
    if (user) {
      (req as AuthenticatedRequest).user = user;
      (req as AuthenticatedRequest).session = session;
    }
  }
  next();
}

/** Rejects anonymous callers. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authed = req as AuthenticatedRequest;
  if (!authed.user) {
    res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
    return;
  }
  next();
}

/** Rejects callers whose role is not in `roles`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authed = req as AuthenticatedRequest;
    if (!authed.user) {
      res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
      return;
    }
    if (!roles.includes(authed.user.role)) {
      res.status(403).json({
        success: false,
        error: `This action requires ${roles.join(' or ')} permissions. Your role is ${authed.user.role}.`
      });
      return;
    }
    next();
  };
}

/**
 * Allows the action when the caller owns the record, or holds staff/admin.
 * Used so a student can only ever act on their own queue ticket.
 */
export function requireSelfOrRole(getOwnerId: (req: Request) => string | undefined, ...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authed = req as AuthenticatedRequest;
    if (!authed.user) {
      res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
      return;
    }
    if (roles.includes(authed.user.role)) {
      next();
      return;
    }
    const ownerId = getOwnerId(req);
    if (ownerId && ownerId === authed.user.id) {
      next();
      return;
    }
    res.status(403).json({ success: false, error: 'You are not allowed to access another student record.' });
  };
}

/**
 * Strips fields a viewer is not entitled to see. Staff/admin keep the full
 * record; everyone else only ever sees their own.
 */
export function redactForViewer<T extends { user_id: string; student_name: string; student_id_code: string }>(
  entry: T,
  viewer: UserProfile | undefined
): T & { is_own: boolean } {
  const isPrivileged = viewer?.role === 'staff' || viewer?.role === 'admin';
  const isOwn = !!viewer && viewer.id === entry.user_id;
  if (isPrivileged || isOwn) return { ...entry, is_own: isOwn };
  return {
    ...entry,
    student_name: 'Student',
    student_id_code: '—',
    is_own: false
  };
}
