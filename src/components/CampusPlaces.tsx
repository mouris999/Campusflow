import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  ExternalLink,
  GraduationCap,
  MapPin,
  UtensilsCrossed,
  Dumbbell,
  Bus,
  HeartPulse,
  Landmark,
  Microscope,
  Home,
  ShoppingBasket,
  Users,
  Sparkles
} from 'lucide-react';

import {
  CAMPUS_IDENTITY,
  groupedPlaces,
  isPlaceAnchored,
  placesProvenance,
  type CampusPlace,
  type CampusPlaceCategory
} from '../lib/campusPlaces.js';
import { CAMPUS_GEOMETRY } from '../lib/campusGeo.js';
import type { Building } from '../types/index.js';

/**
 * The real Galgotias University directory, on the service map.
 *
 * Everything listed here is a place the university publishes under its own name,
 * or a feature the OpenStreetMap survey names. Nothing here is a CampusFlow
 * concept and nothing here is invented.
 *
 * The one thing this component will not do is put a pin on an unverified place.
 * OpenStreetMap names five features on this campus out of 336 footprints, so
 * those five get a pin and a "PINNED" badge; the rest are listed with a link to
 * the page they came from and an explicit "position not confirmed" note. Showing
 * a confident pin on the School of Law, when no survey and no university page
 * says where the School of Law is, would be the same fabrication the map was
 * rebuilt to remove.
 */

const CATEGORY_ICON: Record<CampusPlaceCategory, React.ComponentType<{ className?: string }>> = {
  academic_block: Building2,
  school: GraduationCap,
  industry_centre: Sparkles,
  research: Microscope,
  academic_office: Landmark,
  student_affairs: Users,
  library: BookOpen,
  dining: UtensilsCrossed,
  health: HeartPulse,
  sports: Dumbbell,
  residential: Home,
  retail: ShoppingBasket,
  transport: Bus
};

interface CampusPlacesProps {
  /** The live CampusFlow buildings, used to focus the plan on an anchored place. */
  buildings: Building[];
  /** Selects a building, which highlights its pin on the plan above. */
  onSelectBuilding: (buildingId: string) => void;
}

