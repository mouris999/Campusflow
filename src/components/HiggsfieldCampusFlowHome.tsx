import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext.js';
import { Service, ServiceCategory } from '../types/index.js';
import {
  Search,
  Filter,
  ArrowRight,
  Clock,
  Users,
  MapPin,
  Calendar,
  AlertTriangle,
  Sparkles,
  Ticket,
  CheckCircle2,
  Shuffle
} from 'lucide-react';

interface HiggsfieldCampusFlowHomeProps {
  onSelectService: (service: Service) => void;
  onJoinQueue: (service: Service) => void;
  onBookAppointment: (service: Service) => void;
  onOpenActivity: () => void;
}

export const HiggsfieldCampusFlowHome: React.FC<HiggsfieldCampusFlowHomeProps> = ({
  onSelectService,
  onJoinQueue,
  onBookAppointment,
  onOpenActivity
}) => {
  const { services, myQueues, joinQueue, setActiveTab } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active user ticket
  const activeQueue = myQueues.find(q => ['waiting', 'called', 'in_service'].includes(q.status));

  // Service icons mapping to match Higgsfield style
  const getCategoryIcon = (category: ServiceCategory) => {
    switch (category) {
      case 'canteen': return '◒';
      case 'admin_office': return '▣';
      case 'laboratory': return '⌁';
      case 'library': return '▤';
      case 'helpdesk': return '⌨';
      default: return '◈';
    }
  };

  const getPillState = (service: Service) => {
    if (service.status === 'closed') return { label: 'Closed', class: 'closed' };
    if (service.estimated_wait_mins >= 20 || service.status === 'congested') {
      return { label: 'Busy', class: 'busy' };
    }
    if (service.estimated_wait_mins <= 8) {
      return { label: 'Quiet', class: 'quiet' };
    }
    return { label: 'Open', class: 'open' };
  };

  // Filtered services
  const filteredServices = useMemo(() => {
    return services.filter(service => {
      if (selectedFilter !== 'all') {
        if (selectedFilter === 'quiet' && service.estimated_wait_mins > 8) return false;
        if (selectedFilter === 'open' && service.status === 'closed') return false;
        if (selectedFilter === 'canteen' && service.category !== 'canteen') return false;
        if (selectedFilter === 'admin' && service.category !== 'admin_office') return false;
        if (selectedFilter === 'library' && service.category !== 'library') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = service.name.toLowerCase().includes(q);
        const matchesPlace = service.building_name.toLowerCase().includes(q) || service.room_counter.toLowerCase().includes(q);
        const matchesDesc = service.description.toLowerCase().includes(q);
        if (!matchesName && !matchesPlace && !matchesDesc) return false;
      }
      return true;
    });
  }, [services, selectedFilter, searchQuery]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleQuickJoin = async (service: Service) => {
    const res = await joinQueue(service.id, 'remote');
    if (res.success && res.entry) {
      setToastMessage(`${service.name} — Ticket #${res.entry.ticket_number}`);
    }
  };

  // Live top 4 queues for "Scene 01 / The Old Way" queue wall
  const sampleQueues = services.slice(0, 4);

  return (
    <div className="campus-shell">
      {/* ========================================================================= */}
      {/* HERO SCENE (Exact Higgsfield visual aesthetic with 3D animated orbit)      */}
      {/* ========================================================================= */}
      <section id="top" className="hero scene">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" /> LIVE CAMPUS OPERATIONS
          </p>
          <h1>
            Stop waiting.<br />
            <em>Start moving.</em>
          </h1>
          <p className="hero-lede">
            CampusFlow turns invisible campus queues into clear, live decisions — so students know where to go, when to arrive, and when they can get on with their day.
          </p>

          <div className="hero-actions">
            <button className="primary" onClick={() => scrollTo('live')}>
              See what’s moving now ↓
            </button>
            <button className="text-button" onClick={() => scrollTo('how')}>
              Watch the journey ↘
            </button>
            {activeQueue && (
              <button
                onClick={onOpenActivity}
                className="bg-amber-400 text-slate-950 font-bold px-4 py-3 rounded-full text-xs flex items-center gap-1.5 shadow-lg animate-pulse"
              >
                <Ticket className="w-3.5 h-3.5" />
                <span>Ticket #{activeQueue.ticket_number} Active (Pos #{activeQueue.position})</span>
              </button>
            )}
          </div>
        </div>

        {/* 3D Campus Orbit Visualizer */}
        <div className="campus-orbit" aria-hidden="true">
          <div className="sun" />
          <div className="orbit" />
          <div className="orbit orbit-b" />
          <div className="building b1" onClick={() => scrollTo('live')}>LIBRARY</div>
          <div className="building b2" onClick={() => scrollTo('live')}>LAB</div>
          <div className="building b3" onClick={() => scrollTo('live')}>ADMIN</div>
          <div className="building b4" onClick={() => scrollTo('live')}>CANTEEN</div>
          <div className="route r1" />
          <div className="route r2" />
          <div className="route r3" />
          <span className="student s1" />
          <span className="student s2" />
          <span className="student s3" />
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SCENE 01 / THE OLD WAY                                                    */}
      {/* ========================================================================= */}
      <section id="how" className="dark-scene scene">
        <div className="story-intro">
          <p className="kicker">01 / THE OLD WAY</p>
          <h2>
            The queue used to<br />
            <em>own your time.</em>
          </h2>
          <p>
            Four places. One lunch hour. No idea how long anything would take. You physically stood in hall corridors hoping your name would be called before class started.
          </p>
        </div>

        <div className="queue-wall">
          <div className="queue-title">
            TODAY · LIVE COUNTERS <span>● REAL-TIME DISPATCH</span>
          </div>

          {sampleQueues.map((srv, idx) => (
            <div key={srv.id} className="queue-line">
              <b>0{idx + 1}</b>
              <span className="font-semibold text-slate-800">{srv.name}</span>
              <strong className="text-slate-700">{srv.current_queue_length} waiting</strong>
              <i>~{srv.estimated_wait_mins} min</i>
            </div>
          ))}
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SCENE 02 / SEE BEFORE YOU GO (Live Campus Services Matrix)                */}
      {/* ========================================================================= */}
      <section id="live" className="live-section scene">
        <div className="section-head">
          <div>
            <p className="kicker">02 / SEE BEFORE YOU GO</p>
            <h2>
              Your campus,<br />
              <em>right now.</em>
            </h2>
          </div>

          <div className="status-note">
            <span className="live-dot" /> Updating live<br />
            <small>Direct SSE Telemetry · Connected to Concourse Grid</small>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="control-row">
          <div className="search">
            <span className="text-slate-500 font-bold">⌕</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="What do you need today? (e.g., transcripts, coffee, maker lab...)"
            />
          </div>

          <button
            onClick={() => setSelectedFilter('all')}
            className={`filter ${selectedFilter === 'all' ? 'active' : ''}`}
          >
            All services · {filteredServices.length}
          </button>

          <button
            onClick={() => setSelectedFilter('quiet')}
            className={`filter ${selectedFilter === 'quiet' ? 'active' : ''}`}
          >
            Quiet &lt; 8 min
          </button>

          <button
            onClick={() => setSelectedFilter('canteen')}
            className={`filter ${selectedFilter === 'canteen' ? 'active' : ''}`}
          >
            Dining
          </button>

          <button
            onClick={() => setSelectedFilter('admin')}
            className={`filter ${selectedFilter === 'admin' ? 'active' : ''}`}
          >
            Administration
          </button>
        </div>

        {/* Service Cards Grid */}
        <div className="service-grid">
          {filteredServices.map(service => {
            const pill = getPillState(service);
            const isUserInLine = activeQueue?.service_id === service.id;

            return (
              <article key={service.id} className="service-card group">
                <div className="card-top">
                  <span className="service-icon">{getCategoryIcon(service.category)}</span>
                  <span className={`pill ${pill.class}`}>{pill.label}</span>
                </div>

                <h3
                  onClick={() => onSelectService(service)}
                  className="cursor-pointer hover:text-lime-800 transition-colors"
                >
                  {service.name}
                </h3>
                <p>
                  {service.building_name} · {service.floor}, {service.room_counter}
                </p>

                <div className="wait">
                  <strong>{service.estimated_wait_mins}</strong>
                  <span>
                    min<br />
                    <small>estimated wait</small>
                  </span>
                </div>

                <div className="meter">
                  <span style={{ width: `${Math.min(95, Math.max(10, service.current_queue_length * 5))}%` }} />
                </div>

                <div className="card-bottom">
                  <span>{service.current_queue_length} students in queue</span>
                  {isUserInLine ? (
                    <button
                      onClick={onOpenActivity}
                      className="text-indigo-800 font-extrabold bg-indigo-100 px-2 py-0.5 rounded"
                    >
                      Your Ticket #{activeQueue?.ticket_number} &rarr;
                    </button>
                  ) : (
                    <button
                      onClick={() => handleQuickJoin(service)}
                      disabled={service.status === 'closed'}
                      className="hover:underline disabled:opacity-40"
                    >
                      Join remotely →
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SCENE 03 / MAKE THE SMART MOVE (Smartphone Virtual Pass)                  */}
      {/* ========================================================================= */}
      <section className="decision scene">
        <div className="decision-card">
          <div className="decision-copy">
            <p className="kicker">03 / MAKE THE SMART MOVE</p>
            <h2>
              Don’t stand in line.<br />
              <em>Join it from here.</em>
            </h2>
            <p>
              CampusFlow holds your place virtually and tells you when it’s actually time to walk over. Study at the library, grab an espresso, or work in the maker lab while your spot advances.
            </p>

            {activeQueue ? (
              <button className="primary" onClick={onOpenActivity}>
                View My Active Ticket #{activeQueue.ticket_number} →
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => {
                  const canteen = services.find(s => s.category === 'canteen') || services[0];
                  if (canteen) handleQuickJoin(canteen);
                }}
              >
                Join Central Canteen Remotely →
              </button>
            )}
          </div>

          {/* Interactive Phone Mockup */}
          <div className="phone">
            <div className="phone-top">
              <span>CampusFlow</span>
              <b>● LIVE</b>
            </div>

            <div className="phone-main">
              <small>YOUR PLACE</small>
              <strong>{activeQueue ? `#${activeQueue.position}` : '#08'}</strong>

              <div className="eta">
                <span>Arrive in</span>
                <b>
                  {activeQueue
                    ? `~${Math.max(1, activeQueue.position * 4)} min`
                    : '~6 min'}
                </b>
              </div>

              <div className="progress">
                <i style={{ width: activeQueue ? `${Math.max(20, 100 - activeQueue.position * 20)}%` : '72%' }} />
              </div>

              <p>
                {activeQueue
                  ? `${Math.max(0, activeQueue.position - 1)} people ahead · Serving at Counter ${activeQueue.counter_number || 1}`
                  : '12 people ahead · 2 counters serving'}
              </p>
            </div>

            <div className="phone-map">
              <span>●</span>
              <b>{activeQueue ? activeQueue.service_name : 'Central Student Center'}</b>
              <small>320 m · 4 min walk across Quad</small>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SCENE 04 / CAMPUS PULSE & OPERATIONAL INTELLIGENCE                        */}
      {/* ========================================================================= */}
      <section id="impact" className="impact scene">
        <div className="impact-copy">
          <p className="kicker">04 / CAMPUS PULSE</p>
          <h2>
            Measured impact,<br />
            <em>not guesswork.</em>
          </h2>
          <p>
            When students join remotely and counters balance traffic across buildings, peak hallway congestion drops by up to 64%. Every minute saved is student time given back.
          </p>
        </div>

        <div className="impact-board">
          <div className="metric">
            <span>WAITING MINUTES SAVED</span>
            <strong>1,284</strong>
            <small>this week · across 8 campus services</small>
          </div>

          <div className="chart">
            <span>PEAK LOAD · TODAY</span>
            <div className="bars">
              {[38, 52, 65, 84, 96, 74, 52, 41, 56, 72, 88, 62].map((val, i) => (
                <i key={i} style={{ height: `${val}%` }} title={`Hour ${8 + i}:00 — Load ${val}%`} />
              ))}
            </div>
            <div className="chart-axis">
              <span>8 AM</span>
              <span>12 PM</span>
              <span>4 PM</span>
              <span>8 PM</span>
            </div>
          </div>

          <div className="insight">
            <span className="text-lime-700 font-bold">↗</span>
            <div>
              <b>Peak collision detected</b>
              <p>12:00–1:15 PM · Canteen capacity is 82% utilized. North Annex grab-and-go recommended.</p>
            </div>
            <button onClick={() => setActiveTab('analytics')}>
              Explore →
            </button>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SCENE 05 / CLOSING SCENE & FOOTER                                         */}
      {/* ========================================================================= */}
      <section className="closing scene">
        <div className="closing-grid" />
        <p className="kicker">05 / THE NEW CAMPUS RHYTHM</p>
        <h2>
          More doing.<br />
          <em>Less waiting.</em>
        </h2>
        <p>One place to see the campus, choose the moment, and keep moving.</p>

        <button className="primary" onClick={() => scrollTo('live')}>
          Enter CampusFlow ↗
        </button>

        <footer>
          <span>© 2026 CampusFlow</span>
          <span>Built for students · powered by live operations</span>
          <span>Privacy · Accessibility · Real-time SSE</span>
        </footer>
      </section>

      {/* ========================================================================= */}
      {/* FLOATING SUCCESS TOAST NOTIFICATION                                       */}
      {/* ========================================================================= */}
      {toastMessage && (
        <div className="toast">
          <div>
            <span className="live-dot" /> Queue joined
          </div>
          <strong>{toastMessage}</strong>
          <p>You’re in remotely. We’ll keep your spot warm while you study or move across campus.</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setToastMessage(null)}>
              Done
            </button>
            <button
              onClick={() => {
                setToastMessage(null);
                onOpenActivity();
              }}
              className="!bg-lime-400 !text-slate-950 font-bold"
            >
              View Ticket →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
