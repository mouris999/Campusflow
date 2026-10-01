import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext.js';
import { Building, Service, ServiceCategory } from '../types/index.js';
import {
  MapPin,
  Clock,
  Users,
  Building2,
  ChevronRight,
  Filter,
  Layers,
  ArrowRight,
  Info,
  Compass,
  Footprints,
  Navigation,
  Shuffle
} from 'lucide-react';
import { useTraffic } from '../context/TrafficContext.js';
import { effectiveTrafficState } from '../lib/trafficState.js';
import { TrafficBadge } from './traffic/TrafficBits.js';
import { campusRouteGraph, ROUTE_SPEED_IS_ASSUMED } from '../lib/campusRoute.js';
import { projectLayout } from '../lib/campusLayout.js';
import { RealCampusPlan } from './RealCampusPlan.js';

interface CampusMapProps {
  onSelectService: (service: Service) => void;
  onJoinQueue: (service: Service) => void;
}

export const CampusMap: React.FC<CampusMapProps> = ({
  onSelectService,
  onJoinQueue
}) => {
  const { buildings, services } = useApp();
  const { trafficByService } = useTraffic();
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('bld-adm');
  const [filterCategory, setFilterCategory] = useState<ServiceCategory | 'all'>('all');
  const [selectedFloor, setSelectedFloor] = useState<string>('all');

  // Wayfinding Route Origin & Destination State
  const [routeOriginId, setRouteOriginId] = useState<string>('bld-lib');

  const selectedBuilding = buildings.find(b => b.id === selectedBuildingId) || buildings[0];
  const routeOriginBuilding = buildings.find(b => b.id === routeOriginId) || buildings[1];

  // Calculate live stats for each building
  const buildingStats = useMemo(() => {
    const stats: Record<string, { totalQueue: number; maxWait: number; serviceCount: number; isCongested: boolean }> = {};
    buildings.forEach(b => {
      const bServices = services.filter(s => s.building_id === b.id);
      const totalQ = bServices.reduce((sum, s) => sum + s.current_queue_length, 0);
      const maxW = bServices.length ? Math.max(...bServices.map(s => s.estimated_wait_mins)) : 0;
      const isCong = bServices.some(s => s.status === 'congested');
      stats[b.id] = {
        totalQueue: totalQ,
        maxWait: maxW,
        serviceCount: bServices.length,
        isCongested: isCong
      };
    });
    return stats;
  }, [buildings, services]);

  const buildingServices = services.filter(s => {
    if (s.building_id !== selectedBuildingId) return false;
    if (filterCategory !== 'all' && s.category !== filterCategory) return false;
    if (selectedFloor !== 'all' && !s.floor.toLowerCase().includes(selectedFloor.toLowerCase())) return false;
    return true;
  });

  /**
   * Walking distance between the route origin and the selected building.
   *
   * Measured along the real OpenStreetMap path network via the route graph, not
   * estimated from map percentages. A previous version multiplied the schematic
   * x/y difference by a made-up scale factor of 9.5 and labelled the result
   * "distanceMeters" - that produced a plausible but invented number, which the
   * no-invented-data rule forbids.
   *
   * When the real network has no connection between the two points, this returns
   * null and the UI says so rather than drawing a straight line.
   */
  const walkingRouteData = useMemo(() => {
    if (!routeOriginBuilding || !selectedBuilding || routeOriginBuilding.id === selectedBuilding.id) {
      return { distanceMeters: 0, walkMins: 0, isSame: true, real: true, reason: null as string | null };
    }

    const from = projectLayout(routeOriginBuilding);
    const to = projectLayout(selectedBuilding);
    const result = campusRouteGraph().route(from, to);

    if (!result.ok) {
      return { distanceMeters: 0, walkMins: 0, isSame: false, real: false, reason: result.reason };
    }

    return {
      distanceMeters: result.distance_m,
      walkMins: Math.max(1, Math.round(result.duration_s / 60)),
      isSame: false,
      real: true,
      reason: null as string | null
    };
  }, [routeOriginBuilding, selectedBuilding]);

  if (!selectedBuilding || buildings.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-500">
        <Building2 className="w-8 h-8 text-indigo-600 animate-pulse mx-auto mb-2" />
        <p className="font-bold text-sm">Loading Campus Spatial Blueprint...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              BLUEPRINT // GEODATA
            </span>
            <span className="text-xs font-mono text-slate-400">1:1000 SCALE CONCOURSE MAP</span>
          </div>
          <h2 className="text-xl font-display font-black text-slate-900 mt-1 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-indigo-600" />
            Interactive Campus Concourse &amp; Node Map
          </h2>
        </div>

        {/* Category filter pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          <span className="text-slate-400 font-mono font-bold">LAYER:</span>
          {(['all', 'admin_office', 'canteen', 'laboratory', 'library', 'helpdesk'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-lg font-mono font-bold whitespace-nowrap transition-colors ${
                filterCategory === cat
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat === 'all' ? 'ALL' : cat.replace('_', ' ').toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Wayfinding Routing Strip */}
      <div className="bg-indigo-950 text-white p-4 rounded-2xl border border-indigo-900 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs">
        <div className="flex items-center gap-3">
          <Navigation className="w-5 h-5 text-indigo-400 shrink-0" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">ROUTE FROM:</span>
            <select
              value={routeOriginId}
              onChange={e => setRouteOriginId(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-indigo-200 rounded-lg px-2.5 py-1 text-xs font-bold focus:ring-1 focus:ring-indigo-400"
            >
              {buildings.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>

            <span className="text-slate-400">TO:</span>
            <span className="font-bold text-white bg-indigo-900/60 px-2 py-1 rounded border border-indigo-700">
              {selectedBuilding.name} ({selectedBuilding.code})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-bold">
          {walkingRouteData.isSame ? (
            <span className="text-emerald-400">You are already at this building</span>
          ) : walkingRouteData.real ? (
            <div className="flex items-center gap-3 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-slate-400">WALK:</span>
              <span className="text-amber-400 font-black text-sm">~{walkingRouteData.walkMins} MINS</span>
              <span className="text-slate-500">({walkingRouteData.distanceMeters} m along the mapped path)</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-slate-400">
                No mapped walking route between these buildings.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Spatial SVG Map Visualizer (8 cols) */}
        <div className="lg:col-span-8 bg-slate-950 rounded-3xl border border-slate-800 p-5 shadow-xl relative overflow-hidden min-h-[500px] flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono z-10 pb-2 border-b border-slate-800">
            <span className="font-bold flex items-center gap-2 text-white">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              CAMPUS SENSOR MESH ACTIVE
            </span>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1 text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-400" /> &lt;10m</span>
              <span className="flex items-center gap-1 text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-400" /> 10-25m</span>
              <span className="flex items-center gap-1 text-rose-400"><span className="w-2 h-2 rounded-full bg-rose-400" /> &gt;25m</span>
            </div>
          </div>

          {/* Real campus plan, drawn from OpenStreetMap geometry.
              This replaces a decorative SVG that was not a map of anything:
              a fabricated "Central Quad" circle, three invented walkway curves,
              and a caption reading "UNIVERSITY CENTRAL QUAD - 1892" for a
              university that does not exist. The plan renders into the same
              0..100 space, so the service pins and route line are unchanged. */}
          <div className="relative w-full h-[420px] my-auto">
            <RealCampusPlan>
              {/* Wayfinding route, drawn on the real plan */}
              {!walkingRouteData.isSame && walkingRouteData.real && routeOriginBuilding && selectedBuilding && (
                <line
                  x1={routeOriginBuilding.map_coords.x}
                  y1={routeOriginBuilding.map_coords.y}
                  x2={selectedBuilding.map_coords.x}
                  y2={selectedBuilding.map_coords.y}
                  stroke="#818cf8"
                  strokeWidth="1.8"
                  strokeDasharray="2,2"
                  className="animate-pulse"
                />
              )}
            </RealCampusPlan>

            {/* Buildings as interactive architectural pins.
                A real surveyed structure gets a solid marker and no wait badge,
                because no CampusFlow service is attached to it yet - showing
                "~0m" there would be an invented figure. CampusFlow service
                locations show their live wait, and are marked as projected
                until an administrator confirms a real building. */}
            {buildings.map(building => {
              const stats = buildingStats[building.id] || { totalQueue: 0, maxWait: 0, serviceCount: 0, isCongested: false };
              const isSelected = selectedBuildingId === building.id;
              const isRouteOrigin = routeOriginId === building.id;
              const isReal = Boolean(building.is_real_survey);
              const hasServices = stats.serviceCount > 0;

              const badgeColor =
                stats.maxWait >= 25 ? 'bg-rose-500 text-white font-mono' :
                stats.maxWait >= 12 ? 'bg-amber-400 text-slate-950 font-mono font-bold' :
                'bg-emerald-500 text-white font-mono';

              return (
                <div
                  key={building.id}
                  style={{
                    left: `${building.map_coords.x}%`,
                    top: `${building.map_coords.y}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                  onClick={() => setSelectedBuildingId(building.id)}
                  title={isReal
                    ? `${building.name} - real structure from OpenStreetMap${building.osm_element_id ? ` (${building.osm_element_id})` : ''}`
                    : `${building.name} - CampusFlow service location`}
                  className={`absolute cursor-pointer transition-all z-20 group ${
                    isSelected ? 'scale-110 z-30' : 'hover:scale-105'
                  }`}
                >
                  <div className={`p-2.5 rounded-2xl border flex flex-col items-center shadow-2xl transition-all ${
                    isSelected
                      ? 'bg-indigo-950 border-indigo-400 ring-4 ring-indigo-500/30'
                      : isRouteOrigin
                      ? 'bg-purple-950/90 border-purple-400 ring-2 ring-purple-500/30'
                      : isReal
                      ? 'bg-slate-800/95 border-emerald-600/60'
                      : 'bg-slate-900/95 border-slate-700 border-dashed hover:border-slate-500'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <Building2 className={`w-3.5 h-3.5 ${isSelected ? 'text-indigo-300' : isReal ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <span className="text-xs font-mono font-black text-white">
                        {building.code}
                      </span>
                      {hasServices ? (
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-black shadow-sm ${badgeColor}`}>
                          ~{stats.maxWait}m
                        </span>
                      ) : (
                        <span
                          className="px-1.5 py-0.2 rounded text-[9px] font-black bg-emerald-600/25 text-emerald-300 border border-emerald-500/40"
                          title="Real surveyed structure with no CampusFlow service attached"
                        >
                          REAL
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] font-sans font-bold text-slate-300 truncate max-w-[120px] mt-0.5">
                      {building.name}
                    </div>

                    <div className="text-[9px] font-mono text-slate-400 mt-0.5 flex items-center gap-1">
                      {hasServices ? (
                        <>
                          <span>{stats.totalQueue} waiting</span>
                          <span>•</span>
                          <span>{stats.serviceCount} counters</span>
                        </>
                      ) : (
                        <span className="text-emerald-400/80">no service linked</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-[11px] font-mono text-slate-500 text-center z-10 pt-2 border-t border-slate-800">
            REAL BUILDINGS FROM OPENSTREETMAP · DASHED PINS ARE CAMPUSFLOW SERVICE LOCATIONS
          </div>
        </div>

        {/* Selected Building Service Drawer (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            {/* Building Info Header */}
            <div className="pb-3 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                  {selectedBuilding?.code || ''} • {selectedBuilding?.floor_count || 1} FLOORS
                </span>
                <span className="text-xs font-mono text-slate-500">
                  {buildingStats[selectedBuilding?.id || '']?.serviceCount || 0} Facilities
                </span>
              </div>
              <h3 className="text-xl font-display font-black text-slate-900 mt-2">
                {selectedBuilding?.name || ''}
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {selectedBuilding?.description || ''}
              </p>
            </div>

            {/* Floor Filter Buttons */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                Select Floor Elevation:
              </span>
              <div className="flex items-center gap-1.5">
                {['all', 'Floor 1', 'Floor 2', 'Floor 3'].map(floor => (
                  <button
                    key={floor}
                    onClick={() => setSelectedFloor(floor)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-colors ${
                      selectedFloor === floor
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {floor === 'all' ? 'All Floors' : floor}
                  </button>
                ))}
              </div>
            </div>

            {/* List of Services in this Building */}
            <div className="space-y-3">
              <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                Services at This Node
              </h4>

              {buildingServices.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200 font-mono">
                  NO SERVICES MATCH FILTER ON THIS FLOOR
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                  {buildingServices.map(service => (
                    <div
                      key={service.id}
                      className="p-3.5 rounded-2xl border border-slate-200 hover:border-indigo-300 transition-colors bg-slate-50/50 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h5
                            onClick={() => onSelectService(service)}
                            className="font-display font-bold text-xs text-slate-900 hover:text-indigo-600 cursor-pointer"
                          >
                            {service.name}
                          </h5>
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                            {service.floor} • {service.room_counter}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className={`inline-block px-2 py-0.5 rounded font-mono font-black text-[10px] ${
                            effectiveTrafficState(service) === 'peak' || effectiveTrafficState(service) === 'closed'
                              ? 'bg-rose-100 text-rose-800'
                              : effectiveTrafficState(service) === 'high'
                              ? 'bg-amber-100 text-amber-800'
                              : effectiveTrafficState(service) === 'moderate'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            ~{service.estimated_wait_mins}m wait
                          </span>
                          <div className="mt-1 flex justify-end">
                            <TrafficBadge light state={effectiveTrafficState(service)} />
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {service.current_queue_length} queued
                          </div>
                          {trafficByService[service.id]?.predicted_peak && (
                            <div className="mt-0.5 text-[10px] font-mono text-slate-500">
                              peak {trafficByService[service.id].predicted_peak?.label}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                        <button
                          onClick={() => onSelectService(service)}
                          className="text-indigo-600 hover:text-indigo-800 font-bold text-[11px] flex items-center gap-1"
                        >
                          Audit Details &rarr;
                        </button>

                        <button
                          onClick={() => onJoinQueue(service)}
                          disabled={service.status === 'closed'}
                          className="px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold text-[11px] hover:bg-indigo-700 disabled:bg-slate-300 transition-colors shadow-sm font-sans"
                        >
                          Join Line
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-2xl border border-slate-200">
            💡 <strong>Transit Advice:</strong> Use the walk router above to plan transit times between lectures and service visits.
          </div>
        </div>
      </div>
    </div>
  );
};
