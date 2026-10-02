import type { UserProfile } from '../src/types/index.js';
import { db } from './db.js';
import {
  parseClaims,
  parseVerifiedHeader,
  secureTokenPublicKeys,
  signatureIsValid
} from './jwks.js';

/**
 * Firebase ID token verification.
 *
 * Firebase Auth mints its own JWT. It is NOT the token Google Identity Services
 * returns: the issuer is `securetoken.google.com/<projectId>`, not
 * `accounts.google.com`, and the audience is the bare project id. So a Firebase
 * token cannot be verified by a Google-Identity-Services verifier and vice
 * versa. Firebase Auth is the one supported Google sign-in flow; this verifier
 * exists specifically because its tokens carry a different issuer and audience
 * than Google Identity Services tokens do.
 *
 * ---------------------------------------------------------------------------
 * THE PROJECT PIN IS LOAD-BEARING. Read this before changing the audience check.
 * ---------------------------------------------------------------------------
 * Every Firebase project on the internet signs with keys from ONE shared JWKS
 * endpoint (`secureTokenPublicKeys`). A valid RS256 signature therefore proves
 * only that *some* Firebase project signed the token, not that it was ours.
 *
 * If this module accepted a well-formed, correctly signed token whose audience
 * was any project id, then an attacker could stand up their own free Firebase
 * project, create a user called `admin@galgotiasuniversity.invalid`, sign a token for it, and
 * present it here. Signature valid, expiry valid, email_verified true, and the
 * server would hand over an admin session for an address it does not own.
 *
 * That is why `aud` is compared against CAMPUSFLOW_FIREBASE_PROJECT_ID and `iss`
 * is compared against the `securetoken.google.com/<projectId>` form of that same
 * value. Together they bind the token to exactly one project. With the pin in
 * place an attacker cannot mint a token for our audience, because only our
 * project's private keys can.
 *
 * A second, independent layer: `resolveFirebaseUser` still requires the email to
 * already exist as a campus account. Even a valid token for the right project
 * cannot invent a user or grant a role.
 */

/** Firebase's issuer prefix. The project id is appended to it. */
const FIREBASE_ISSUER_PREFIX = 'https://securetoken.google.com/';

/**
 * The Firebase project this deployment trusts.
 *
 * Server-side only, deliberately without the `VITE_` prefix: it is part of the
 * trust decision, not a UI setting. Unset means Firebase sign-in is off, and
 * verification fails closed rather than trusting whatever audience arrives.
 */
export function firebaseProjectId(): string {
  const id = (process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID ?? '').trim();
  return id.length > 0 ? id : '';
}

export function firebaseAuthConfigured(): boolean {
  return firebaseProjectId().length > 0;
}

export interface FirebaseClaims {
  email: string;
  email_verified: boolean;
  /** Firebase's own uid for this user. Stable per project. */
  uid: string;
  /** Which provider actually authenticated them, for the audit trail. */
  sign_in_provider?: string;
}

/**
 * Verifies a Firebase ID token and returns its claims, or null when it cannot be
 * trusted.
 *
 * Checks in order: project configured, structure, algorithm, signature, audience
 * pin, issuer pin, expiry, uid, and that the email is provider-verified.
 *
 * The key resolver is injectable so this stays unit-testable with locally
 * generated keys and no network access (R22).
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  resolveKeys: () => Promise<Record<string, import('node:crypto').KeyObject>> = secureTokenPublicKeys
): Promise<FirebaseClaims | null> {
  if (typeof idToken !== 'string' || !idToken) return null;

  // No configured project means there is nothing to pin the audience to, and an
  // unpinned verifier is the vulnerability described above. Refuse outright.
  const projectId = firebaseProjectId();
  if (!projectId) return null;

  const parsed = parseVerifiedHeader(idToken);
  if (!parsed) return null;
  const { header, payloadSeg, signatureSeg } = parsed;

  let keys: Record<string, import('node:crypto').KeyObject>;
  try {
    keys = await resolveKeys();
  } catch {
    return null;
  }
  const key = keys[header.kid!];
  if (!key) return null;

  // Recompute the exact signed input rather than trusting a reconstructed one.
  const headerSeg = idToken.split('.')[0];
  if (!signatureIsValid(headerSeg, payloadSeg, signatureSeg, key)) return null;

  const claims = parseClaims<{
    iss?: string;
    aud?: string | string[];
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    firebase?: { sign_in_provider?: string };
  }>(payloadSeg);
  if (!claims) return null;

  // --- the project pin ------------------------------------------------------
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(projectId)) return null;
  if (claims.iss !== `${FIREBASE_ISSUER_PREFIX}${projectId}`) return null;

  if (typeof claims.exp !== 'number' || Date.now() >= claims.exp * 1000) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (typeof claims.email !== 'string' || !claims.email) return null;
  // An unverified address is not proof of identity.
  if (claims.email_verified !== true) return null;

  return {
    email: claims.email.trim().toLowerCase(),
    email_verified: true,
    uid: claims.sub,
    sign_in_provider: claims.firebase?.sign_in_provider
  };
}

export type FirebaseSignInFailure = 'unconfigured' | 'untrusted_token' | 'not_registered';

/**
 * Declared independently rather than extending GoogleSignInResult: the failure
 * union here is wider (it adds `unconfigured`), and an interface cannot widen a
 * union it inherits.
 */
export interface FirebaseSignInResult {
  user?: UserProfile;
  failure?: FirebaseSignInFailure;
}

/**
 * Maps a verified Firebase identity onto an existing campus account.
 *
 * The role comes from the database, never from Firebase, so a Google-verified
 * email can reach only the permissions it already had. An unknown email is
 * refused rather than auto-provisioned.
 */
export function resolveFirebaseUser(email: string): FirebaseSignInResult {
  if (!firebaseAuthConfigured()) return { failure: 'unconfigured' };

  const identifier = email.trim().toLowerCase();
  const user = db.getUsers().find(u => u.email.trim().toLowerCase() === identifier);
  if (!user) return { failure: 'not_registered' };
  return { user };
}

export type { UserProfile };
