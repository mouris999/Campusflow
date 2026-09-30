import React, { useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { useTraffic } from '../context/TrafficContext.js';
import {
  Compass,
  Ticket,
  MapPin,
  BarChart3,
  UserCheck,
  Bell,
  ChevronDown,
  LogOut,
  MessageSquare,
  Film,
  Activity
} from 'lucide-react';

interface NavbarProps {
  onOpenNotifications: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenNotifications }) => {
  const {
    currentUser,
    signOut,
    myQueues,
    activeTab,
    setActiveTab,
    unreadNotifsCount
  } = useApp();
  const { alerts } = useTraffic();
  const trafficAlertCount = alerts.length;

  const [accountOpen, setAccountOpen] = useState(false);

  const role = currentUser?.role;
  // Operations surfaces are gated by role, matching the server's own rules.
  const canOperate = role === 'staff' || role === 'admin';
  const canAudit = role === 'staff' || role === 'admin';

  // Find active waiting or called queue entry
  const activeQueue = myQueues.find(q => ['waiting', 'called', 'in_service'].includes(q.status));

  const ROLE_LABEL: Record<string, string> = {
    student: 'Student',
    staff: 'Counter Staff',
    admin: 'Campus Administrator'
  };

  const ROLE_DOT: Record<string, string> = {
    student: 'bg-[#d9f65b]',
    staff: 'bg-amber-400',
    admin: 'bg-rose-400'
  };

  const scrollTo = (id: string) => {
    if (activeTab !== 'services') {
      setActiveTab('services');
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } else {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="topbar">
      {/* Brand */}
      <div className="flex items-center gap-6">
        <button
          className="brand"
          onClick={() => {
            setActiveTab('services');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <span className="brand-mark">↗</span>
          <span className="font-extrabold tracking-tight">CampusFlow</span>
        </button>

        {/* Primary Story Links */}
        <div className="nav-links hidden md:flex">
          <button
            onClick={() => scrollTo('live')}
            className={activeTab === 'services' ? 'active' : ''}
          >
            Live campus
          </button>
          <button onClick={() => scrollTo('impact')}>
            Campus pulse
          </button>
          <button onClick={() => scrollTo('how')}>
            How it works
          </button>
        </div>
      </div>

      {/* Extended Operations Views Links */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 w-full lg:w-auto">
        <div className="hidden lg:flex items-center gap-1 bg-white/[0.04] p-1 rounded-full border border-white/10 text-xs">
          <button
            onClick={() => setActiveTab('services')}
            className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
              activeTab === 'services'
                ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Overview</span>
          </button>

          <button
            onClick={() => setActiveTab('activity')}
            className={`relative px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
              activeTab === 'activity'
                ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Ticket className="w-3.5 h-3.5" />
            <span>My pass</span>
            {activeQueue && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('map')}
            className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
              activeTab === 'map'
                ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Map</span>
          </button>

          <button
            onClick={() => setActiveTab('traffic')}
            className={`relative px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
              activeTab === 'traffic'
                ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Smart Traffic</span>
            {trafficAlertCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('plan')}
            className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
              activeTab === 'plan' ? 'bg-[#d9f65b] text-[#121315] font-bold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Plan</span>
          </button>

          {canAudit && (
            <button
              onClick={() => setActiveTab('analytics')}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                activeTab === 'analytics'
                  ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Audit</span>
            </button>
          )}

          {canOperate && (
            <button
              onClick={() => setActiveTab('staff')}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                activeTab === 'staff'
                  ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Operator</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('chat')}
            className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
              activeTab === 'chat'
                ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>AI Concierge</span>
          </button>

          <button
            onClick={() => setActiveTab('veo')}
            className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
              activeTab === 'veo'
                ? 'bg-[#d9f65b] text-[#121315] font-bold shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Veo</span>
          </button>
        </div>

        {/*
          Mobile tab bar. The pill row above is hidden below `lg`, which would
          otherwise leave phones with no way to reach any operations view.
          A horizontally scrollable strip keeps the same design language.
        */}
        <div
          className="lg:hidden w-full mt-2 flex items-center gap-1 overflow-x-auto pb-1 -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Sections"
        >
          {[
            { id: 'services' as const, label: 'Overview', icon: <Compass className="w-3.5 h-3.5" /> },
            { id: 'plan' as const, label: 'Plan', icon: <Compass className="w-3.5 h-3.5" /> },
            { id: 'activity' as const, label: 'My pass', icon: <Ticket className="w-3.5 h-3.5" />, dot: Boolean(activeQueue) },
            { id: 'map' as const, label: 'Map', icon: <MapPin className="w-3.5 h-3.5" /> },
            { id: 'traffic' as const, label: 'Smart Traffic', icon: <Activity className="w-3.5 h-3.5" />, dot: trafficAlertCount > 0 },
            ...(canAudit ? [{ id: 'analytics' as const, label: 'Audit', icon: <BarChart3 className="w-3.5 h-3.5" /> }] : []),
            ...(canOperate ? [{ id: 'staff' as const, label: 'Operator', icon: <UserCheck className="w-3.5 h-3.5" /> }] : []),
            { id: 'chat' as const, label: 'AI Concierge', icon: <MessageSquare className="w-3.5 h-3.5" /> }
          ].map(item => (
            <button
              key={item.id}
              role="tab"
              aria-selected={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
              className={`shrink-0 px-3 py-2 rounded-full text-xs font-bold border flex items-center gap-1.5 transition ${
                activeTab === item.id
                  ? 'bg-[#d9f65b] text-[#121315] border-[#d9f65b]'
                  : 'bg-white/[0.04] text-slate-300 border-white/10'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.dot && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {/* Notification Bell */}
        <button
          onClick={onOpenNotifications}
          className="relative p-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/10 transition-colors"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadNotifsCount > 0 && (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[10px] font-black bg-[#d9f65b] text-[#121315] shadow-sm">
              {unreadNotifsCount}
            </span>
          )}
        </button>

        {/* Signed-in account menu */}
        {currentUser && (
          <div className="relative">
            <button
              onClick={() => setAccountOpen(!accountOpen)}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-left transition-all text-xs"
            >
              <span className={`w-2 h-2 rounded-full ${ROLE_DOT[role!] ?? 'bg-[#d9f65b]'}`} />
              <span className="hidden sm:inline font-bold text-white">{currentUser.name}</span>
              <span className="text-[10px] text-slate-400 uppercase font-mono">
                ({role})
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {accountOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-64 bg-[#1a1b1e] rounded-2xl border border-white/10 shadow-2xl py-2 z-50 text-xs">
                <div className="px-3 py-2 border-b border-white/10">
                  <div className="font-semibold text-white">{currentUser.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{currentUser.email}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {currentUser.id_code} · {ROLE_LABEL[role!]}
                  </div>
                </div>

                <div className="px-3 py-2 text-[10px] text-slate-400 leading-relaxed border-b border-white/10">
                  {role === 'student' && 'You can discover services, join virtual queues and book appointments.'}
                  {role === 'staff' && 'You can operate your assigned counters and record delays.'}
                  {role === 'admin' && 'You have full campus configuration and analytics access.'}
                </div>

                <button
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false);
                    signOut();
                  }}
                  className="w-full px-3 py-2.5 text-left flex items-center gap-2 hover:bg-white/[0.06] transition-colors text-slate-300 hover:text-white"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="font-semibold">Sign out</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Find a Service CTA */}
        <button
          className="nav-cta"
          onClick={() => scrollTo('live')}
        >
          Find a service →
        </button>
      </div>
    </header>
  );
};
