import React, { useEffect, useState } from 'react';
import { Database, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../context/AppContext.js';

interface HealthInfo {
  storage: 'persistent' | 'ephemeral';
}

/**
 * Storage-mode notice.
 *
 * On a serverless deployment the campus database is held in memory, so queue,
 * seat and notification state does not survive an instance being recycled and
 * is not shared between instances. That is a real operational limitation, and
 * it must never be hidden behind an interface that looks persistent.
 */
export const StorageNotice: React.FC = () => {
  const { currentUser } = useApp();
  const [storage, setStorage] = useState<HealthInfo['storage'] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/health', { credentials: 'same-origin' });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body?.storage) setStorage(body.storage);
      } catch {
        // If health cannot be read, do not make a claim either way.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Only staff and administrators act on the data, so this is aimed at them.
  const isOperator = currentUser?.role === 'staff' || currentUser?.role === 'admin';
  if (storage !== 'ephemeral' || dismissed || !isOperator) return null;

  return (
    <div role="status" className="mx-auto max-w-7xl px-4 sm:px-6 pt-4">
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3">
        <Database className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-amber-100 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            This deployment is using temporary storage
          </p>
          <p className="text-[11px] text-amber-200/90 mt-1">
            Queue, seat and notification records are held in memory. They are not shared between server
            instances and are lost when an instance is recycled, so a ticket or seat that appears to
            vanish has not been saved anywhere. Attach a database (see README) for durable records.
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss storage notice"
          className="text-amber-300/70 hover:text-amber-100 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
