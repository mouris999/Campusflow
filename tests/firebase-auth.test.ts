import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  firebaseAuthConfigured,
  firebaseProjectId,
  resolveFirebaseUser,
  verifyFirebaseIdToken
} from '../server/firebase-auth.js';
import { db } from '../server/db.js';

/**
 * Firebase ID token verification.
 *
 * The point of these tests is the project pin. Every Firebase project on the
 * internet signs with keys from one shared JWKS endpoint, so a valid signature
 * proves nothing about who minted the token. If the audience check were removed
 * or loosened, a token from an attacker's own Firebase project would be
 * accepted here and they could sign in as any address.
 *
 * Keys are generated locally and injected, so nothing touches the network or the
 * wall clock (R20, R22).
 */

const PROJECT_ID = 'campusflow-test-project';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KID = 'firebase-test-key';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const localKeys: Record<string, crypto.KeyObject> = { [KID]: publicKey };

function resolveLocalKeys(): Promise<Record<string, crypto.KeyObject>> {
  return Promise.resolve(localKeys);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

interface TokenOptions {
  kid?: string;
  alg?: string;
  claims?: Record<string, unknown>;
  /** Sign with a key the resolver does not know, to simulate a rotation gap. */
  foreignKey?: boolean;
}

function makeToken({ kid = KID, alg = 'RS256', claims = {}, foreignKey = false }: TokenOptions = {}): string {
  const header = { alg, kid, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    aud: PROJECT_ID,
    exp: now + 3600,
    iat: now,
    sub: 'firebase-uid-1',
    email: 'alex.rivera@galgotiasuniversity.invalid',
    email_verified: true,
    ...claims
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  let signature: Buffer;
  if (alg === 'none') {
    signature = Buffer.from('');
  } else if (foreignKey) {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), other.privateKey);
  } else {
    signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  }
  return `${signingInput}.${b64url(signature)}`;
}

/** Runs `fn` with the project id set to `value`, restoring it afterwards. */
async function withProjectId<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID;
  if (value === '') delete process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID;
  else process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID;
    else process.env.CAMPUSFLOW_FIREBASE_PROJECT_ID = original;
  }
}

// -------------------------------------------------------------- the pin

test('a valid Firebase token for the configured project is accepted', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(makeToken(), resolveLocalKeys);
    assert.ok(claims, 'expected the token to verify');
    assert.equal(claims.email, 'alex.rivera@galgotiasuniversity.invalid');
    assert.equal(claims.uid, 'firebase-uid-1');
  });
});

test('a token from a DIFFERENT Firebase project is refused even though it is correctly signed', async () => {
  // The attack this test exists to prevent: an attacker registers their own free
  // Firebase project, creates a user with a campus email, and presents the token.
  // The signature is genuine — Google signed it — because every project shares
  // one key set. Only the audience pin refuses it.
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(
      makeToken({
        claims: {
          iss: 'https://securetoken.google.com/attacker-owned-project',
          aud: 'attacker-owned-project'
        }
      }),
      resolveLocalKeys
    );
    assert.equal(claims, null, 'a foreign project must not be able to mint an accepted token');
  });
});

test('a token claiming our audience but a foreign issuer is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(
      makeToken({ claims: { iss: 'https://securetoken.google.com/attacker-owned-project' } }),
      resolveLocalKeys
    );
    assert.equal(claims, null);
  });
});

test('a token claiming our issuer but a foreign audience is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(
      makeToken({ claims: { aud: 'attacker-owned-project' } }),
      resolveLocalKeys
    );
    assert.equal(claims, null);
  });
});

test('an array audience is only accepted when it contains our project', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const ok = await verifyFirebaseIdToken(
      makeToken({ claims: { aud: ['other-project', PROJECT_ID] } }),
      resolveLocalKeys
    );
    assert.ok(ok, 'our id in the array should be enough');

    const refused = await verifyFirebaseIdToken(
      makeToken({ claims: { aud: ['other-project', 'another-project'] } }),
      resolveLocalKeys
    );
    assert.equal(refused, null);
  });
});

test('verification fails closed when no project is configured', async () => {
  await withProjectId('', async () => {
    const claims = await verifyFirebaseIdToken(makeToken(), resolveLocalKeys);
    assert.equal(claims, null, 'with no pin there is nothing to trust, so refuse');
  });
});

test('firebaseAuthConfigured reflects the project id', async () => {
  await withProjectId('', async () => {
    assert.equal(firebaseAuthConfigured(), false);
    assert.equal(firebaseProjectId(), '');
  });
  await withProjectId(PROJECT_ID, async () => {
    assert.equal(firebaseAuthConfigured(), true);
    assert.equal(firebaseProjectId(), PROJECT_ID);
  });
});

