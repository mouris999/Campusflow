import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import { QueueEntry, Appointment } from '../types/index.js';
import {
  Ticket,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  Calendar,
  XCircle,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  BellRing,
  RotateCcw,
  Footprints,
  Smartphone,
  Volume2,
  Navigation,
  ExternalLink,
  X
} from 'lucide-react';

const CAMPUS_LOCATIONS = [
  { id: 'lib', name: 'Williamson Central Library', walkMins: 4 },
  { id: 'unn', name: 'Student Union Canteen', walkMins: 2 },
  { id: 'quad', name: 'Central Quad Lawn', walkMins: 3 },
  { id: 'eng', name: 'Engineering Maker Lab', walkMins: 6 },
  { id: 'sci', name: 'Chemistry & Science Complex', walkMins: 5 },
  { id: 'dorm', name: 'North Residence Halls', walkMins: 9 }
];

export const MyActivity: React.FC = () => {
  const {
    myQueues,
    myAppointments,
    cancelQueue,
    checkInAtCounter,
    cancelAppointment,
    setActiveTab,
    playChime
  } = useApp();

  const [now, setNow] = useState(Date.now());
  const [selectedLocationId, setSelectedLocationId] = useState<string>('lib');
  const [isQrModalOpen, setIsQrModalOpen] = useState<boolean>(false);
  const [isChimeTesting, setIsChimeTesting] = useState<boolean>(false);

  // Second-by-second countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeQueue = myQueues.find(q => ['waiting', 'called', 'in_service'].includes(q.status));
  const completedQueues = myQueues.filter(q => ['completed', 'skipped', 'cancelled', 'no_show'].includes(q.status));

  // Grace period remaining calculation
  let graceRemainingSeconds = 0;
  if (activeQueue && activeQueue.status === 'called' && activeQueue.grace_period_expires_at) {
    const expiry = new Date(activeQueue.grace_period_expires_at).getTime();
    graceRemainingSeconds = Math.max(0, Math.round((expiry - now) / 1000));
  }

  const formatCountdown = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleCancel = async (id: string) => {
    if (confirm('Cancel this virtual queue ticket? You will surrender your position in line.')) {
      await cancelQueue(id);
    }
  };

  const handleTestChime = () => {
    setIsChimeTesting(true);
    playChime();
    setTimeout(() => setIsChimeTesting(false), 1200);
  };

  const currentLocation = CAMPUS_LOCATIONS.find(l => l.id === selectedLocationId) || CAMPUS_LOCATIONS[0];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* ========================================================================= */}
      {/* ACTIVE DIGITAL PASS / TRANSIT-STYLE BOARDING TICKET */}
      {/* ========================================================================= */}
      {activeQueue ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="font-display font-black text-lg text-slate-900 uppercase tracking-tight">
                Live Dispatched Digital Ticket
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestChime}
                className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors flex items-center gap-1.5"
                title="Test audio chime notification"
              >
                <Volume2 className={`w-3.5 h-3.5 ${isChimeTesting ? 'text-indigo-600 animate-bounce' : 'text-slate-500'}`} />
                <span>{isChimeTesting ? 'Chiming...' : 'Test Chime'}</span>
              </button>
              <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-slate-900 text-indigo-300 border border-slate-700">
                SERIAL: CF-{activeQueue.id.slice(-6).toUpperCase()}
              </span>
            </div>
          </div>

          {/* PHYSICAL TICKET CONTAINER */}
          <div className={`ticket-stub rounded-3xl border-2 shadow-xl overflow-hidden transition-all relative ${
            activeQueue.status === 'called'
              ? 'border-amber-400 bg-amber-500/5 ring-4 ring-amber-400/20'
              : activeQueue.status === 'in_service'
              ? 'border-emerald-500 bg-emerald-500/5'
              : 'border-slate-800 bg-white'
          }`}>
            {/* Top Stage Bar if CALLED */}
            {activeQueue.status === 'called' && (
              <div className="bg-amber-400 text-slate-950 p-4 text-center border-b-2 border-amber-500">
                <div className="flex items-center justify-center gap-2 font-black text-lg uppercase tracking-wider font-display">
                  <BellRing className="w-6 h-6 animate-bounce" />
                  Your Turn is Called! Proceed to Counter {activeQueue.counter_number}
                </div>
                <div className="text-xs font-mono font-bold text-amber-950 mt-1">
                  GRACE PERIOD ACTIVE: PRESENT TICKET WITHIN{' '}
                  <span className="bg-slate-950 text-amber-300 px-2 py-0.5 rounded font-black text-sm">
                    {formatCountdown(graceRemainingSeconds)}
                  </span>
                </div>
              </div>
            )}

            {/* In Service Bar */}
            {activeQueue.status === 'in_service' && (
              <div className="bg-emerald-600 text-white p-3 text-center font-bold text-xs flex items-center justify-center gap-2 tracking-wide font-mono">
                <CheckCircle2 className="w-4 h-4" />
                COUNTER {activeQueue.counter_number} IS CURRENTLY PROCESSING YOUR SERVICE
              </div>
            )}

            {/* Ticket Upper Body: Header & Serial */}
            <div className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-dashed border-slate-300">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      METROPOLITAN UNIVERSITY
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      MODE: {activeQueue.check_in_type.toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-display font-black text-slate-900 mt-2">
                    {activeQueue.service_name}
                  </h3>
                  <div className="text-xs text-slate-500 font-mono mt-1">
                    STUDENT: <strong>{activeQueue.student_name}</strong> • ID: <strong>{activeQueue.student_id_code}</strong>
                  </div>
                </div>

                {/* Giant Boarding Number Badge */}
                <div className="bg-slate-950 text-white p-4 rounded-2xl text-center sm:text-right border border-slate-800 shadow-inner">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">
                    Ticket Number
                  </div>
                  <div className="text-3xl sm:text-4xl font-mono font-black text-indigo-400 tracking-wider">
                    {activeQueue.ticket_number}
                  </div>
                </div>
              </div>

              {/* Position and Estimated Wait Indicators */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-center">
                  <div className="text-xs font-mono text-slate-400 uppercase font-bold">Line Position</div>
                  <div className={`text-3xl sm:text-4xl font-display font-black mt-1 ${
                    activeQueue.position === 1 ? 'text-amber-500' :
                    activeQueue.status === 'called' ? 'text-emerald-600' : 'text-slate-900'
                  }`}>
                    {activeQueue.status === 'called' ? 'NOW!' :
                     activeQueue.status === 'in_service' ? 'ACTIVE' :
                     `#${activeQueue.position}`}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    {activeQueue.position > 1 ? `${activeQueue.position - 1} ahead in line` : 'You are next up!'}
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-center">
                  <div className="text-xs font-mono text-slate-400 uppercase font-bold">Estimated Wait</div>
                  <div className="text-3xl sm:text-4xl font-display font-black text-slate-900 mt-1">
                    {activeQueue.status === 'called' ? '0 min' :
                     activeQueue.status === 'in_service' ? 'Serving' :
                     `~${Math.max(1, activeQueue.position * 4)}m`}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    Dynamic algorithm
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-center">
                  <div className="text-xs font-mono text-slate-400 uppercase font-bold">Assigned Counter</div>
                  <div className="text-3xl sm:text-4xl font-display font-black text-slate-900 mt-1">
                    {activeQueue.counter_number ? `Desk ${activeQueue.counter_number}` : 'TBD'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    {activeQueue.counter_number ? 'Proceed to desk' : 'Assigned on call'}
                  </div>
                </div>
              </div>

              {/* Real-Time Stepper Progress Visualizer */}
              <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200 space-y-2">
                <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  Queue Journey Lifecycle
                </span>
                <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                  <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                    1. Enqueued
                  </div>
                  <div className={`p-2 rounded-lg border font-bold ${
                    activeQueue.position <= 2 || activeQueue.status === 'called'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}>
                    2. Turn Nearby
                  </div>
                  <div className={`p-2 rounded-lg border font-bold ${
                    activeQueue.status === 'called' || activeQueue.status === 'in_service'
                      ? 'bg-amber-100 border-amber-300 text-amber-900 animate-pulse'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}>
                    3. Called to Desk
                  </div>
                  <div className={`p-2 rounded-lg border font-bold ${
                    activeQueue.status === 'in_service'
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}>
                    4. In Service
                  </div>
                </div>
              </div>

              {/* INTERACTIVE WALKING BUFFER & LOCATION CALCULATOR */}
              <div className="bg-indigo-50/60 p-4 rounded-2xl border border-indigo-200/80 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-indigo-600" />
                    <span className="font-display font-bold text-xs text-indigo-950">
                      Smart Walking Buffer Estimator
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-600 font-medium">I am currently at:</span>
                    <select
                      value={selectedLocationId}
                      onChange={e => setSelectedLocationId(e.target.value)}
                      className="bg-white border border-indigo-200 text-slate-800 rounded-lg px-2.5 py-1 text-xs font-semibold focus:ring-2 focus:ring-indigo-500"
                    >
                      {CAMPUS_LOCATIONS.map(loc => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} (~{loc.walkMins}m walk)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="p-3 bg-white rounded-xl border border-indigo-100 text-xs text-indigo-900 flex items-start gap-2.5">
                  <Footprints className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    At <strong>{currentLocation.walkMins} min</strong> walk from {activeQueue.service_name}, our predictive arrival model recommends that you begin walking when you reach <strong>Position #2</strong> (approx. {Math.max(1, activeQueue.position * 4 - currentLocation.walkMins)} mins from now).
                  </div>
                </div>
              </div>

              {/* Barcode & Verification Stub */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsQrModalOpen(true)}
                    className="w-14 h-14 bg-white hover:bg-slate-100 rounded-xl border border-slate-300 p-1 flex items-center justify-center shrink-0 transition-colors group cursor-zoom-in"
                    title="Click to zoom QR Code"
                  >
                    <QrCode className="w-10 h-10 text-slate-900 group-hover:scale-105 transition-transform" />
                  </button>
                  <div>
                    <div className="text-xs font-bold text-slate-900 font-display">Concourse Transit Verification Token</div>
                    <div className="text-[11px] font-mono text-slate-500">
                      TOKEN: CF-{activeQueue.ticket_number}-{activeQueue.id.slice(-4)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      ISSUED: {new Date(activeQueue.queue_join_time).toLocaleTimeString()} • <button onClick={() => setIsQrModalOpen(true)} className="text-indigo-600 underline font-sans">Tap to enlarge QR</button>
                    </div>
                  </div>
                </div>

                {activeQueue.status === 'called' && !activeQueue.checked_in_at_counter && (
                  <button
                    onClick={() => checkInAtCounter(activeQueue.id)}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl font-display font-black text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg transition-transform active:scale-95"
                  >
                    ✓ I Am at Desk — Check In Now
                  </button>
                )}
              </div>

              {/* Reassurance Message */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-2.5 text-xs text-slate-700">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>Freedom to Move:</strong> Your spot is secured in the virtual queue. Feel free to study at the Central Library, visit the dining hall, or work in the maker lab. You will receive an audio chime and notification when your position approaches.
                </div>
              </div>

              {/* Cancellation Option */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  onClick={() => handleCancel(activeQueue.id)}
                  className="text-xs font-mono font-bold text-rose-600 hover:text-rose-800 hover:underline"
                >
                  Cancel / Release Ticket
                </button>
                <span className="text-[11px] font-mono text-slate-400">
                  Joined: {new Date(activeQueue.queue_join_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Empty Queue State */
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 bg-slate-100 text-slate-600 rounded-2xl flex items-center justify-center mx-auto">
            <Ticket className="w-8 h-8" />
          </div>
          <div>
            <h3 className="font-display font-black text-xl text-slate-900">No Active Digital Ticket</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              You do not have any active virtual queue tickets right now. Browse campus services and take a digital ticket remotely.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('services')}
            className="px-6 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-md font-display"
          >
            Explore Campus Services &rarr;
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCHEDULED APPOINTMENTS */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-purple-600" />
          <span>Confirmed Booked Appointments</span>
        </h3>

        {myAppointments.filter(a => a.status === 'booked').length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-center text-xs text-slate-400 font-mono">
            NO UPCOMING RESERVED APPOINTMENTS
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {myAppointments.filter(a => a.status === 'booked').map(apt => (
              <div key={apt.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-purple-600 uppercase">
                      RESERVED SLOT
                    </span>
                    <h4 className="font-display font-bold text-slate-900 text-sm mt-0.5">{apt.service_name}</h4>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-purple-100 text-purple-800">
                    {apt.slot_time}
                  </span>
                </div>

                <div className="text-xs text-slate-600 space-y-1 font-sans">
                  <div>Date: <strong>{apt.date}</strong> at <strong>{apt.slot_time}</strong> ({apt.duration_mins}m)</div>
                  <div className="text-[11px] text-slate-500 italic">"{apt.service_purpose}"</div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] font-mono text-slate-400">ID: {apt.student_id_code}</span>
                  <button
                    onClick={() => cancelAppointment(apt.id)}
                    className="text-rose-600 hover:text-rose-700 font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* RECENT HISTORICAL TICKETS */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-500" />
          <span>Recent Queue History &amp; Audits</span>
        </h3>

        {completedQueues.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-center text-xs text-slate-400 font-mono">
            NO PREVIOUS QUEUE SESSIONS RECORDED
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-sm">
            {completedQueues.slice(0, 5).map(q => (
              <div key={q.id} className="p-4 flex items-center justify-between text-xs hover:bg-slate-50 transition-colors">
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <span>{q.service_name}</span>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {q.ticket_number}
                    </span>
                  </div>
                  <div className="text-slate-400 mt-0.5 text-[11px] font-mono">
                    {new Date(q.queue_join_time).toLocaleDateString()} at {new Date(q.queue_join_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • MODE: {q.check_in_type.toUpperCase()}
                  </div>
                </div>

                <div className="text-right">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    q.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                    q.status === 'no_show' ? 'bg-amber-100 text-amber-800' :
                    'bg-slate-100 text-slate-700'
                  }`}>
                    {q.status.toUpperCase()}
                  </span>
                  {q.actual_wait_mins !== undefined && (
                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                      Wait: {q.actual_wait_mins}m | Duration: {q.service_duration_mins || 5}m
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR Code Enlarged Modal */}
      {isQrModalOpen && activeQueue && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center space-y-4 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono font-bold text-indigo-600 uppercase">Kiosk Scan Token</span>
              <button
                onClick={() => setIsQrModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 inline-block">
              <QrCode className="w-48 h-48 mx-auto text-slate-900" />
            </div>

            <div className="space-y-1">
              <div className="text-2xl font-mono font-black text-slate-900">
                {activeQueue.ticket_number}
              </div>
              <div className="text-xs font-mono text-slate-500">
                TOKEN: CF-{activeQueue.ticket_number}-{activeQueue.id.slice(-4)}
              </div>
              <div className="text-xs text-slate-600 font-sans mt-2">
                Hold your screen up to the kiosk barcode scanner or counter operator tablet upon arrival.
              </div>
            </div>

            <button
              onClick={() => setIsQrModalOpen(false)}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
