/**
 * Smart Traffic block inside the service detail modal.
 *
 * The modal already has a light surface, so this section is styled to sit
 * inside it rather than to match the dark campus view. It answers the three
 * questions a student has at the counter: is it busy, when should I come, and
 * is there a verified alternative right now.
 */

import React, { useEffect, useState } from 'react';
import { Check, TrendingUp, X } from 'lucide-react';
import type { Service } from '../../types/index.js';
import type { ServiceItem, SmartAlternative } from '../../types/traffic.js';
import { useApp } from '../../context/AppContext.js';
import { useTraffic } from '../../context/TrafficContext.js';
import { DemandChart } from './DemandChart.js';
import { EmptyNote, TrafficBadge } from './TrafficBits.js';

interface ServiceTrafficPanelProps {
  service: Service;
  onSwitchService: (serviceId: string) => void;
  onJoinQueue: (service: Service) => void;
}

export const ServiceTrafficPanel: React.FC<ServiceTrafficPanelProps> = ({
  service,
  onSwitchService,
  onJoinQueue
}) => {
  const { services } = useApp();
  const { trafficByService, loadForecast, loadItems, loadAlternatives, forecasts, trackEvent } = useTraffic();
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [alternatives, setAlternatives] = useState<SmartAlternative[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const traffic = trafficByService[service.id];
  const forecast = forecasts[service.id];

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    loadForecast(service.id);
    loadItems(service.id).then(result => {
      if (!cancelled) setItems(result);
    });
    loadAlternatives(service.id).then(result => {
      if (cancelled) return;
      setAlternatives(result?.recommended ?? []);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [service.id, loadForecast, loadItems, loadAlternatives]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-900">
          <TrendingUp className="h-4 w-4 text-indigo-600" />
          Smart traffic prediction
        </h4>
        {traffic && <TrafficBadge light state={traffic.traffic_state as never} />}
      </div>

      {traffic && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Wait now" value={`${traffic.current_wait_mins} min`} />
          <Stat
            label="Likely peak"
            value={traffic.predicted_peak ? traffic.predicted_peak.label : 'Not predicted'}
          />
          <Stat
            label="Quieter window"
            value={traffic.better_window ? traffic.better_window.label : 'None clear'}
          />
          <Stat
            label="Confidence"
            value={
              traffic.sufficient_data
                ? `${traffic.confidence} · ${traffic.confidence_pct}%`
                : 'Learning'
            }
          />
        </div>
      )}

      {forecast ? <DemandChart light forecast={forecast} /> : <EmptyNote light>Loading the recorded demand timeline…</EmptyNote>}

      {traffic && !traffic.sufficient_data && (
        <EmptyNote light>
          {traffic.insufficient_reason ??
            'We have not recorded enough days of arrivals and waits at this service to predict a peak yet.'}
        </EmptyNote>
      )}

      {/* Verified catalogue */}
      {items.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-900">Verified availability</p>
          <ul className="mt-2 space-y-1">
            {items.map(item => (
              <li key={item.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full px-1 ${
                    item.available ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }`}
                  aria-hidden="true"
                >
                  {item.available ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </span>
                <span className="font-semibold text-slate-800">{item.name}</span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {item.available
                    ? `${item.quantity_available} ${item.unit_label} left`
                    : item.unavailability_note ?? 'Unavailable right now'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Verified alternatives */}
      {isLoading ? (
        <EmptyNote light>Checking nearby locations for a verified, genuinely faster option…</EmptyNote>
      ) : alternatives.length === 0 ? (
        <EmptyNote light>
          No other campus location is verified as faster here by a meaningful amount once walking time is counted.
        </EmptyNote>
      ) : (
        <div className="space-y-2">
          {alternatives.map(alternative => {
            const target = services.find(s => s.id === alternative.service_id) ?? null;
            return (
              <div
                key={alternative.service_id}
                className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900">{alternative.service_name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {alternative.distance_meters}m away · {alternative.walk_mins} min walk ·{' '}
                      {alternative.current_wait_mins} min wait
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    saves ~{alternative.time_saved_mins} min
                  </span>
                </div>

                <ul className="mt-2 space-y-0.5">
                  {alternative.reasons.map(reason => (
                    <li key={reason.code} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" aria-hidden="true" />
                      {reason.text}
                    </li>
                  ))}
                </ul>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      if (!target) return;
                      await trackEvent(service.id, alternative.service_id, 'selected');
                      onSwitchService(alternative.service_id);
                      onJoinQueue(target);
                    }}
                    disabled={!target}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Join this one
                  </button>
                  <button
                    onClick={() => onSwitchService(alternative.service_id)}
                    className="rounded-lg border border-indigo-200 px-3 py-1.5 text-[11px] font-bold text-indigo-700 transition-colors hover:border-indigo-400"
                  >
                    View details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {forecast && <p className="text-[10px] leading-relaxed text-slate-400">{forecast.disclaimer}</p>}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
    <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
    <p className="mt-0.5 text-xs font-bold text-slate-900">{value}</p>
  </div>
);
