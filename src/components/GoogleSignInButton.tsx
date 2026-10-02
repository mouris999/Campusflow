import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { firebaseAuthConfigured, signInWithGooglePopup } from '../lib/firebaseAuth';

interface GoogleSignInButtonProps {
  /** Posts the verified token to the server and adopts the returned session. */
  onGoogleToken: (idToken: string) => Promise<{ success: boolean; error?: string }>;
  /** Surfaces the reason above the form when something goes wrong. */
  onError: (message: string) => void;
}

/**
 * "Continue with Google".
 *
 * Renders nothing at all when Firebase is not configured, so a deployment
 * without a Firebase project shows exactly the password form it always did
 * rather than a dead button. That check is the only reason this component is
 * safe to include unconditionally.
 */
export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onGoogleToken,
  onError
}) => {
  const [busy, setBusy] = useState(false);

  if (!firebaseAuthConfigured()) return null;

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);

    const outcome = await signInWithGooglePopup();
    if (!outcome.ok) {
      // A person closing the popup is not an error worth shouting about, so it
      // is not surfaced; anything else is.
      if (!outcome.error.startsWith('The Google sign-in window was closed')) {
        onError(outcome.error);
      }
      setBusy(false);
      return;
    }

    const result = await onGoogleToken(outcome.idToken);
    if (!result.success) {
      onError(result.error || 'Google sign-in failed. Please try again.');
      setBusy(false);
    }
    // On success the app context swaps this screen for the signed-in app.
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 my-4" aria-hidden="true">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">or</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-busy={busy}
        className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#121315] hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        {busy ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" /> Contacting Google…
          </>
        ) : (
          <>
            {/* Google's mark, inline so it costs no request and works offline. */}
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
              <path
                fill="#4285F4"
                d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
              />
              <path
                fill="#34A853"
                d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
              />
              <path
                fill="#FBBC05"
                d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A22 22 0 002 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
              />
              <path
                fill="#EA4335"
                d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
              />
            </svg>
            Continue with Google
          </>
        )}
      </button>

      <p className="mt-2 text-[11px] text-slate-500 text-center leading-snug">
        Google sign-in only works for an account already registered with CampusFlow.
      </p>
    </div>
  );
};