export const CampusPlaces: React.FC<CampusPlacesProps> = ({ buildings, onSelectBuilding }) => {
  const [openCategory, setOpenCategory] = useState<CampusPlaceCategory | 'all'>('all');
  const provenance = useMemo(() => placesProvenance(), []);
  const groups = useMemo(() => groupedPlaces(), []);

  /**
   * A place can be highlighted on the plan only when the survey names it AND the
   * live building list carries the matching element. Anything else has nothing to
   * focus, and pretending otherwise would just move the highlight nowhere.
   */
  const buildingForPlace = (place: CampusPlace): Building | null => {
    if (!isPlaceAnchored(place)) return null;
    return buildings.find(b => b.osm_element_id === place.osm_element_id) ?? null;
  };

  const visible = openCategory === 'all' ? groups : groups.filter(g => g.id === openCategory);

  return (
    <section
      aria-labelledby="campus-places-heading"
      data-testid="campus-places"
      className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
    >
      {/* Real campus identity, quoted from the university's own site. */}
      <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-950 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white/10 text-slate-300 border border-white/15">
                REAL CAMPUS DIRECTORY
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                SOURCED, NOT PROJECTED
              </span>
            </div>
            <h3
              id="campus-places-heading"
              className="text-xl font-display font-black mt-1.5 flex items-center gap-2"
            >
              <MapPin className="w-5 h-5 text-emerald-400 shrink-0" />
              {CAMPUS_IDENTITY.name}
            </h3>
            <p className="text-xs text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
              {CAMPUS_IDENTITY.address}
            </p>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs shrink-0">
            <div>
              <dt className="font-mono text-[10px] text-slate-500 uppercase">Established</dt>
              <dd className="font-bold text-white">{CAMPUS_IDENTITY.established}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] text-slate-500 uppercase">Founder</dt>
              <dd className="font-bold text-white">{CAMPUS_IDENTITY.founder}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] text-slate-500 uppercase">Accreditation</dt>
              <dd className="font-bold text-white">{CAMPUS_IDENTITY.accreditation}</dd>
            </div>
          </dl>
        </div>

        {/* The gap is stated, not hidden. */}
        <p className="mt-4 text-[11px] font-mono text-slate-400 leading-relaxed">
          <span className="text-emerald-400 font-bold">{provenance.total}</span> places named by the
          university ·{' '}
          <span className="text-emerald-400 font-bold">{provenance.anchored}</span> carry a surveyed
          position and a pin on the plan above ·{' '}
          <span className="text-amber-400 font-bold">{provenance.unanchored}</span> are named but
          not positioned, so they are listed without a pin
        </p>
      </div>

      {/* Category filter. */}
      <div className="px-5 sm:px-6 py-3 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
        <span className="font-mono font-bold text-[10px] text-slate-400 uppercase mr-1 shrink-0">
          Show
        </span>
        <button
          type="button"
          onClick={() => setOpenCategory('all')}
          className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold whitespace-nowrap transition-colors ${
            openCategory === 'all'
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          ALL {provenance.total}
        </button>
        {groups.map(group => {
          const Icon = CATEGORY_ICON[group.id];
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setOpenCategory(group.id)}
              className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold whitespace-nowrap transition-colors inline-flex items-center gap-1 ${
                openCategory === group.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3 h-3" />
              {group.label} {group.places.length}
            </button>
          );
        })}
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        {visible.map(group => {
          const Icon = CATEGORY_ICON[group.id];
          return (
            <div key={group.id}>
              <div className="flex items-baseline gap-2 mb-3">
                <Icon className="w-4 h-4 text-indigo-600 shrink-0" />
                <h4 className="font-display font-bold text-sm text-slate-900">{group.label}</h4>
                <span className="text-[11px] text-slate-500">{group.blurb}</span>
              </div>

              <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {group.places.map(place => {
                  const anchored = isPlaceAnchored(place);
                  const building = buildingForPlace(place);

                  return (
                    <li
                      key={place.id}
                      className={`rounded-2xl border p-3 flex flex-col gap-1.5 ${
                        anchored
                          ? 'border-emerald-200 bg-emerald-50/40'
                          : 'border-slate-200 bg-slate-50/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-display font-bold text-xs text-slate-900 leading-snug">
                          {place.name}
                        </span>
                        <span
                          title={
                            anchored
                              ? 'OpenStreetMap names this feature, so its position is surveyed and it is pinned on the plan'
                              : 'The university names this place but publishes no position for it, so it is listed without a pin'
                          }
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-black ${
                            anchored
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {anchored ? 'PINNED' : 'NO PIN'}
                        </span>
                      </div>

                      {place.note && (
                        <p className="text-[11px] text-slate-600 leading-snug">{place.note}</p>
                      )}

                      <div className="mt-auto pt-1 flex items-center justify-between gap-2">
                        <a
                          href={place.source_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[10px] font-mono text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 truncate"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {place.osm_element_id ? 'OpenStreetMap' : 'University source'}
                          </span>
                        </a>

                        {building && (
                          <button
                            type="button"
                            onClick={() => onSelectBuilding(building.id)}
                            className="text-[10px] font-mono font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 shrink-0"
                          >
                            <MapPin className="w-3 h-3" />
                            Show on plan
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="px-5 sm:px-6 py-4 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600 space-y-1">
        <p>
          <strong className="text-slate-800">Why so few pins?</strong> OpenStreetMap names five
          features on this campus out of {CAMPUS_GEOMETRY.buildings.length} real footprints and
          publishes no position for the university&apos;s schools and facilities. Pinning those
          without a surveyed coordinate would mean inventing one, so they are listed instead. An
          administrator can attach a real footprint to any of them from the Campus view, which turns
          a listing into a pin.
        </p>
        <p className="font-mono text-slate-500">
          Places &copy; Galgotias University · anchored geometry &copy; OpenStreetMap contributors
          (ODbL 1.0)
        </p>
      </div>
    </section>
  );
};
