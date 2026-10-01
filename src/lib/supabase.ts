import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase browser client.
 *
 * Reads the two `VITE_` variables, which Vite inlines at build time, so these
 * are the only values that reach the browser bundle. The publishable key is
 * safe to ship: it grants nothing on its own — every table and function has to
 * be opened up by an RLS policy first. Never add the secret / `service_role`
 * key here; it would be public.
 *
 * Mirrors what the `supabase-client-react-router` shadcn block installs,
 * minus the server client and route loaders: this app has no React Router, so
 * a single browser-side client is the whole piece.
 *
 * Nothing here is wired into a feature yet. Per R1 the guard below reports
 * "not configured" honestly rather than letting a call fail somewhere deeper.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** True when both variables are present and non-empty. */
export const isSupabaseConfigured = Boolean(url && publishableKey);

/**
 * The Supabase client, or `null` when the environment variables are missing.
 *
 * Prefer importing this over constructing a client yourself: one instance means
 * one shared auth session and one realtime connection.
 *
 * Returns `null` instead of throwing, so a missing key degrades to the existing
 * behaviour rather than taking down the app on import.
 */
function makeClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) {
    console.error(
      '[supabase] Not configured. Set VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_PUBLISHABLE_KEY in .env, then restart the dev server.'
    );
    return null;
  }
  return createClient(url!, publishableKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase: SupabaseClient | null = makeClient();

/** The project URL, or `null` when unconfigured. Useful for auth redirects. */
export const supabaseUrl: string | null = url || null;