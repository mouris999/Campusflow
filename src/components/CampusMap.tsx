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

  // Calculate Euclidean walking distance & minutes between route origin and selected building
  const walkingRouteData = useMemo(() => {
    if (!routeOriginBuilding || !selectedBuilding || routeOriginBuilding.id === selectedBuilding.id) {
      return { distanceMeters: 0, walkMins: 0, isSame: true };
    }
    const dx = selectedBuilding.map_coords.x - routeOriginBuilding.map_coords.x;
    const dy = selectedBuilding.map_coords.y - routeOriginBuilding.map_coords.y;
    // Map scale: 1 unit ~ 10 meters on campus quad
    const distanceMeters = Math.round(Math.sqrt(dx * dx + dy * dy) * 9.5);
    // Walking speed: ~80 meters per minute
    const walkMins = Math.max(1, Math.round(distanceMeters / 80));
    return { distanceMeters, walkMins, isSame: false };
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
          ) : (
            <div className="flex items-center gap-3 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-slate-400">EST. WALK:</span>
              <span className="text-amber-400 font-black text-sm">~{walkingRouteData.walkMins} MINS</span>
              <span className="text-slate-500">({walkingRouteData.distanceMeters}m across Quad)</span>
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

          {/* SVG Map Canvas */}
          <div className="relative w-full h-[420px] my-auto">
            <svg
              className="w-full h-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <pattern id="campus-grid-lines" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1e293b" strokeWidth="0.4" />
                </pattern>
              </defs>
              <rect width="100" height="100" fill="#090d16" />
              <rect width="100" height="100" fill="url(#campus-grid-lines)" />

              {/* Central Quad Park Landscape */}
              <circle cx="50" cy="50" r="20" fill="#14281f" opacity="0.6" stroke="#22543d" strokeWidth="0.5" strokeDasharray="1,1" />

              {/* Walkways */}
              <path d="M 28 35 Q 50 50 80 65" fill="none" stroke="#334155" strokeWidth="2.5" strokeDasharray="2,2" />
              <path d="M 45 15 L 50 50 L 20 70" fill="none" stroke="#334155" strokeWidth="2.5" strokeDasharray="2,2" />
              <path d="M 68 30 L 50 50 L 52 55" fill="none" stroke="#334155" strokeWidth="2.5" strokeDasharray="2,2" />

              {/* Wayfinding Route Line if between two different buildings */}
              {!walkingRouteData.isSame && routeOriginBuilding && selectedBuilding && (
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

              {/* Central Quad Title */}
              <text x="50" y="49" fill="#475569" fontSize="2.8" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
                UNIVERSITY CENTRAL QUAD • 1892
              </text>
            </svg>

            {/* Buildings as interactive architectural pins */}
            {buildings.map(building => {
              const stats = buildingStats[building.id] || { totalQueue: 0, maxWait: 0, serviceCount: 0, isCongested: false };
              const isSelected = selectedBuildingId === building.id;
              const isRouteOrigin = routeOriginId === building.id;

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
                  className={`absolute cursor-pointer transition-all z-20 group ${
                    isSelected ? 'scale-110 z-30' : 'hover:scale-105'
                  }`}
                >
                  <div className={`p-2.5 rounded-2xl border flex flex-col items-center shadow-2xl transition-all ${
                    isSelected
                      ? 'bg-indigo-950 border-indigo-400 ring-4 ring-indigo-500/30'
                      : isRouteOrigin
                      ? 'bg-purple-950/90 border-purple-400 ring-2 ring-purple-500/30'
                      : 'bg-slate-900/95 border-slate-700 hover:border-slate-500'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <Building2 className={`w-3.5 h-3.5 ${isSelected ? 'text-indigo-300' : 'text-slate-400'}`} />
                      <span className="text-xs font-mono font-black text-white">
                        {building.code}
                      </span>
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-black shadow-sm ${badgeColor}`}>
                        ~{stats.maxWait}m
                      </span>
                    </div>

                    <div className="text-[10px] font-sans font-bold text-slate-300 truncate max-w-[120px] mt-0.5">
                      {building.name}
                    </div>

                    <div className="text-[9px] font-mono text-slate-400 mt-0.5 flex items-center gap-1">
                      <span>{stats.totalQueue} waiting</span>
                      <span>•</span>
                      <span>{stats.serviceCount} counters</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-[11px] font-mono text-slate-500 text-center z-10 pt-2 border-t border-slate-800">
            CLICK ANY CAMPUS BUILDING TO INSPECT COUNTERS &amp; ELEVATION
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
