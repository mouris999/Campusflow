import crypto from 'node:crypto';

/**
 * Google's secure-token public keys, shared by every Google ID token and every
 * Firebase ID token.
 *
 * Both token families are signed by the same key set behind the same endpoint,
 * so one cache serves both verifiers. Cached per process and refetched at most
 * hourly, because Google rotates these keys and a stale map would reject
 * perfectly valid new tokens until it expired.
 */

/** Google's signing keys. Fetched once per process and reused. */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
/** Google's keys rotate; refetch no more often than this. */
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

let cachedKeys: Record<string, crypto.KeyObject> | null = null;
let cachedAt = 0;

/** Exposed so a test can force a refetch. */
export function resetJwksCache(): void {
  cachedKeys = null;
  cachedAt = 0;
}

/**
 * Fetches Google's public keys and keeps them as KeyObjects, keyed by `kid`.
 *
 * Fails closed: any error is thrown, never swallowed into an empty map that
 * would be indistinguishable from "unknown kid". Callers treat a throw as
 * "reject the token", which is the safe direction.
 */
export async function secureTokenPublicKeys(): Promise<Record<string, crypto.KeyObject>> {
  if (cachedKeys && Date.now() - cachedAt < JWKS_TTL_MS) return cachedKeys;

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys: Record<string, crypto.KeyObject> = {};
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
    keys[jwk.kid] = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
  }
  if (Object.keys(keys).length === 0) throw new Error('Google JWKS response had no usable keys');
  cachedKeys = keys;
  cachedAt = Date.now();
  return keys;
}

export function b64urlToBuffer(segment: string): Buffer {
  return Buffer.from(segment, 'base64url');
}

/**
 * Reads and checks a JWT's header.
 *
 * Google signs with RS256. Refusing anything else means an attacker cannot
 * downgrade to `none`, or to a symmetric algorithm we might be tricked into
 * verifying with a public key. Returns null for anything unrecognisable, and the
 * caller treats null as "refuse".
 */
export function parseVerifiedHeader(
  token: string
): { header: { alg?: string; kid?: string }; payloadSeg: string; signatureSeg: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, signatureSeg] = parts;

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(b64urlToBuffer(headerSeg).toString('utf-8'));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object') return null;
  if (header.alg !== 'RS256' || !header.kid) return null;

  return { header, payloadSeg, signatureSeg };
}

/** Verifies the RS256 signature over `headerSeg.payloadSeg`. */
export function signatureIsValid(
  headerSeg: string,
  payloadSeg: string,
  signatureSeg: string,
  key: crypto.KeyObject
): boolean {
  try {
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${headerSeg}.${payloadSeg}`),
      key,
      b64urlToBuffer(signatureSeg)
    );
  } catch {
    return false;
  }
}

/** The raw `headerSeg.payloadSeg` string, needed to reproduce the signed input. */
export function signedInput(headerSeg: string, payloadSeg: string): string {
  return `${headerSeg}.${payloadSeg}`;
}

export function parseClaims<T>(payloadSeg: string): T | null {
  try {
    return JSON.parse(b64urlToBuffer(payloadSeg).toString('utf-8')) as T;
  } catch {
    return null;
  }
}
