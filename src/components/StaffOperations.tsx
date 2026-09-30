import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import { Service, DelayReason, DELAY_REASON_LABELS } from '../types/index.js';
import {
  UserCheck,
  PhoneCall,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Users,
  Settings,
  ShieldAlert,
  Play,
  Pause,
  ArrowRight,
  TrendingUp,
  Plus,
  Minus
} from 'lucide-react';
import { ItemAvailabilityEditor } from './traffic/ItemAvailabilityEditor.js';

export const StaffOperations: React.FC = () => {
  const {
    currentUser,
    services,
    allActiveQueues,
    callNextStudent,
    startService,
    completeService,
    skipStudent,
    updateCapacity,
    recordIncident,
    resolveIncident,
    playChime
  } = useApp();

  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    currentUser?.assigned_service_id || services[0]?.id || 'srv-reg-main'
  );
  const [counterNumber, setCounterNumber] = useState<number>(
    currentUser?.assigned_counter_number || 1
  );
  const [isCounterActive, setIsCounterActive] = useState<boolean>(true);

  // Delay Incident modal state
  const [showIncidentModal, setShowIncidentModal] = useState<boolean>(false);
  const [delayReason, setDelayReason] = useState<DelayReason>('document_verification');
  const [incidentNotes, setIncidentNotes] = useState<string>('');
  const [isSubmittingIncident, setIsSubmittingIncident] = useState<boolean>(false);

  // Capacity adjustment state
  const selectedService = services.find(s => s.id === selectedServiceId) || services[0];

  const serviceQueues = allActiveQueues.filter(q => q.service_id === selectedServiceId);
  const waitingStudents = serviceQueues
    .filter(q => q.status === 'waiting')
    .sort((a, b) => new Date(a.queue_join_time).getTime() - new Date(b.queue_join_time).getTime());

  // Currently called or being served at THIS counter
  const currentCounterEntry = serviceQueues.find(
    q => ['called', 'in_service'].includes(q.status) && q.counter_number === counterNumber
  );

  const handleCallNext = async () => {
    if (!selectedService) return;
    playChime();
    await callNextStudent(selectedService.id, counterNumber);
  };

  const handleStartService = async () => {
    if (currentCounterEntry) {
      await startService(currentCounterEntry.id);
    }
  };

  const handleCompleteService = async () => {
    if (currentCounterEntry) {
      await completeService(currentCounterEntry.id);
    }
  };

  // Keyboard shortcut listener for high-speed counter operation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!currentCounterEntry) {
          handleCallNext();
        } else if (currentCounterEntry.status === 'called') {
          handleStartService();
        } else if (currentCounterEntry.status === 'in_service') {
          handleCompleteService();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCounterEntry, selectedService, counterNumber]);

  const handleSkip = async (reason: 'skipped' | 'no_show') => {
    if (currentCounterEntry) {
      await skipStudent(currentCounterEntry.id, reason);
    }
  };

  const handleRecordIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentNotes.trim()) return;
    setIsSubmittingIncident(true);
    await recordIncident(selectedServiceId, delayReason, incidentNotes);
    setIsSubmittingIncident(false);
    setShowIncidentModal(false);
    setIncidentNotes('');
  };

  const handleAdjustCounters = async (delta: number) => {
    if (!selectedService) return;
    const newCount = Math.max(1, Math.min(selectedService.total_counters, selectedService.active_counters + delta));
    await updateCapacity(selectedService.id, newCount, newCount, `Manual staff adjustment at Counter ${counterNumber}`);
  };

  if (!selectedService || services.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
        <p className="font-semibold text-sm">Loading Campus Services...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Console Bar */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              STAFF DESK OPERATOR
            </span>
            <span className="text-xs text-slate-400">Operator: {currentUser?.name} ({currentUser?.id_code})</span>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
              ⌨️ [Spacebar] Fast Action
            </span>
          </div>
          <h2 className="text-xl font-bold mt-1">Counter Operations & Queue Console</h2>
        </div>

        {/* Service & Counter Selectors */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Active Service</label>
            <select
              value={selectedServiceId}
              onChange={e => setSelectedServiceId(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
            >
              {services.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.current_queue_length} waiting)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Your Counter #</label>
            <select
              value={counterNumber}
              onChange={e => setCounterNumber(parseInt(e.target.value, 10))}
              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
            >
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>
                  Counter {n}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-4">
            <button
              onClick={() => setIsCounterActive(!isCounterActive)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                isCounterActive
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {isCounterActive ? '● Counter Online' : '○ Counter Offline'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Staff Work Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT 2 COLS: ACTIVE TICKET & QUEUE CONTROLS */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Serving Panel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
                <h3 className="font-bold text-slate-900 text-base">
                  Counter {counterNumber} — Current Student
                </h3>
              </div>
              <span className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase ${
                !currentCounterEntry ? 'bg-slate-100 text-slate-600' :
                currentCounterEntry.status === 'called' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                'bg-emerald-100 text-emerald-800'
              }`}>
                {currentCounterEntry ? currentCounterEntry.status.replace('_', ' ') : 'Ready for Next Student'}
              </span>
            </div>

            {currentCounterEntry ? (
              <div className="space-y-4">
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="text-3xl font-black text-indigo-600 font-mono">
                      {currentCounterEntry.ticket_number}
                    </div>
                    <div className="text-base font-bold text-slate-900 mt-1">
                      {currentCounterEntry.student_name}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Student ID: {currentCounterEntry.student_id_code} • Mode: {currentCounterEntry.check_in_type}
                    </div>
                    {currentCounterEntry.checked_in_at_counter && (
                      <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        ✓ Checked In at Counter
                      </span>
                    )}
                  </div>

                  <div className="text-right space-y-1 text-xs text-slate-500">
                    <div>
                      Called at: {currentCounterEntry.called_time ? new Date(currentCounterEntry.called_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                    </div>
                    {currentCounterEntry.status === 'called' && (
                      <div className="text-amber-700 font-bold text-xs bg-amber-50 p-2 rounded border border-amber-200">
                        Grace period active (5m max)
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls for current student */}
                <div className="flex flex-wrap items-center gap-3">
                  {currentCounterEntry.status === 'called' && (
                    <button
                      onClick={handleStartService}
                      className="px-5 py-2.5 rounded-xl font-bold text-xs bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm flex items-center gap-1.5"
                    >
                      <Play className="w-4 h-4" />
                      Start Serving Student
                    </button>
                  )}

                  {currentCounterEntry.status === 'in_service' && (
                    <button
                      onClick={handleCompleteService}
                      className="px-5 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Mark Service Completed
                    </button>
                  )}

                  <button
                    onClick={() => handleSkip('no_show')}
                    className="px-4 py-2.5 rounded-xl font-semibold text-xs bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100"
                  >
                    Mark No-Show
                  </button>

                  <button
                    onClick={() => handleSkip('skipped')}
                    className="px-4 py-2.5 rounded-xl font-semibold text-xs bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ) : (
              /* Ready for Next Student */
              <div className="text-center py-8 space-y-4">
                <p className="text-sm text-slate-500">
                  Counter {counterNumber} is currently open and waiting for students.
                </p>
                <button
                  onClick={handleCallNext}
                  disabled={waitingStudents.length === 0}
                  className="px-8 py-3 rounded-xl font-extrabold text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 shadow-md transition-all active:scale-[0.98] inline-flex items-center gap-2"
                >
                  <PhoneCall className="w-5 h-5" />
                  Call Next Student ({waitingStudents.length} Waiting)
                </button>
              </div>
            )}
          </div>

          {/* Service item availability (drives Smart Traffic recommendations) */}
          <ItemAvailabilityEditor serviceId={selectedServiceId} />

          {/* Waiting Queue List */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Live Waiting Queue ({waitingStudents.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Ordered by arrival timestamp (FIFO virtual queue)
                </p>
              </div>
              <button
                onClick={handleCallNext}
                disabled={waitingStudents.length === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50"
              >
                Call Next in Line
              </button>
            </div>

            {waitingStudents.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No students currently waiting in this service queue.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden border border-slate-200 rounded-xl">
                {waitingStudents.map((entry, idx) => {
                  const waitMins = Math.max(1, Math.round((Date.now() - new Date(entry.queue_join_time).getTime()) / 60000));
                  return (
                    <div
                      key={entry.id}
                      className="p-3.5 flex items-center justify-between text-xs hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-center font-bold text-slate-400">
                          #{idx + 1}
                        </span>
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <span className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                              {entry.ticket_number}
                            </span>
                            <span>{entry.student_name}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            ID: {entry.student_id_code} • Mode: {entry.check_in_type}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="font-bold text-slate-700">{waitMins}m in line</span>
                          <div className="text-[10px] text-slate-400">Est: ~{entry.estimated_wait_at_join}m</div>
                        </div>

                        <button
                          onClick={() => callNextStudent(selectedServiceId, counterNumber)}
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 font-semibold border border-slate-200 text-[11px]"
                        >
                          Call
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COL: INCIDENTS, REASONS & CAPACITY MANAGEMENT */}
        <div className="space-y-6">
          {/* Active Incident Warning if Present */}
          {selectedService?.active_incident_cause && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h4 className="font-bold text-sm">Active Delay Advisory</h4>
              </div>
              <p className="text-xs text-amber-900 font-semibold">
                Reason: {DELAY_REASON_LABELS[selectedService.active_incident_cause]}
              </p>
              <p className="text-xs text-amber-800">
                "{selectedService.active_incident_notes}"
              </p>
              <div className="pt-2">
                <button
                  onClick={() => resolveIncident('inc-001')}
                  className="w-full py-2 px-3 rounded-lg text-xs font-bold bg-white text-amber-800 border border-amber-300 hover:bg-amber-100 transition-colors"
                >
                  ✓ Mark Delay Incident Resolved
                </button>
              </div>
            </div>
          )}

          {/* Record Structured Delay Reason Button */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              Operational Delay Logger
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              If waiting times are exceeding norms due to document verification, system glitches, or shortages, record structured reasons to keep students informed and feed the analytics engine.
            </p>
            <button
              onClick={() => setShowIncidentModal(true)}
              className="w-full py-2.5 px-3 rounded-xl font-bold text-xs bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors shadow-sm flex items-center justify-center gap-1.5"
            >
              <AlertTriangle className="w-4 h-4" />
              Record Delay Reason / Incident
            </button>
          </div>

          {/* Capacity Manager (Adjust active counters) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Settings className="w-4 h-4 text-indigo-600" />
              Capacity &amp; Staff Counter Control
            </h4>

            {selectedService && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-500">Active Counters</span>
                    <div className="text-lg font-black text-slate-900">
                      {selectedService.active_counters} / {selectedService.total_counters}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleAdjustCounters(-1)}
                      disabled={selectedService.active_counters <= 1}
                      className="p-2 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleAdjustCounters(1)}
                      disabled={selectedService.active_counters >= selectedService.total_counters}
                      className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 leading-snug">
                  Opening an additional counter immediately recalculates waiting times for all {waitingStudents.length} queued students.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL: RECORD STRUCTURED DELAY INCIDENT */}
      {showIncidentModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-amber-600 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-white" />
                <h3 className="font-bold text-base">Record Operational Delay Reason</h3>
              </div>
              <button
                onClick={() => setShowIncidentModal(false)}
                className="text-amber-200 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordIncident} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Structured Delay Reason
                </label>
                <select
                  value={delayReason}
                  onChange={e => setDelayReason(e.target.value as DelayReason)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-amber-500"
                >
                  {Object.entries(DELAY_REASON_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Incident Notes &amp; Explanation
                </label>
                <textarea
                  value={incidentNotes}
                  onChange={e => setIncidentNotes(e.target.value)}
                  rows={3}
                  placeholder="Detail the cause (e.g. Graduation audits taking 15m each, Counter 3 offline for shift change)..."
                  className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowIncidentModal(false)}
                  className="px-4 py-2 rounded-lg font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingIncident}
                  className="px-5 py-2 rounded-lg font-bold bg-amber-600 text-white hover:bg-amber-700 shadow"
                >
                  {isSubmittingIncident ? 'Saving...' : 'Broadcast Delay Advisory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
