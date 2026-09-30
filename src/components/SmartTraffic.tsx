/**
 * Smart Traffic tab.
 *
 * Three questions, in the order a student asks them:
 *   1. What do I need, and where can I actually get it?  (verified request search)
 *   2. How busy is everything right now?                 (live campus pulse)
 *   3. When should I go, or should I go somewhere else?  (peak forecast + plan)
 *
 * Nothing on this page is estimated without a recorded basis. Where the
 * database cannot answer, the page says so instead of guessing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  Clock,
  MapPin,
  Search,
  Sparkles,
  TrendingUp,
  X
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { useTraffic } from '../context/TrafficContext.js';
import type { Service } from '../types/index.js';
import type { IntentResolution, PeakWindow, ServiceItem, SmartAlternative } from '../types/traffic.js';
import { TRAFFIC_STATE_META } from '../types/traffic.js';
import { ConfidenceTag, EmptyNote, Panel, TrafficBadge } from './traffic/TrafficBits.js';
import { DemandChart } from './traffic/DemandChart.js';
import { AlternativeCard } from './traffic/AlternativeCard.js';

interface SmartTrafficProps {
  onSelectService: (service: Service) => void;
  onJoinQueue: (service: Service) => void;
}

const SAMPLE_REQUESTS = ['veg thali', 'study room', 'id card', 'print document', 'projector'];

export const SmartTraffic: React.FC<SmartTrafficProps> = ({ onSelectService, onJoinQueue }) => {
  const { services } = useApp();
  const {
    overview,
    trafficByService,
    forecasts,
    alerts,
    dismissAlert,
    resolveRequest,
    loadForecast,
    loadItems,
    loadAlternatives,
    isLoading
  } = useTraffic();

  const [query, setQuery] = useState('');
  const [resolution, setResolution] = useState<IntentResolution | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [alternatives, setAlternatives] = useState<SmartAlternative[]>([]);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);
  const requestedForecasts = useRef<Set<string>>(new Set());

  const sortedServices = useMemo(() => {
    const list = overview?.services ?? [];
    const severity = (state: string) => TRAFFIC_STATE_META[state as keyof typeof TRAFFIC_STATE_META]?.label ?? state;
    return [...list].sort(
      (a, b) => b.current_wait_mins - a.current_wait_mins || severity(a.traffic_state).localeCompare(severity(b.traffic_state))
    );
  }, [overview]);

  const selected = selectedId ?? sortedServices[0]?.service_id ?? null;
  const selectedService = services.find(s => s.id === selected) ?? null;
  const selectedTraffic = selected ? trafficByService[selected] : null;
  const forecast = selected ? forecasts[selected] : null;

  useEffect(() => {
    // Guarded by a ref: re-running this on every `forecasts` change would
    // re-fetch, which would set `forecasts` again, forever.
    if (!selected || requestedForecasts.current.has(selected)) return;
    requestedForecasts.current.add(selected);
    loadForecast(selected);
  }, [selected, loadForecast]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setItems([]);
      setAlternatives([]);
      return;
    }
    loadItems(selected).then(result => {
      if (!cancelled) setItems(result);
    });
    setIsLoadingAlternatives(true);
    loadAlternatives(selected).then(result => {
      if (cancelled) return;
      setAlternatives(result?.recommended ?? []);
      setIsLoadingAlternatives(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, loadItems, loadAlternatives]);

  const handleResolve = useCallback(async () => {
    const text = query.trim();
    if (!text) {
      setResolution(null);
      return;
    }
    setIsResolving(true);
    const result = await resolveRequest(text);
    setResolution(result);
    setIsResolving(false);
    if (result?.matches.length) {
      setQuery(result.resolved_item?.name ?? result.matches[0].service_name);
    }
  }, [query, resolveRequest]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
            <Activity className="mr-1.5 inline h-3 w-3" />
            Traffic intelligence
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
            Know the queue <span className="text-[#d9f65b]">before</span> you walk over
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Every wait, peak and availability note on this page comes from recorded CampusFlow data.
            When we do not have the records, we tell you instead of estimating.
          </p>
        </div>
        {overview && (
          <p className="font-mono text-[10px] text-slate-500">
            model {overview.model_version} · show an alternative only when it saves at least{' '}
            {overview.min_net_saved_mins} min
          </p>
        )}
      </header>

      {alerts.length > 0 && (
        <section className="space-y-2">
          {alerts.slice(0, 3).map(alert => (
            <article
              key={alert.key}
              className={`flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3 ${
                alert.severity === 'alert'
                  ? 'border-rose-400/30 bg-rose-500/10'
                  : alert.severity === 'warning'
                    ? 'border-amber-400/30 bg-amber-500/10'
                    : 'border-sky-400/30 bg-sky-500/10'
              }`}
            >
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-white/70" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">{alert.headline}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{alert.body}</p>
                <p className="mt-1 text-[11px] font-medium text-slate-400">{alert.suggested_action}</p>
              </div>
              {alert.dismissible && (
                <button
                  onClick={() => dismissAlert(alert.key)}
                  className="rounded-full border border-white/15 p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label={`Dismiss alert: ${alert.headline}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </article>
          ))}
        </section>
      )}

      <Panel kicker="Verified request search" title="What do you need right now?">
        <form
          onSubmit={event => {
            event.preventDefault();
            handleResolve();
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="veg thali, study room, id card, print document…"
              className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-10 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-[#d9f65b]/60 focus:outline-none"
              aria-label="Describe what you need"
            />
          </div>
          <button
            type="submit"
            disabled={isResolving}
            className="rounded-2xl bg-[#d9f65b] px-5 py-3 text-xs font-black uppercase tracking-wider text-[#121315] transition-colors hover:bg-[#e4fa78] disabled:opacity-60"
          >
            {isResolving ? 'Checking…' : 'Find it'}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_REQUESTS.map(sample => (
            <button
              key={sample}
              onClick={() => {
                setQuery(sample);
              }}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
            >
              {sample}
            </button>
          ))}
        </div>

        {resolution && <RequestResult resolution={resolution} onPick={serviceId => setSelectedId(serviceId)} />}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel
          kicker="Live campus pulse"
          title="Everything open, worst wait first"
          action={
            isLoading ? (
              <span className="font-mono text-[10px] text-slate-500">updating…</span>
            ) : null
          }
        >
          {sortedServices.length === 0 ? (
            <EmptyNote>Live traffic data is still loading. The campus pulse appears in a moment.</EmptyNote>
          ) : (
            <ul className="space-y-2">
              {sortedServices.map(entry => (
                <li key={entry.service_id}>
                  <button
                    onClick={() => setSelectedId(entry.service_id)}
                    className={`flex w-full flex-wrap items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                      selected === entry.service_id
                        ? 'border-[#d9f65b]/50 bg-[#d9f65b]/[0.07]'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">{entry.service_name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {entry.building_name} · {entry.current_queue_length} in queue
                      </span>
                    </span>
                    {entry.predicted_peak ? (
                      <span className="font-mono text-[10px] text-slate-400">
                        peak {entry.predicted_peak.label}
                      </span>
                    ) : entry.sufficient_data ? (
                      <span className="font-mono text-[10px] text-slate-500">no peak in view</span>
                    ) : (
                      <span className="font-mono text-[10px] text-slate-600">learning…</span>
                    )}
                    <span className="w-14 text-right font-mono text-sm font-black tabular-nums text-white">
                      {entry.current_wait_mins}m
                    </span>
                    <TrafficBadge state={entry.traffic_state as never} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel
            kicker="Plan your visit"
            title={selectedTraffic?.service_name ?? 'Select a service'}
          >
            {!selectedTraffic ? (
              <EmptyNote>Pick a service on the left to see its recorded demand and quietest window.</EmptyNote>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <TrafficBadge state={selectedTraffic.traffic_state as never} />
                  <span className="font-mono text-[11px] text-slate-400">
                    {selectedTraffic.current_wait_mins} min now · {selectedTraffic.current_queue_length} waiting
                  </span>
                  {selectedTraffic.sufficient_data && (
                    <ConfidenceTag confidence={selectedTraffic.confidence} pct={selectedTraffic.confidence_pct} />
                  )}
                </div>

                {forecast ? (
                  <>
                    <DemandChart forecast={forecast} />
                    <PlanWindow
                      icon={<TrendingUp className="h-3.5 w-3.5" />}
                      label="Likely peak"
                      window={forecast.predicted_peak}
                      fallback="No peak recorded in the next two days for this service."
                      tone="peak"
                    />
                    <PlanWindow
                      icon={<Clock className="h-3.5 w-3.5" />}
                      label="Quieter window"
                      window={forecast.better_window}
                      fallback="No clearly quieter window stands out right now."
                      tone="calm"
                    />
                    {forecast.rising && (
                      <p className="flex items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                        Traffic is climbing towards the recorded peak right now.
                      </p>
                    )}
                    <p className="text-[10px] leading-relaxed text-slate-500">{forecast.disclaimer}</p>
                  </>
                ) : (
                  <EmptyNote>Loading the recorded demand timeline…</EmptyNote>
                )}

                {selectedService && (
                  <button
                    onClick={() => onSelectService(selectedService)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:border-[#d9f65b]/60 hover:text-[#d9f65b]"
                  >
                    Open full service details <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </Panel>

          <Panel kicker="Verified catalogue" title="What this service actually offers">
            {items.length === 0 ? (
              <EmptyNote>No item records have been captured for this service yet.</EmptyNote>
            ) : (
              <ul className="space-y-1.5">
                {items.map(item => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        item.available ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'
                      }`}
                      aria-hidden="true"
                    >
                      {item.available ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-white">{item.name}</span>
                      <span className="block truncate text-[10px] text-slate-500">
                        {item.available
                          ? `${item.quantity_available} ${item.unit_label} left · ${item.source_system}`
                          : item.unavailability_note ?? 'Marked unavailable by staff'}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                      {item.updated_by}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        kicker="Smart alternatives"
        title={
          selectedTraffic
            ? `Verified shorter waits near ${selectedTraffic.service_name}`
            : 'Verified shorter waits'
        }
      >
        {isLoadingAlternatives ? (
          <EmptyNote>Checking which locations are open, verified and genuinely faster…</EmptyNote>
        ) : alternatives.length === 0 ? (
          <EmptyNote>
            Nothing beats this location right now by at least {overview?.min_net_saved_mins ?? 3} minutes once
            walking time is counted. We only show an alternative when it is verified available, open, and
            actually saves you time.
          </EmptyNote>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {alternatives.map(alternative => (
              <AlternativeCard
                key={alternative.service_id}
                originServiceId={selected!}
                alternative={alternative}
                services={services}
                onOpen={serviceId => setSelectedId(serviceId)}
                onJoin={service => onJoinQueue(service)}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

const PlanWindow: React.FC<{
  icon: React.ReactNode;
  label: string;
  window: PeakWindow | null;
  fallback: string;
  tone: 'peak' | 'calm';
}> = ({ icon, label, window, fallback, tone }) => (
  <div
    className={`rounded-2xl border px-3 py-2.5 ${
      tone === 'peak' ? 'border-rose-400/25 bg-rose-500/5' : 'border-emerald-400/25 bg-emerald-500/5'
    }`}
  >
    <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
      {icon}
      {label}
    </p>
    {window ? (
      <>
        <p className="mt-1 text-sm font-bold text-white">
          {window.day_label} · {window.label}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          expect ~{window.expected_wait_min}–{window.expected_wait_max} min · about {window.expected_queue} people
        </p>
      </>
    ) : (
      <p className="mt-1 text-xs text-slate-400">{fallback}</p>
    )}
  </div>
);

const RequestResult: React.FC<{
  resolution: IntentResolution;
  onPick: (serviceId: string) => void;
}> = ({ resolution, onPick }) => {
  if (!resolution.verified) {
    return (
      <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/5 px-4 py-3">
        <p className="text-sm font-bold text-amber-200">{resolution.message}</p>
        <p className="mt-1 text-xs text-slate-400">
          We only list a place when a CampusFlow record confirms it. These are the services we can verify:
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {resolution.suggestions.map(suggestion => (
            <span
              key={suggestion}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300"
            >
              {suggestion}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        <Sparkles className="h-3 w-3" />
        {resolution.resolved_item
          ? `${resolution.resolved_item.name} · ${resolution.matches.length} verified location${
              resolution.matches.length === 1 ? '' : 's'
            }`
          : `${resolution.matches.length} matching service${resolution.matches.length === 1 ? '' : 's'}`}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {resolution.matches.map(match => (
          <li key={`${match.service_id}-${match.item?.id ?? 'service'}`}>
            <button
              onClick={() => onPick(match.service_id)}
              className="flex w-full items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-[#d9f65b]/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-white">{match.service_name}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                  <MapPin className="mr-1 inline h-3 w-3" />
                  {match.building_name} · {match.current_wait_mins} min
                </span>
              </span>
              {match.item ? (
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    match.item.available
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      : 'border-rose-400/30 bg-rose-400/10 text-rose-300'
                  }`}
                >
                  {match.item.available ? `${match.item.quantity_available} left` : 'Sold out'}
                </span>
              ) : (
                <TrafficBadge state={match.traffic_state} />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
