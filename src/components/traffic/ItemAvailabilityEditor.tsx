/**
 * Service-item availability for counter staff.
 *
 * This is the write side of the Smart Traffic feature: when staff mark an item
 * sold out, the recommendation engine stops sending students to that counter for
 * it, because availability is only ever read from this record.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PackageCheck, PackageX, RefreshCw } from 'lucide-react';
import { useTraffic } from '../../context/TrafficContext.js';
import type { ServiceItem } from '../../types/traffic.js';
import { EmptyNote } from './TrafficBits.js';

interface ItemAvailabilityEditorProps {
  serviceId: string;
  onSaved?: () => void;
}

export const ItemAvailabilityEditor: React.FC<ItemAvailabilityEditorProps> = ({ serviceId, onSaved }) => {
  const { loadItems, setItemAvailability } = useTraffic();
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    const result = await loadItems(serviceId);
    setItems(result);
    setIsLoading(false);
  }, [loadItems, serviceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = async (item: ServiceItem) => {
    setSavingId(item.id);
    const updated = await setItemAvailability(item.id, !item.available, item.available ? 0 : Math.max(1, item.capacity));
    setItems(current => current.map(entry => (entry.id === item.id ? (updated ?? { ...entry, available: !item.available }) : entry)));
    setSavingId(null);
    onSaved?.();
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">Item availability</h4>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Students are only routed here for an item a counter has marked available.
          </p>
        </div>
        <button
          onClick={reload}
          className="rounded-lg border border-slate-300 p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          aria-label="Refresh item availability"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">Loading the catalogue…</p>
      ) : items.length === 0 ? (
        <EmptyNote light>No catalogue items are recorded for this counter yet.</EmptyNote>
      ) : (
        <ul className="space-y-1.5">
          {items.map(item => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-slate-800">{item.name}</span>
                <span className="block truncate text-[10px] text-slate-500">
                  {item.kind.replace('_', ' ')} · {item.quantity_available} {item.unit_label} · updated by{' '}
                  {item.updated_by}
                </span>
              </span>
              <button
                onClick={() => toggle(item)}
                disabled={savingId === item.id}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-60 ${
                  item.available
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                    : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                }`}
              >
                {item.available ? <PackageCheck className="h-3.5 w-3.5" /> : <PackageX className="h-3.5 w-3.5" />}
                {item.available ? 'Available' : 'Sold out'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
