import React, { useState } from 'react';
import { Ticket, Armchair, Clock3 } from 'lucide-react';
import type { ServiceCategory } from '../types/index.js';
import { useApp } from '../context/AppContext.js';
import { useOfflineResource } from '../lib/api.js';
import { enqueuePendingAction, usePendingActions } from '../lib/pendingActions.js';
import { useOfflineStatus } from '../lib/offline.js';
import { TrafficTimeline, BestTimeCard } from './TrafficPeakPanel.js';
import { VirtualTokenCard } from './VirtualTokenCard.js';
import { SeatMap } from './SeatMap.js';
import { OfflineGuard } from './OfflineBanner.js';

interface Props {
  serviceId: string;
  serviceName: string;
  category: ServiceCategory;
  hasSeating: boolean;
}

type Tab = 'token' | 'seating' | 'timeline';

/**
 * Combines the queue token, library seating and the historical timeline for
 * one service, so a student can see "how busy now", "when it is quieter" and
 * "what can I hold" in one place.
 */
export const ServiceIntelligenceExtras: React.FC<Props> = ({ serviceId, serviceName, category, hasSeating }) => {
  const { myQueues, joinQueue } = useApp();
  const offline = useOfflineStatus();
  const pending = usePendingActions();

  const holdsToken = myQueues.some(
    e => e.service_id === serviceId && ['waiting', 'called', 'in_service'].includes(e.status)
  );

  const [tab, setTab] = useState<Tab>(hasSeating ? 'seating' : 'token');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const { data: forecastData } = useOfflineResource<{ forecast: any }>(
    `/api/intelligence/services/${serviceId}/peak`
  );
  const forecast = forecastData?.forecast;

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    ...(holdsToken ? [{ id: 'token' as Tab, label: 'My token', icon: <Ticket className="w-3.5 h-3.5" /> }] : []),
    ...(hasSeating ? [{ id: 'seating' as Tab, label: 'Find a seat', icon: <Armchair className="w-3.5 h-3.5" /> }] : []),
    { id: 'timeline', label: 'Traffic today', icon: <Clock3 className="w-3.5 h-3.5" /> }
  ];

  // If the student holds no token and there is no seating, show the timeline.
  const effectiveTab: Tab = !tabs.some(t => t.id === tab) ? tabs[tabs.length - 1].id : tab;

  const handleJoin = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      const result = await joinQueue(serviceId, 'remote');
      if (result.success) {
        setTab('token');
      } else {
        setJoinError(result.error ?? 'Could not join the queue.');
      }
    } catch {
      setJoinError('No connection. The queue was not joined.');
    } finally {
      setJoining(false);
    }
  };

  /** Queues the join request explicitly, without claiming it succeeded. */
  const queueOfflineJoin = () => {
    enqueuePendingAction({
      kind: 'join_queue',
      label: `Join virtual queue at ${serviceName}`,
      endpoint: '/api/queue/join',
      method: 'POST',
      body: { service_id: serviceId, check_in_type: 'remote' },
      idempotency_key: `join-${serviceId}`
    });
    setJoinError('Your request is queued but NOT confirmed. It will be sent when you are back online.');
  };

  const pendingJoin = pending.some(a => a.kind === 'join_queue' && a.body.service_id === serviceId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Service information">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={effectiveTab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
              effectiveTab === t.id
                ? 'bg-[#121315] text-[#d9f65b] border-[#d9f65b]'
                : 'border-slate-200 text-slate-600 hover:border-slate-400'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {effectiveTab === 'token' && <VirtualTokenCard serviceId={serviceId} />}

      {effectiveTab === 'seating' && hasSeating && <SeatMap serviceId={serviceId} serviceName={serviceName} />}

      {effectiveTab === 'timeline' && (
        <div className="space-y-3">
          {forecast ? <TrafficTimeline forecast={forecast} /> : <TrafficTimeline forecast={{} as any} loading />}
          {forecast && <BestTimeCard forecast={forecast} />}
        </div>
      )}

      {/* A student without a token gets a real way to get one. */}
      {!holdsToken && effectiveTab !== 'seating' && (
        <div className="rounded-2xl border border-slate-200 p-4">
          {offline ? (
            <OfflineGuard action="Joining the virtual queue" onRetry={queueOfflineJoin} />
          ) : (
            <>
              <p className="text-sm font-bold text-slate-900">Join without waiting in line</p>
              <p className="text-xs text-slate-600 mt-1">
                Take a virtual token and leave. You will be notified as your turn approaches.
              </p>
              <button
                onClick={handleJoin}
                disabled={joining}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#121315] text-white text-sm font-black hover:bg-black disabled:opacity-60 transition"
              >
                {joining ? 'Joining…' : 'Join virtual queue'}
              </button>
              {joinError && (
                <p role="alert" className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                  {joinError}
                </p>
              )}
              {pendingJoin && (
                <p className="mt-2 text-xs text-amber-700 flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-amber-200 font-mono text-[10px]">PENDING</span>
                  Waiting for a connection to confirm.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
