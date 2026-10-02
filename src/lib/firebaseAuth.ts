/**
 * Firebase Auth, used for the "Continue with Google" button.
 *
 * Firebase Auth is the Google sign-in provider, alongside the campus email and
 * password form. It proves identity and nothing more: the campus role always
 * comes from the server database, and an email with no existing account is
 * refused rather than provisioned. Verification lives in
 * `server/firebase-auth.ts`.
 *
 * Two things are deliberate here:
 *
 * 1. The SDK is imported dynamically. Firebase is a large dependency and this is
 *    an optional sign-in method, so it must not be in the main bundle. Nobody
 *    who never touches the button pays for it.
 *
 * 2. Nothing throws when unconfigured. `firebaseAuthConfigured` reports the gap
 *    and the caller renders nothing, so a deployment with no Firebase project
 *    behaves exactly as before this existed, rather than showing a button that
 *    cannot work.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined
};

/**
 * True only when every value Firebase Auth actually needs is present.
 *
 * Checked before rendering so the button never appears without a working
 * backend behind it. Storage and messaging are not needed for auth and are
 * deliberately not required.
 */
export function firebaseAuthConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

/** Which variable is missing, for an operator-facing message. Never rendered to users. */
export function firebaseAuthMissing(): string[] {
  const required: Array<[string, string | undefined]> = [
    ['VITE_FIREBASE_API_KEY', config.apiKey],
    ['VITE_FIREBASE_AUTH_DOMAIN', config.authDomain],
    ['VITE_FIREBASE_PROJECT_ID', config.projectId],
    ['VITE_FIREBASE_APP_ID', config.appId]
  ];
  return required.filter(([, value]) => !value || !value.trim()).map(([name]) => name);
}

let appPromise: Promise<FirebaseApp> | null = null;
let authPromise: Promise<Auth> | null = null;

/** Initialises the Firebase app once per page load. */
async function firebaseApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = (async () => {
      const { initializeApp, getApps, getApp } = await import('firebase/app');
      // Reuse an existing app if Firebase initialised elsewhere first, rather
      // than throwing on a duplicate-app error.
      return getApps().length ? getApp() : initializeApp(config as Record<string, string>);
    })();
  }
  return appPromise;
}

async function firebaseAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = (async () => {
      const { getAuth } = await import('firebase/auth');
      return getAuth(await firebaseApp());
    })();
  }
  return authPromise;
}

export type GoogleSignInOutcome =
  | { ok: true; idToken: string }
  | { ok: false; error: string };

/**
 * Completes the Google popup and returns the Firebase ID token for the server
 * to verify.
 *
 * The token is a Firebase JWT, not a Google one: issuer
 * `securetoken.google.com/<projectId>`. The server has a dedicated verifier for
 * exactly that, which pins the project id.
 */
export async function signInWithGooglePopup(): Promise<GoogleSignInOutcome> {
  if (!firebaseAuthConfigured()) {
    return { ok: false, error: 'Google sign-in is not configured on this deployment.' };
  }

  try {
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    // Ask only for what sign-in needs. Without this Firebase returns a large
    // profile blob the server has no use for.
    provider.addScope('email');
    provider.addScope('profile');

    const credential = await signInWithPopup(await firebaseAuth(), provider);
    const user = credential.user;
    if (!user) return { ok: false, error: 'Google sign-in did not return an account.' };

    const idToken = await user.getIdToken();
    if (!idToken) return { ok: false, error: 'Google sign-in did not return an ID token.' };

    return { ok: true, idToken };
  } catch (error) {
    return { ok: false, error: describePopupError(error) };
  }
}

/**
 * Turns a Firebase error into something a person can act on.
 *
 * Deliberately does not surface raw Firebase codes: "auth/popup-closed-by-user"
 * means nothing to a student who simply closed the window.
 */
function describePopupError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';

  if (code.includes('popup-closed-by-user')) {
    return 'The Google sign-in window was closed before it finished. Please try again.';
  }
  if (code.includes('popup-blocked')) {
    return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
  }
  if (code.includes('network-request-failed')) {
    return 'Could not reach Google. Check your connection and try again.';
  }
  if (code.includes('operation-not-allowed')) {
    return 'Google sign-in is not enabled for this project yet. Use your email and password.';
  }
  if (code.includes('unauthorized-domain')) {
    return 'This site is not authorised for Google sign-in yet. Use your email and password.';
  }
  return 'Google sign-in could not be completed. Please try again, or use your email and password.';
}