test('a blank or whitespace project id counts as unconfigured', async () => {
  await withProjectId('   ', async () => {
    assert.equal(firebaseAuthConfigured(), false);
    const claims = await verifyFirebaseIdToken(makeToken(), resolveLocalKeys);
    assert.equal(claims, null);
  });
});

// --------------------------------------------------------- token hygiene

test('a token signed by an unknown key is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(makeToken({ foreignKey: true }), resolveLocalKeys);
    assert.equal(claims, null);
  });
});

test('an unknown kid is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(makeToken({ kid: 'rotated-away' }), resolveLocalKeys);
    assert.equal(claims, null);
  });
});

test('alg=none is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(makeToken({ alg: 'none' }), resolveLocalKeys);
    assert.equal(claims, null);
  });
});

test('a symmetric algorithm is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(makeToken({ alg: 'HS256' }), resolveLocalKeys);
    assert.equal(claims, null);
  });
});

test('a tampered payload is refused because the signature no longer matches', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const token = makeToken();
    const [header, payload, signature] = token.split('.');
    // Same header and signature, altered payload: a genuine signature over
    // different bytes must not verify.
    const altered = b64url(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')),
        role: 'admin'
      })
    );
    const claims = await verifyFirebaseIdToken(`${header}.${altered}.${signature}`, resolveLocalKeys);
    assert.equal(claims, null);
  });
});

test('a correctly signed token cannot smuggle a role: the claim is ignored entirely', async () => {
  // The stronger version of the test above. Here the signature is perfectly
  // valid, so only the design protects us: no code path reads a role out of the
  // token. Roles come from the database and nowhere else.
  await withProjectId(PROJECT_ID, async () => {
    const student = db.getUsers().find(u => u.role === 'student')!;
    const claims = await verifyFirebaseIdToken(
      makeToken({ claims: { email: student.email, role: 'admin', admin: true } }),
      resolveLocalKeys
    );
    assert.ok(claims, 'the token itself is valid');
    assert.equal(
      Object.prototype.hasOwnProperty.call(claims, 'role'),
      false,
      'no role should be carried out of the verifier at all'
    );

    const resolved = resolveFirebaseUser(claims!.email);
    assert.equal(resolved.user?.role, 'student', 'the database role wins');
  });
});

test('an expired token is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(
      makeToken({ claims: { exp: Math.floor(Date.now() / 1000) - 60 } }),
      resolveLocalKeys
    );
    assert.equal(claims, null);
  });
});

test('a missing or unverified email is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    assert.equal(
      (await verifyFirebaseIdToken(makeToken({ claims: { email_verified: false } }), resolveLocalKeys))?.email,
      undefined
    );
    assert.equal(
      (await verifyFirebaseIdToken(makeToken({ claims: { email_verified: undefined } }), resolveLocalKeys))?.email,
      undefined
    );
  });
});

test('a missing uid is refused', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(makeToken({ claims: { sub: '' } }), resolveLocalKeys);
    assert.equal(claims, null);
  });
});

test('malformed input is refused without throwing', async () => {
  await withProjectId(PROJECT_ID, async () => {
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d', '...', 'null', '{}']) {
      const claims = await verifyFirebaseIdToken(bad, resolveLocalKeys);
      assert.equal(claims, null, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });
});

test('a key resolver that throws refuses the token rather than accepting it', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(makeToken(), () => Promise.reject(new Error('jwks down')));
    assert.equal(claims, null);
  });
});

test('the sign_in_provider is surfaced for the audit trail', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const claims = await verifyFirebaseIdToken(
      makeToken({ claims: { firebase: { sign_in_provider: 'google.com' } } }),
      resolveLocalKeys
    );
    assert.equal(claims?.sign_in_provider, 'google.com');
  });
});

// ------------------------------------------------------------ role mapping

test('an unregistered email is refused rather than auto-provisioned', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const result = resolveFirebaseUser('nobody-at-all@example.com');
    assert.equal(result.user, undefined);
    assert.equal(result.failure, 'not_registered');
  });
});

test('a registered email keeps the role the database gives it, not a claimed one', async () => {
  await withProjectId(PROJECT_ID, async () => {
    const student = db.getUsers().find(u => u.role === 'student')!;
    const result = resolveFirebaseUser(student.email.toUpperCase());
    assert.ok(result.user, 'expected the existing account to be found');
    assert.equal(result.user.role, 'student');
    assert.equal(result.user.id, student.id);
  });
});

test('resolving refuses when Firebase is unconfigured', async () => {
  await withProjectId('', async () => {
    const result = resolveFirebaseUser('anyone@example.com');
    assert.equal(result.user, undefined);
    assert.equal(result.failure, 'unconfigured');
  });
});
