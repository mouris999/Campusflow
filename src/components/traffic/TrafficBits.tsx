/**
 * Small shared building blocks for the Smart Traffic surfaces.
 *
 * Kept in one place so the service card, the map badge, the detail panel and
 * the admin view all render the same traffic state the same way.
 */

import React from 'react';
import type { DemandBand, PeakConfidence, TrafficState } from '../../types/traffic.js';
import { TRAFFIC_STATE_META } from '../../types/traffic.js';

export const TRAFFIC_BADGE_CLASS: Record<TrafficState | DemandBand, string> = {
  low: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  moderate: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  high: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  peak: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  closed: 'border-slate-500/30 bg-slate-500/10 text-slate-400'
};

export const TRAFFIC_BAR_CLASS: Record<DemandBand, string> = {
  low: 'bg-emerald-400/70',
  moderate: 'bg-sky-400/70',
  high: 'bg-amber-400/70',
  peak: 'bg-rose-400/80'
};

export const CONFIDENCE_CLASS: Record<PeakConfidence, string> = {
  low: 'text-slate-400',
  medium: 'text-sky-300',
  high: 'text-[#d9f65b]'
};

export const CONFIDENCE_COPY: Record<PeakConfidence, string> = {
  low: 'Low confidence — recorded demand is thin here',
  medium: 'Medium confidence — some recorded history',
  high: 'High confidence — well recorded across the last 3 weeks'
};

interface TrafficBadgeProps {
  state: TrafficState | DemandBand;
  label?: string;
  className?: string;
  light?: boolean;
}

export const TrafficBadge: React.FC<TrafficBadgeProps> = ({ state, label, className = '', light = false }) => {
  const meta = TRAFFIC_STATE_META[state as TrafficState];
  const tone = light
    ? {
        low: 'border-emerald-500/30 bg-emerald-50 text-emerald-700',
        moderate: 'border-sky-500/30 bg-sky-50 text-sky-700',
        high: 'border-amber-500/30 bg-amber-50 text-amber-700',
        peak: 'border-rose-500/30 bg-rose-50 text-rose-700',
        closed: 'border-slate-400/30 bg-slate-100 text-slate-600'
      }[state]
    : TRAFFIC_BADGE_CLASS[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${tone} ${className}`}
    >
      <span aria-hidden="true">{meta?.glyph ?? '●'}</span>
      {label ?? meta?.short ?? state}
    </span>
  );
};

interface ConfidenceTagProps {
  confidence: PeakConfidence;
  pct: number;
  light?: boolean;
}

export const ConfidenceTag: React.FC<ConfidenceTagProps> = ({ confidence, pct, light = false }) => {
  const tone = light
    ? { low: 'text-slate-500', medium: 'text-sky-700', high: 'text-emerald-700' }[confidence]
    : CONFIDENCE_CLASS[confidence];
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider ${tone}`}
      title={CONFIDENCE_COPY[confidence]}
    >
      {confidence} · {pct}%
    </span>
  );
};

interface PanelProps {
  title?: string;
  kicker?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({ title, kicker, action, children, className = '' }) => (
  <section className={`rounded-3xl border border-white/10 bg-[#16171b] p-5 sm:p-6 ${className}`}>
    {(title || action) && (
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          {kicker && (
            <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              {kicker}
            </p>
          )}
          {title && <h3 className="text-base font-extrabold tracking-tight text-white">{title}</h3>}
        </div>
        {action}
      </header>
    )}
    {children}
  </section>
);

export const EmptyNote: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => (
  <p
    className={`rounded-2xl border border-dashed px-4 py-3 text-xs leading-relaxed ${
      light
        ? 'border-slate-300 bg-slate-50 text-slate-500'
        : 'border-white/15 bg-white/[0.02] text-slate-400'
    }`}
  >
    {children}
  </p>
);
