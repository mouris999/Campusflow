import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics';

/**
 * Product telemetry (Firebase Analytics).
 *
 * NOT the app's analytics. This tracks how the product is *used* — page views,
 * sessions, which paths get clicked — for the developer. The analytics a campus
 * admin sees lives in `AdminAnalytics.tsx` / `GET /api/analytics` and is
 * computed from server/db.ts. Different audience, different data, never to be
 * presented as one another.
 *
 * Three deliberate departures from a copy-paste Firebase setup:
 *
 *  1. Config comes from env, not source (RULES.md R15), so rotating the Firebase
 *     project is not a code change.
 *  2. `getAnalytics` is behind `isSupported()`. Firebase's own docs require this:
 *     it throws where cookies or storage are blocked. This app has an
 *     offline-aware fetch layer and a service worker, so it must degrade rather
 *     than throw on import.
 *  3. Initialisation is lazy and never awaited on the critical path. Telemetry
 *     must not delay or break the first render.
 *
 * Everything here fails soft and quiet. A telemetry outage is not a user-facing
 * error (R1: no fake success, and equally no fake failure).
 */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
};

const REQUIRED = [
  'apiKey',
  'authDomain',
  'projectId',
  'appId',
  'measurementId',
] as const;

/**
 * True when every required value is present.
 *
 * Measurement ID is required on purpose: without it there is no property to
 * report to, so a half-configured project is treated as unconfigured rather than
 * initialising an Analytics instance that silently sends nothing.
 */
export const isTelemetryConfigured: boolean = REQUIRED.every(key => Boolean(config[key]));

let app: FirebaseApp | null = null;
let analytics: Analytics | null = null;

/**
 * The in-flight init, if any. Concurrent callers await the same promise instead
 * of starting a second initialisation.
 */
let initialising: Promise<Analytics | null> | null = null;

/** Dev-only. Telemetry problems are never surfaced to a user. */
function warn(message: string) {
  if (import.meta.env.DEV) console.warn(`[telemetry] ${message}`);
}

/**
 * Initialise telemetry once. Safe to call repeatedly; concurrent callers share
 * one in-flight promise.
 *
 * Resolves either way — telemetry is never allowed to reject a caller.
 */
async function ensureReady(): Promise<Analytics | null> {
  if (analytics) return analytics;
  if (initialising) return initialising;

  if (!isTelemetryConfigured) {
    warn(
      'not configured — set VITE_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, ' +
        'APP_ID and MEASUREMENT_ID in .env'
    );
    return null;
  }

  const pending = (async (): Promise<Analytics | null> => {
    try {
      if (!(await isSupported())) {
        // Cookies/storage blocked. Expected in private modes; not an error.
        warn('analytics unsupported in this browser — continuing without telemetry');
        return null;
      }
      app = initializeApp(config as Required<typeof config>);
      analytics = getAnalytics(app);
      return analytics;
    } catch (err) {
      warn(`initialisation failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  })();

  initialising = pending;
  try {
    return await pending;
  } finally {
    // Clear only if still this attempt, so a later call can retry after failure.
    if (initialising === pending) initialising = null;
  }
}

/**
 * Record a product event. No-op when unconfigured, unsupported or not yet ready.
 *
 * Fire-and-forget by design: callers should never await this, and a failure here
 * must not surface to the user.
 */
export function trackEvent(name: string, params?: Record<string, string | number | boolean>): void {
  void ensureReady().then(instance => {
    if (!instance) return;
    try {
      logEvent(instance, name, params);
    } catch (err) {
      warn(`event "${name}" dropped: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** Record a screen view. No-op under the same conditions as trackEvent. */
export function trackScreenView(screenName: string): void {
  trackEvent('screen_view', { screen_name: screenName });
}