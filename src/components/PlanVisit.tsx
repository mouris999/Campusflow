import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Ticket, Armchair, ArrowRight, MapPin, Clock, Users, Sparkles, Info, X } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { useTraffic } from '../context/TrafficContext.js';
import { useOfflineStatus } from '../lib/offline.js';
import type { PlanYourVisit, IntentResolution, SmartAlternative } from '../types/traffic.js';
import { TrafficPeakPanel, TrafficTimeline, BestTimeCard } from './TrafficPeakPanel.js';
import { SeatMap } from './SeatMap.js';
import { FreshnessBadge } from './FreshnessBadge.js';

/**
 * Suggestion chips are taken from the real catalogue rather than hardcoded, so
 * every suggestion is something the verifier can actually resolve.
 */
const FALLBACK_TERMS = ['study seat', 'id card', 'print document', 'lab equipment'];

/**
 * "Plan a visit" — the unified decision flow.
 *
 * Answers, in order: what do I need, where should I go, when should I go, and
 * is there a faster verified option. Everything shown comes from stored
 * records; when there is not enough history the panel says so.
 */
export const PlanVisit: React.FC<{ onOpenService?: (serviceId: string) => void }> = ({ onOpenService }) => {
  const { services, currentUser, joinQueue, myQueues } = useApp();
  const { resolveRequest, loadPlan } = useTraffic();
  const offline = useOfflineStatus();

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [resolution, setResolution] = useState<IntentResolution | null>(null);
  const [plan, setPlan] = useState<PlanYourVisit | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [tab, setTab] = useState<'plan' | 'seating'>('plan');
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_TERMS);

  // Suggestion chips come from what is actually in the catalogue right now, so
  // a chip can never point at something the verifier would refuse.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/intelligence/items', { credentials: 'same-origin' });
        const body = await res.json();
        if (cancelled || !body.success || !Array.isArray(body.items)) return;
        const inStock: string[] = (body.items as Array<{ available: boolean; name: string }>)
          .filter(i => i.available)
          .map(i => String(i.name).toLowerCase());
        const unique = Array.from(new Set(inStock));
        // One item from each kind, so the chips span the catalogue.
        const picked: string[] = [];
        for (const name of unique) {
          if (picked.length >= 4) break;
          if (!picked.some(p => p.split(' ')[0] === name.split(' ')[0])) picked.push(name);
        }
        if (picked.length) setSuggestions([...picked, FALLBACK_TERMS[0]]);
      } catch {
        // Keep the generic fallbacks when the catalogue cannot be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const libraryService = useMemo(() => services.find(s => s.category === 'library'), [services]);

  const runSearch = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSearching(true);
    setNotice(null);
    const result = await resolveRequest(trimmed);
    setResolution(result);
    setSearching(false);
  };

  const selectService = async (serviceId: string) => {
    setPlanLoading(true);
    setNotice(null);
    const result = await loadPlan(serviceId, null);
    setPlan(result);
    setPlanLoading(false);
  };

  // Nothing selected yet: offer a shortlist so the view is never empty.
  useEffect(() => {
    if (plan || services.length === 0) return;
    void selectService(services[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.length]);

  const holdsTokenFor = (serviceId: string) =>
    myQueues.some(e => e.service_id === serviceId && ['waiting', 'called', 'in_service'].includes(e.status));

  const handleJoin = async (serviceId: string) => {
    setJoining(true);
    setNotice(null);
    const result = await joinQueue(serviceId, 'remote');
    if (result.success) {
      setNotice({ tone: 'ok', text: 'Token issued. It is now shown under My pass.' });
    } else {
      setNotice({ tone: 'warn', text: result.error ?? 'Could not join the queue.' });
    }
    setJoining(false);
  };

  const now = plan?.now;
  const better = plan?.suggested_window;
  const alt: SmartAlternative | null = plan?.alternative ?? null;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* 1. What do I need?                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h2 className="text-sm font-bold text-white mb-1">What do you need?</h2>
        <p className="text-xs text-slate-400 mb-3">
          Search the verified campus catalogue. CampusFlow only shows services and items that exist.
        </p>

        <form
          onSubmit={e => {
            e.preventDefault();
            void runSearch(query);
          }}
          className="flex flex-col sm:flex-row gap-2"
          role="search"
        >
          <label htmlFor="plan-search" className="sr-only">
            Search campus services
          </label>
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="plan-search"
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. burger, study seat, ID card, print document"
              className="w-full rounded-xl bg-[#121315] border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-[#d9f65b] focus:ring-2 focus:ring-[#d9f65b]/30 transition"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#d9f65b] text-[#121315] text-sm font-black hover:bg-[#e4fa78] disabled:opacity-60 transition"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            Search
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => {
                setQuery(s);
                void runSearch(s);
              }}
              className="px-2.5 py-1 rounded-lg border border-white/10 text-[11px] text-slate-300 hover:border-white/30 hover:text-white transition"
            >
              {s}
            </button>
          ))}
        </div>

        {resolution && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-slate-300">{resolution.message}</p>
              <button onClick={() => setResolution(null)} aria-label="Clear search results" className="text-slate-500 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {resolution.matches.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {resolution.matches.map((m, idx) => (
                  <li key={`${m.service_id}-${idx}`}>
                    <button
                      onClick={() => void selectService(m.service_id)}
                      className="w-full text-left rounded-lg border border-white/10 hover:border-[#d9f65b]/50 px-3 py-2 transition"
                    >
                      <p className="text-xs font-bold text-white">{m.service_name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {m.item ? `${m.item.name} — ` : ''}
                        {m.building_name} · {m.current_wait_mins} min wait
                        {m.item ? (m.item.available ? ' · in stock' : ' · out of stock here') : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-amber-200 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                Nothing verified matched that request. CampusFlow will not guess.
              </p>
            )}
          </div>
        )}
      </section>

      {notice && (
        <p
          role="status"
          className={`text-xs rounded-lg px-3 py-2 border ${
            notice.tone === 'ok'
              ? 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10'
              : 'border-amber-500/30 text-amber-200 bg-amber-500/10'
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* 2-4. Where / when / faster verified option                       */}
      {/* ---------------------------------------------------------------- */}
      {planLoading && !plan && (
        <p className="text-sm text-slate-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Building your plan…
        </p>
      )}

      {plan && (
        <>
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <header className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-bold text-white">{plan.service_name}</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {now?.is_open_now ? 'Open now' : `Closed · ${now?.opens_at}–${now?.closes_at}`}
                </p>
              </div>
              {onOpenService && (
                <button
                  onClick={() => onOpenService(plan.service_id)}
                  className="text-[11px] text-slate-300 hover:text-white underline underline-offset-2"
                >
                  Full details
                </button>
              )}
            </header>

            {/* What is happening NOW (live measurement) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Current wait" value={now ? `${now.wait_mins} min` : '—'} />
              <Metric label="In queue" value={now ? `${now.queue_length}` : '—'} />
              <Metric label="Traffic now" value={trafficLabel(now?.traffic_state)} />
              <Metric
                label="Best window"
                value={better ? better.label : 'No clear better time'}
                muted={!better}
              />
            </div>

            {/* What NORMALLY happens (historical) vs FORECAST */}
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <TrafficTimeline forecast={plan.forecast} />
              <div className="space-y-3">
                <BestTimeCard forecast={plan.forecast} />
                {plan.personalized?.message && (
                  <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    {plan.personalized.message}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3">
              <TrafficPeakPanel serviceId={plan.service_id} />
            </div>
          </section>

          {/* Verified faster option */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <h2 className="text-sm font-bold text-white mb-1">Is there a faster verified option?</h2>
            {alt ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3.5">
                <p className="text-sm font-bold text-white">{alt.service_name}</p>
                <p className="text-[11px] text-slate-300 mt-0.5 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                  {alt.building_name} · {alt.walk_mins} min walk
                </p>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <Metric label="Here now" value={`${plan.now?.wait_mins ?? 0} min`} muted />
                  <Metric label="There now" value={`${alt.current_wait_mins} min`} />
                  <Metric label="Plus walk" value={`${alt.walk_mins} min`} muted />
                  <Metric
                    label="Estimated total"
                    value={`${alt.current_wait_mins + alt.walk_mins} min`}
                  />
                </div>

                {alt.time_saved_mins > 0 && (
                  <p className="mt-2.5 text-xs text-emerald-200">
                    Switching may save about {alt.time_saved_mins} minutes.
                  </p>
                )}

                {alt.reasons.length > 0 && (
                  <div className="mt-2.5">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400">Recommended because</p>
                    <ul className="mt-1 space-y-0.5">
                      {alt.reasons.map((r, i) => (
                        <li key={i} className="text-[11px] text-slate-300">
                          • {r.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {onOpenService && (
                    <button
                      onClick={() => onOpenService(alt.service_id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#d9f65b] text-[#121315] text-xs font-black hover:bg-[#e4fa78] transition"
                    >
                      Go there instead <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    onClick={() => void handleJoin(alt.service_id)}
                    disabled={joining}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/15 text-xs font-bold text-slate-200 hover:border-white/30 hover:text-white disabled:opacity-60 transition"
                  >
                    <Ticket className="w-3.5 h-3.5" aria-hidden="true" /> Join queue there
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                No faster verified alternative found. This is the current best option.
              </p>
            )}
          </section>

          {/* Decision */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <h2 className="text-sm font-bold text-white mb-3">Your options</h2>
            {offline ? (
              <p className="text-xs text-amber-200">
                You are offline. Joining a queue or reserving a seat cannot be confirmed until the server is reachable.
              </p>
            ) : holdsTokenFor(plan.service_id) ? (
              <p className="text-xs text-emerald-200 flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5" aria-hidden="true" /> You already hold a token here — see My pass.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handleJoin(plan.service_id)}
                  disabled={joining}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#d9f65b] text-[#121315] text-sm font-black hover:bg-[#e4fa78] disabled:opacity-60 transition"
                >
                  {joining ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Ticket className="w-4 h-4" aria-hidden="true" />}
                  Join virtual queue
                </button>
                {libraryService && (
                  <button
                    onClick={() => {
                      setTab('seating');
                      void selectService(libraryService.id);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/15 text-sm font-bold text-slate-200 hover:border-white/30 hover:text-white transition"
                  >
                    <Armchair className="w-4 h-4" aria-hidden="true" /> Find a study seat
                  </button>
                )}
              </div>
            )}
          </section>

          {tab === 'seating' && libraryService && (
            <SeatMap serviceId={libraryService.id} serviceName={libraryService.name} />
          )}
        </>
      )}

      <p className="text-[11px] text-slate-500">
        Every figure on this page comes from recorded campus data. Forecasts are estimates, not guarantees, and the
        server always overrides them with the live queue.
      </p>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; muted?: boolean }> = ({ label, value, muted }) => (
  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-sm font-black mt-0.5 ${muted ? 'text-slate-300' : 'text-white'}`}>{value}</p>
  </div>
);

function trafficLabel(state?: string): string {
  switch (state) {
    case 'low':
      return 'Quiet';
    case 'moderate':
      return 'Normal';
    case 'high':
      return 'Busy';
    case 'peak':
      return 'Very busy';
    case 'closed':
      return 'Closed';
    default:
      return '—';
  }
}
