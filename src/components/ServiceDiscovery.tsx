import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext.js';
import { Service, ServiceCategory } from '../types/index.js';
import {
  Search,
  Filter,
  Clock,
  Users,
  MapPin,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Calendar,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  FileText,
  Building,
  Radio,
  SlidersHorizontal,
  Compass,
  Zap,
  ArrowUpDown,
  Shuffle
} from 'lucide-react';

interface ServiceDiscoveryProps {
  onSelectService: (service: Service) => void;
  onJoinQueue: (service: Service) => void;
  onBookAppointment: (service: Service) => void;
}

const CATEGORY_TABS: { id: ServiceCategory | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: 'All Services', icon: '🏛️' },
  { id: 'admin_office', label: 'Administration', icon: '📑' },
  { id: 'canteen', label: 'Dining & Cafes', icon: '☕' },
  { id: 'laboratory', label: 'Labs & Workshops', icon: '🔬' },
  { id: 'library', label: 'Libraries', icon: '📚' },
  { id: 'helpdesk', label: 'IT & Student Help', icon: '💻' }
];

export const ServiceDiscovery: React.FC<ServiceDiscoveryProps> = ({
  onSelectService,
  onJoinQueue,
  onBookAppointment
}) => {
  const { services, buildings, announcements, myQueues } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory | 'all'>('all');
  const [filterOpenOnly, setFilterOpenOnly] = useState(false);
  const [filterLowWait, setFilterLowWait] = useState(false);
  const [filterAppointments, setFilterAppointments] = useState(false);

  // Sorting state on the split flap table
  const [sortField, setSortField] = useState<'wait' | 'queue' | 'code' | 'default'>('default');
  const [sortAsc, setSortAsc] = useState(true);

  // Active tickets set
  const activeQueueServiceIds = new Set(
    myQueues
      .filter(q => ['waiting', 'called', 'in_service'].includes(q.status))
      .map(q => q.service_id)
  );

  // Filtered & sorted services
  const filteredServices = useMemo(() => {
    let result = services.filter(service => {
      if (selectedCategory !== 'all' && service.category !== selectedCategory) {
        return false;
      }
      if (filterOpenOnly && service.status === 'closed') {
        return false;
      }
      if (filterLowWait && service.estimated_wait_mins > 10) {
        return false;
      }
      if (filterAppointments && !service.appointments_enabled) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = service.name.toLowerCase().includes(q);
        const matchesDesc = service.description.toLowerCase().includes(q);
        const matchesBld = service.building_name.toLowerCase().includes(q);
        const matchesDocs = service.required_documents.some(d => d.toLowerCase().includes(q));
        if (!matchesName && !matchesDesc && !matchesBld && !matchesDocs) {
          return false;
        }
      }
      return true;
    });

    if (sortField === 'wait') {
      result.sort((a, b) => sortAsc ? a.estimated_wait_mins - b.estimated_wait_mins : b.estimated_wait_mins - a.estimated_wait_mins);
    } else if (sortField === 'queue') {
      result.sort((a, b) => sortAsc ? a.current_queue_length - b.current_queue_length : b.current_queue_length - a.current_queue_length);
    } else if (sortField === 'code') {
      result.sort((a, b) => sortAsc ? a.code.localeCompare(b.code) : b.code.localeCompare(a.code));
    }

    return result;
  }, [services, selectedCategory, filterOpenOnly, filterLowWait, filterAppointments, searchQuery, sortField, sortAsc]);

  const toggleSort = (field: 'wait' | 'queue' | 'code') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* ========================================================================= */}
      {/* SIGNATURE ELEMENT: TERMINAL DEPARTURES & LIVE CONCOURSE SPLIT-FLAP BOARD */}
      {/* ========================================================================= */}
      <section className="terminal-board rounded-2xl border border-slate-700/80 p-5 sm:p-6 text-white overflow-hidden relative shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-700/80">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <div className="flex items-center gap-2 font-mono text-xs text-indigo-400 uppercase tracking-widest font-bold">
                <span>CONCOURSE STATUS GRID</span>
                <span>•</span>
                <span className="text-slate-400">METROPOLITAN CENTRAL</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black font-display tracking-tight text-white mt-0.5">
                Live Campus Service Status &amp; Wait Matrix
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-slate-400">SORT: <span className="text-indigo-400 font-bold uppercase">{sortField} ({sortAsc ? 'ASC' : 'DESC'})</span></span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">FEED: <span className="text-emerald-400 font-bold">REALTIME SSE</span></span>
          </div>
        </div>

        {/* The Split-Flap Table Header with interactive sort triggers */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left font-mono text-xs min-w-[700px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[11px]">
                <th
                  onClick={() => toggleSort('code')}
                  className="py-2 px-3 cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>Service Code</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>
                <th className="py-2 px-3">Facility &amp; Counter</th>
                <th className="py-2 px-3">Building Location</th>
                <th className="py-2 px-3 text-center">Open Counters</th>
                <th
                  onClick={() => toggleSort('queue')}
                  className="py-2 px-3 text-center cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Live Queue</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('wait')}
                  className="py-2 px-3 text-center cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Est. Wait</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>
                <th className="py-2 px-3 text-right">Dispatch Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredServices.map(srv => {
                const isCongested = srv.status === 'congested' || srv.estimated_wait_mins >= 25;
                const isModerate = srv.estimated_wait_mins >= 12 && !isCongested;
                const hasActiveTicket = activeQueueServiceIds.has(srv.id);

                return (
                  <tr
                    key={srv.id}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => onSelectService(srv)}
                  >
                    <td className="py-3 px-3">
                      <span className="inline-block px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-bold text-indigo-300 font-mono tracking-wider">
                        {srv.code}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-sans font-bold text-white group-hover:text-indigo-300 transition-colors text-xs">
                        {srv.name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {srv.room_counter} ({srv.floor})
                      </div>
                    </td>

                    <td className="py-3 px-3 text-slate-300 font-sans text-xs">
                      {srv.building_name}
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span className="font-bold text-slate-200">
                        {srv.active_counters}
                      </span>
                      <span className="text-slate-500">/{srv.total_counters}</span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span className="font-bold text-white">
                        {srv.current_queue_length}
                      </span>
                      <span className="text-slate-500 text-[10px] block">queued</span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded font-black text-xs ${
                        isCongested
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                          : isModerate
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}>
                        ~{srv.estimated_wait_mins}m
                      </span>
                    </td>

                    <td className="py-3 px-3 text-right">
                      {hasActiveTicket ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400 font-bold px-2 py-1 rounded bg-indigo-950/80 border border-indigo-800">
                          ✓ IN LINE
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onJoinQueue(srv);
                          }}
                          disabled={srv.status === 'closed'}
                          className="px-3 py-1 rounded font-sans font-bold text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm disabled:opacity-40"
                        >
                          Join Line &rarr;
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-slate-400 text-[11px] font-mono gap-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> &lt;10 MIN FAST</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> 10-25 MIN MODERATE</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" /> &gt;25 MIN SURGE</span>
          </div>
          <span>TAP COLUMN HEADERS TO SORT BY WAIT OR QUEUE</span>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* ACTIVE CAMPUS ANNOUNCEMENTS & ADVISORIES */}
      {/* ========================================================================= */}
      {announcements.length > 0 && (
        <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-4 flex items-start gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs text-amber-900">
            <div className="font-bold flex items-center gap-2">
              <span>{announcements[0].title}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-200 text-amber-900">ADVISORY</span>
            </div>
            <p className="text-amber-800 leading-relaxed">
              {announcements[0].message}
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SEARCH & FILTRATION TOOLBAR */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search services, room numbers, building names, or required documents (e.g. ID card, transcripts)..."
              className="w-full pl-9 pr-4 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 overflow-x-auto text-xs">
            <button
              onClick={() => setFilterOpenOnly(!filterOpenOnly)}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors border ${
                filterOpenOnly
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Open Only
            </button>

            <button
              onClick={() => setFilterLowWait(!filterLowWait)}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors border ${
                filterLowWait
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Wait &lt; 10m
            </button>

            <button
              onClick={() => setFilterAppointments(!filterAppointments)}
              className={`px-3 py-2 rounded-xl font-bold whitespace-nowrap transition-colors border ${
                filterAppointments
                  ? 'bg-purple-700 text-white border-purple-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Appointments
            </button>
          </div>
        </div>

        {/* Category Selector Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-slate-100">
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedCategory(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                selectedCategory === tab.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* DETAILED SERVICE CARDS GRID */}
      {/* ========================================================================= */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
            <span>Dispatched Campus Services</span>
            <span className="text-xs font-mono font-normal text-slate-500">
              ({filteredServices.length} available)
            </span>
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Sorted by {sortField.toUpperCase()}
          </span>
        </div>

        {filteredServices.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center text-slate-500 text-xs">
            <Compass className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="font-bold text-slate-700">No campus services match your criteria.</p>
            <p className="text-[11px] text-slate-400 mt-1">Try resetting your search query or filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredServices.map(service => {
              const hasActiveTicket = activeQueueServiceIds.has(service.id);
              const isCongested = service.status === 'congested' || service.estimated_wait_mins >= 25;
              const isModerate = service.estimated_wait_mins >= 12 && !isCongested;

              // Check if there is an alternate service with lower wait
              const alternateService = service.alternate_service_ids?.length
                ? services.find(s => service.alternate_service_ids.includes(s.id) && s.estimated_wait_mins < service.estimated_wait_mins)
                : null;

              return (
                <div
                  key={service.id}
                  className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-400 transition-all shadow-sm hover:shadow-md overflow-hidden flex flex-col justify-between group"
                >
                  <div className="p-5 space-y-4">
                    {/* Card Top: Code & Wait Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                          {service.code}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 uppercase">
                          {service.category.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full font-black text-xs font-mono ${
                          isCongested
                            ? 'bg-rose-100 text-rose-800'
                            : isModerate
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          ~{service.estimated_wait_mins}m wait
                        </span>
                      </div>
                    </div>

                    {/* Service Name & Location */}
                    <div>
                      <h4
                        onClick={() => onSelectService(service)}
                        className="font-display font-bold text-base text-slate-900 group-hover:text-indigo-600 cursor-pointer transition-colors leading-snug"
                      >
                        {service.name}
                      </h4>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{service.building_name} • {service.floor}, {service.room_counter}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {service.description}
                    </p>

                    {/* MULTI-LOCATION ALTERNATIVE RECOMMENDATION PILL */}
                    {alternateService && isCongested && (
                      <div
                        onClick={() => onSelectService(alternateService)}
                        className="p-2.5 bg-indigo-50/90 rounded-xl border border-indigo-200 text-xs text-indigo-950 flex items-center justify-between gap-2 cursor-pointer hover:bg-indigo-100/90 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <Shuffle className="w-4 h-4 text-indigo-600 shrink-0" />
                          <div>
                            <span className="font-bold">Faster Node: </span>
                            <span>{alternateService.name} (~{alternateService.estimated_wait_mins}m)</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-600 shrink-0 underline">
                          Switch &rarr;
                        </span>
                      </div>
                    )}

                    {/* Congestion Advisory if active incident */}
                    {service.active_incident_cause && (
                      <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span>
                          <strong>Delay Advisory:</strong> {service.active_incident_notes}
                        </span>
                      </div>
                    )}

                    {/* Operational Telemetry Bar */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center font-mono text-[11px]">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Queue</div>
                        <div className="font-bold text-slate-900">{service.current_queue_length} students</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Counters</div>
                        <div className="font-bold text-slate-900">{service.active_counters}/{service.total_counters}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Demand</div>
                        <div className={`font-bold ${service.demand_ratio >= 1.5 ? 'text-rose-600' : 'text-slate-900'}`}>
                          {service.demand_ratio}x
                        </div>
                      </div>
                    </div>

                    {/* Required Documents Mini-list */}
                    {service.required_documents.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                          Required for Counter:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {service.required_documents.slice(0, 2).map((doc, idx) => (
                            <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-sans truncate max-w-[150px]">
                              • {doc}
                            </span>
                          ))}
                          {service.required_documents.length > 2 && (
                            <span className="text-[10px] text-slate-400">
                              +{service.required_documents.length - 2} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => onSelectService(service)}
                      className="text-xs font-bold text-slate-600 hover:text-indigo-600 transition-colors"
                    >
                      Audit Details &rarr;
                    </button>

                    <div className="flex items-center gap-1.5">
                      {service.appointments_enabled && (
                        <button
                          onClick={() => onBookAppointment(service)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white text-purple-700 border border-purple-200 hover:bg-purple-50 transition-colors shadow-sm"
                          title="Book an advance appointment slot"
                        >
                          Book Slot
                        </button>
                      )}

                      {hasActiveTicket ? (
                        <span className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-indigo-100 text-indigo-800">
                          Active Ticket
                        </span>
                      ) : (
                        <button
                          onClick={() => onJoinQueue(service)}
                          disabled={service.status === 'closed'}
                          className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all active:scale-95 disabled:bg-slate-300"
                        >
                          Join Line
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
