import React from 'react';
import type { Freshness } from '../lib/offline.js';

/**
 * Freshness badge: LIVE / CACHED / STALE / OFFLINE.
 *
 * The label is always spelled out, so it does not depend on colour perception
 * and is announced correctly by screen readers.
 */
export const FreshnessBadge: React.FC<{ freshness: Freshness; fetchedAt: string | null }> = ({
  freshness,
  fetchedAt
}) => {
  if (freshness === 'live') {
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300">
        LIVE
      </span>
    );
  }

  const label =
    freshness === 'offline'
      ? 'OFFLINE'
      : freshness === 'stale'
        ? `STALE ${formatTime(fetchedAt)}`.trim()
        : `CACHED ${formatTime(fetchedAt)}`.trim();

  const cls =
    freshness === 'offline'
      ? 'border-rose-500/40 text-rose-300'
      : freshness === 'stale'
        ? 'border-amber-500/40 text-amber-200'
        : 'border-sky-500/30 text-sky-300';

  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${cls}`} title="This information may be out of date">
      {label}
    </span>
  );
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `· ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
