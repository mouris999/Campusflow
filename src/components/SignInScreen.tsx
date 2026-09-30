import React, { useEffect, useState } from 'react';
import { ShieldCheck, GraduationCap, UserCog, ServerCrash, RefreshCw } from 'lucide-react';

interface DemoAccount {
  email: string;
  password: string;
  role: 'student' | 'staff' | 'admin';
  name: string;
}

interface SignInScreenProps {
  /**
   * Performs the sign-in. Supplied by AppContext so the session state (and
   * therefore the authenticated UI) is owned in exactly one place.
   */
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  /** Set when the session was rejected or lost, so the user gets an explanation. */
  sessionError?: string | null;
}

const ROLE_META: Record<DemoAccount['role'], { icon: React.ReactNode; label: string; blurb: string }> = {
  student: {
    icon: <GraduationCap className="w-4 h-4" />,
    label: 'Student',
    blurb: 'Find services, join virtual queues, book appointments.'
  },
  staff: {
    icon: <UserCog className="w-4 h-4" />,
    label: 'Staff',
    blurb: 'Run a counter, call students, change capacity, log delays.'
  },
  admin: {
    icon: <ShieldCheck className="w-4 h-4" />,
    label: 'Administrator',
    blurb: 'Review campus-wide waits, peaks, causes and impact.'
  }
};

export const SignInScreen: React.FC<SignInScreenProps> = ({ signIn, sessionError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/demo-accounts', { credentials: 'same-origin' });
        const data = await res.json();
        if (!cancelled && data.success && Array.isArray(data.demo_accounts)) {
          setDemoAccounts(data.demo_accounts);
        }
      } catch {
        // The sign-in form still works without the demo helper.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const result = await signIn(email, password);
    if (!result.success) {
      setError(result.error || 'Sign-in failed. Please try again.');
      setIsSubmitting(false);
    }
    // On success the app context swaps this screen for the signed-in app.
  };

  const useDemo = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#121315] text-[#f2efe7] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="brand-mark inline-flex">↗</span>
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight">CampusFlow</h1>
          <p className="text-sm text-slate-400 mt-2">
            Unified campus services &amp; virtual queue platform
          </p>
        </div>

        <div className="bg-[#1a1b1e] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-1">Sign in</h2>
          <p className="text-xs text-slate-400 mb-5">
            Your role determines what you can see and change. Access is enforced on the server.
          </p>

          {sessionError && (
            <div
              role="status"
              className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200"
            >
              <ServerCrash className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{sessionError}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-3" noValidate>
            <div>
              <label htmlFor="cf-email" className="block text-xs font-semibold text-slate-300 mb-1.5">
                University email
              </label>
              <input
                id="cf-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl bg-[#121315] border border-white/10 px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#d9f65b] focus:ring-2 focus:ring-[#d9f65b]/30 transition"
                placeholder="you@metrouni.edu"
              />
            </div>

            <div>
              <label htmlFor="cf-password" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password
              </label>
              <input
                id="cf-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl bg-[#121315] border border-white/10 px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#d9f65b] focus:ring-2 focus:ring-[#d9f65b]/30 transition"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#d9f65b] px-4 py-3 text-sm font-black text-[#121315] hover:bg-[#e4fa78] disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        {demoAccounts.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2 text-center">
              Demo accounts
            </p>
            <div className="space-y-2">
              {demoAccounts.map(account => {
                const meta = ROLE_META[account.role];
                return (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => useDemo(account)}
                    className="w-full text-left flex items-start gap-3 rounded-xl bg-[#1a1b1e]/70 border border-white/10 hover:border-[#d9f65b]/50 px-3.5 py-3 transition"
                  >
                    <span className="mt-0.5 text-[#d9f65b]">{meta.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-white">
                        {meta.label} · {account.name}
                      </span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">{meta.blurb}</span>
                      <span className="block text-[11px] font-mono text-slate-500 mt-1 truncate">
                        {account.email} / {account.password}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
