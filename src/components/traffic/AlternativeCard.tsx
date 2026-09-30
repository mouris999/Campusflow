/**
 * One verified alternative.
 *
 * The card shows *why* it was picked — the same reasons the ranking engine used
 * — and lets the student accept or reject it. Both answers are recorded, so the
 * acceptance rate the admin sees comes from real decisions.
 */

import React, { useState } from 'react';
import { ArrowRight, Footprints, ThumbsDown, ThumbsUp, Users } from 'lucide-react';
import type { Service } from '../../types/index.js';
import type { SmartAlternative } from '../../types/traffic.js';
import { useTraffic } from '../../context/TrafficContext.js';
import { TrafficBadge } from './TrafficBits.js';

interface AlternativeCardProps {
  originServiceId: string;
  alternative: SmartAlternative;
  services: Service[];
  onOpen: (serviceId: string) => void;
  onJoin: (service: Service) => void;
}

export const AlternativeCard: React.FC<AlternativeCardProps> = ({
  originServiceId,
  alternative,
  services,
  onOpen,
  onJoin
}) => {
  const { trackEvent, sendFeedback } = useTraffic();
  const [answered, setAnswered] = useState<'up' | 'down' | null>(null);
  const target = services.find(s => s.id === alternative.service_id) ?? null;

  const respond = async (useful: boolean) => {
    if (answered) return;
    setAnswered(useful ? 'up' : 'down');
    await sendFeedback(originServiceId, alternative.service_id, useful);
  };

  const accept = async () => {
    await trackEvent(originServiceId, alternative.service_id, 'selected');
    if (target) onJoin(target);
  };

  return (
    <article className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/25">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-white">{alternative.service_name}</h4>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {alternative.building_name} · {alternative.floor}
          </p>
        </div>
        <TrafficBadge state={alternative.traffic_state} />
      </header>

      <div className="mt-3 flex items-end gap-2">
        <span className="text-2xl font-black tabular-nums text-[#d9f65b]">
          {alternative.current_wait_mins}m
        </span>
        <span className="mb-1 text-[11px] text-slate-400">
          wait now · saves about {alternative.time_saved_mins} min
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl bg-black/20 px-2 py-1.5">
          <dt className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">
            <Footprints className="h-3 w-3" />
            Walk
          </dt>
          <dd className="mt-0.5 font-bold text-white">
            {alternative.distance_meters}m · {alternative.walk_mins} min
          </dd>
        </div>
        <div className="rounded-xl bg-black/20 px-2 py-1.5">
          <dt className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">
            <Users className="h-3 w-3" />
            In queue
          </dt>
          <dd className="mt-0.5 font-bold text-white">{alternative.current_queue_length} people</dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        {alternative.availability.item_name ? (
          <>
            <span className="font-bold text-slate-200">{alternative.availability.item_name}</span>{' '}
            {alternative.availability.available
              ? 'confirmed in the CampusFlow catalogue.'
              : alternative.availability.note}
          </>
        ) : (
          alternative.availability.note
        )}
      </p>

      <ul className="mt-3 space-y-1">
        {alternative.reasons.map(reason => (
          <li key={reason.code} className="flex items-start gap-1.5 text-[11px] text-slate-300">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[#d9f65b]" aria-hidden="true" />
            {reason.text}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={accept}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#d9f65b] px-3 py-2 text-[11px] font-black uppercase tracking-wider text-[#121315] transition-colors hover:bg-[#e4fa78]"
        >
          Join here <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onOpen(alternative.service_id)}
          className="rounded-xl border border-white/15 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:border-white/40"
        >
          Details
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-white/8 pt-3">
        <span className="text-[10px] text-slate-500">Was this useful?</span>
        <button
          onClick={() => respond(true)}
          disabled={answered !== null}
          className={`rounded-lg border px-2 py-1 transition-colors ${
            answered === 'up'
              ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300'
              : 'border-white/10 text-slate-400 hover:text-white disabled:opacity-50'
          }`}
          aria-label="This alternative was useful"
        >
          <ThumbsUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => respond(false)}
          disabled={answered !== null}
          className={`rounded-lg border px-2 py-1 transition-colors ${
            answered === 'down'
              ? 'border-rose-400/50 bg-rose-400/15 text-rose-300'
              : 'border-white/10 text-slate-400 hover:text-white disabled:opacity-50'
          }`}
          aria-label="This alternative was not useful"
        >
          <ThumbsDown className="h-3 w-3" />
        </button>
        {answered && (
          <span className="text-[10px] text-slate-500">Thanks — recorded.</span>
        )}
      </div>
    </article>
  );
};
