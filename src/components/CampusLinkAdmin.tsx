import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { currentCsrfToken } from '../lib/api.js';
import { CampusPositioner } from '../lib/campusPosition.js';
import type { CampusLink } from '../lib/campusPosition.js';

/**
 * Admin tool: confirms which real building each CampusFlow service sits in.
 *
 * Until a link exists the 3D campus shows a projected position and says so. This
 * screen is the only way to make a position "verified", which is what stops live
 * figures appearing on a building nobody has confirmed.
 *
 * Code-split, because it pulls in the campus geometry and only admins ever need it.
 */
const CampusLinkAdmin: React.FC<{
  links: CampusLink[];
  onChanged: () => void;
}> = ({ links, onChanged }) => {
  const { buildings, services } = useApp();
  const [selected, setSelected] = useState<string>('');
  const [candidates, setCandidates] = useState<
    { id: string; name: string | null; area_m2: number; centre: [number, number] }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Real footprints, largest first so the obvious candidates are at the top.
    // The admin still has to choose; nothing is matched automatically.
    setCandidates(new CampusPositioner().linkableBuildings());
    setSelected(current => current || buildings[0]?.id || '');
  }, [buildings]);

  const linkedByBuilding = useMemo(
    () => new Map(links.map(l => [l.campusflow_building_id, l])),
    [links]
  );

  const setLink = async (osmId: string | null) => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await currentCsrfToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['x-csrf-token'] = token;

      const res = await fetch(
        osmId ? '/api/campus/links' : `/api/campus/links/${selected}`,
        {
          method: osmId ? 'POST' : 'DELETE',
          headers,
          credentials: 'same-origin',
          ...(osmId
            ? { body: JSON.stringify({ campusflow_building_id: selected, osm_element_id: osmId }) }
            : {})
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body?.error ?? 'That change could not be saved.');
      } else {
        setMessage(
          osmId
            ? 'Position saved. The 3D campus now shows this service on the confirmed building.'
            : 'Link removed. The 3D campus now shows a projected position again.'
        );
        onChanged();
      }
    } catch {
      setMessage('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const building = buildings.find(b => b.id === selected);
  const serviceNames = services.filter(s => s.building_id === selected).map(s => s.name);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="font-extrabold text-slate-900">Confirm building positions (admin)</h3>
      <p className="text-sm text-slate-600 mt-1">
        The 3D campus needs to know which real building each service is in before it will
        display live figures on that structure. Until you confirm one, the service appears at a
        projected position and is labelled as unverified.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="cf-link-building"
            className="block text-sm font-semibold text-slate-800 mb-1"
          >
            CampusFlow building
          </label>
          <select
            id="cf-link-building"
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-2 min-h-[44px]"
          >
            {buildings.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}
                {linkedByBuilding.has(b.id) ? ' (verified)' : ' (projected)'}
              </option>
            ))}
          </select>
          {building && (
            <p className="text-xs text-slate-500 mt-1">
              Contains: {serviceNames.length > 0 ? serviceNames.join(', ') : 'no services'}
            </p>
          )}
          {linkedByBuilding.get(selected) && (
            <p className="text-xs text-emerald-700 mt-1 font-semibold">
              Linked to OSM {linkedByBuilding.get(selected)!.osm_element_id}, confirmed by{' '}
              {linkedByBuilding.get(selected)!.verified_by ?? 'an administrator'}.
            </p>
          )}
        </div>

        <div>
          <span className="block text-sm font-semibold text-slate-800 mb-1">
            Real buildings from OpenStreetMap
          </span>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {candidates.slice(0, 40).map(c => (
              <button
                key={c.id}
                type="button"
                disabled={busy}
                onClick={() => setLink(c.id)}
                className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="text-sm text-slate-800">{c.name ?? 'Unnamed building'}</span>
                <span className="text-xs text-slate-500">{c.area_m2.toLocaleString()} m²</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !linkedByBuilding.get(selected)}
          onClick={() => setLink(null)}
          className="rounded-lg border border-slate-300 px-3 py-2 min-h-[44px] text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          Remove confirmation
        </button>
        {message && (
          <p className="text-sm text-slate-700" role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
};

export default CampusLinkAdmin;
