import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Map as MapIcon, Box, Loader2 } from 'lucide-react';
import { currentCsrfToken } from '../lib/api.js';
import { useApp } from '../context/AppContext.js';
import type { Service } from '../types/index.js';
import type { CampusLink } from '../lib/campusPosition.js';

/**
 * Everything that touches campus geometry is code-split.
 *
 * The geometry file is ~98 kB of real survey data and three.js is larger still.
 * Neither belongs in the main bundle: a student who never opens the campus view
 * should not pay for either. The loading state is explicit, so the wait is
 * explained rather than showing an empty frame.
 */
const Campus3D = lazy(() => import('./Campus3D.js').then(m => ({ default: m.Campus3D })));
const CampusLinkAdmin = lazy(() => import('./CampusLinkAdmin.js'));
const CampusMap = lazy(() => import('./CampusMap.js').then(m => ({ default: m.CampusMap })));

interface CampusViewProps {
  onSelectService: (service: Service) => void;
  onJoinQueue: (service: Service) => void;
}

/**
 * The campus view.
 *
 * Hosts the existing 2D schematic map unchanged, and adds the real 3D campus
 * beside it. The 2D map is not replaced: it is the faster way to read the
 * product's own layout, and the 3D view is the real-world view. Both carry the
 * same live data, and the 3D view has a full text equivalent, so switching is a
 * choice rather than a requirement.
 */
export const CampusView: React.FC<CampusViewProps> = ({ onSelectService, onJoinQueue }) => {
  const { currentUser } = useApp();
  const [mode, setMode] = useState<'2d' | '3d'>('3d');
  const [links, setLinks] = useState<CampusLink[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'admin';

  const loadLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/campus/links', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.links)) setLinks(data.links);
    } catch {
      // The 3D campus still works with no links: it falls back to the schematic
      // layout and says so, which is better than failing the whole view.
      setLinksError('Campus link status unavailable. The 3D campus is showing projected positions.');
    }
  }, []);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Campus</h2>
          <p className="text-sm text-slate-600">
            Real campus geometry from OpenStreetMap, with live CampusFlow data on top.
          </p>
        </div>

        <div
          className="inline-flex rounded-xl border border-slate-200 bg-white p-1"
          role="tablist"
          aria-label="Campus view"
        >
          {([
            { id: '3d', label: '3D campus', icon: <Box className="w-4 h-4" aria-hidden="true" /> },
            { id: '2d', label: 'Service map', icon: <MapIcon className="w-4 h-4" aria-hidden="true" /> }
          ] as const).map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              onClick={() => setMode(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 min-h-[44px] text-sm font-semibold transition ${
                mode === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {mode === '3d' ? (
        <>
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" aria-hidden="true" />
                <p className="font-semibold">Loading the 3D campus…</p>
                <p className="text-sm mt-1">
                  The 3D engine is downloaded on demand so it never slows the rest of the app.
                </p>
              </div>
            }
          >
            <Campus3D links={links} onSelectService={onSelectService} onJoinQueue={onJoinQueue} />
          </Suspense>

          {linksError && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {linksError}
            </p>
          )}

          {isAdmin && (
            <Suspense fallback={null}>
              <CampusLinkAdmin
                links={links}
                onChanged={() => {
                  void loadLinks();
                }}
              />
            </Suspense>
          )}
        </>
      ) : (
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" aria-hidden="true" />
              <p className="font-semibold">Loading the service map…</p>
            </div>
          }
        >
          <CampusMap onSelectService={onSelectService} onJoinQueue={onJoinQueue} />
        </Suspense>
      )}
    </div>
  );
};
