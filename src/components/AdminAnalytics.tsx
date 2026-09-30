import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.js';
import {
  BarChart3,
  Clock,
  MapPin,
  AlertTriangle,
  TrendingUp,
  Users,
  CheckCircle2,
  Calendar,
  Sparkles,
  Sliders,
  FileText,
  Activity,
  ArrowRight,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { PeakIntelligencePanel } from './traffic/PeakIntelligencePanel.js';
import { secureWrite } from '../lib/api.js';

export const AdminAnalytics: React.FC = () => {
  const { services, buildings, updateCapacity } = useApp();
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [selectedSubTab, setSelectedSubTab] = useState<'when' | 'where' | 'why' | 'impact' | 'peaks' | 'simulator'>('when');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isApplyingConfig, setIsApplyingConfig] = useState<boolean>(false);
  const [applySuccessMessage, setApplySuccessMessage] = useState<string | null>(null);

  // Simulation State
  const [simServiceId, setSimServiceId] = useState<string>('srv-reg-main');
  const [simAddedCounters, setSimAddedCounters] = useState<number>(1);
  const [simAvgServiceTime, setSimAvgServiceTime] = useState<number>(5);
  const [simArrivalMultiplier, setSimArrivalMultiplier] = useState<number>(1.2);
  const [simAppointmentPct, setSimAppointmentPct] = useState<number>(30);
  const [simResult, setSimResult] = useState<any>(null);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/analytics');
      const data = await res.json();
      if (data.success) {
        setAnalyticsData(data.analytics);
      }
    } catch (e) {
      console.error('Failed to fetch analytics:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const runSimulation = async () => {
    try {
      const res = await secureWrite('/api/analytics/simulate', 'POST', {
        service_id: simServiceId,
        added_counters: simAddedCounters,
        avg_service_time_mins: simAvgServiceTime,
        arrival_rate_multiplier: simArrivalMultiplier,
        appointment_percentage: simAppointmentPct
      });
      const data = await res.json();
      if (data.success) {
        setSimResult(data.simulation);
      }
    } catch (e) {
      console.error('Simulation failed:', e);
    }
  };

  const handleApplySimulation = async () => {
    const currentService = services.find(s => s.id === simServiceId);
    if (!currentService) return;
    const newActive = currentService.active_counters + simAddedCounters;
    setIsApplyingConfig(true);
    setApplySuccessMessage(null);
    const success = await updateCapacity(
      simServiceId,
      newActive,
      newActive,
      `M/M/c Queuing Optimization (+${simAddedCounters} counter) applied by Administrator`
    );
    setIsApplyingConfig(false);
    if (success) {
      setApplySuccessMessage(`Successfully dispatched ${newActive} active counters for ${currentService.name}!`);
      setTimeout(() => setApplySuccessMessage(null), 4500);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  useEffect(() => {
    if (selectedSubTab === 'simulator') {
      runSimulation();
    }
  }, [selectedSubTab, simServiceId, simAddedCounters, simAvgServiceTime, simArrivalMultiplier, simAppointmentPct]);

  if (isLoading || !analyticsData) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-indigo-600" />
        <p className="font-semibold text-sm">Aggregating Campus Operations Data...</p>
      </div>
    );
  }

  const { kpis, when_analysis, where_analysis, why_analysis, impact_summary } = analyticsData;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/30 text-indigo-300 border border-indigo-500/40">
                ADMINISTRATIVE AUDIT ENGINE
              </span>
              <span className="text-xs text-slate-400">Live Campus Operations &amp; Congestion Patterns</span>
            </div>
            <h2 className="text-2xl font-bold mt-1">Operational Analytics &amp; Wait-Time Intelligence</h2>
          </div>
          <button
            onClick={fetchAnalytics}
            className="self-start sm:self-center px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-semibold hover:bg-slate-700 flex items-center gap-1.5 transition-colors border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Analytics
          </button>
        </div>
      </div>

      {/* CORE KPI CARDS (Real recorded data, not faked) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Student Time Impact */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>Aggregate Waiting Lost</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">
            {kpis.aggregate_waiting_minutes} <span className="text-xs font-normal text-slate-500">mins</span>
          </div>
          <div className="text-[11px] text-amber-700 font-medium">
            ≈ {kpis.student_hours_lost} lost student study hours
          </div>
        </div>

        {/* KPI 2: Total Queued Today */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>Students Served / Queued</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">
            {kpis.total_completed_today} / {kpis.total_queued_today}
          </div>
          <div className="text-[11px] text-slate-500">
            {kpis.total_waiting_now} currently in active virtual lines
          </div>
        </div>

        {/* KPI 3: Average Wait & Peak */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>Avg Wait / Peak Wait</span>
            <Activity className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">
            {kpis.avg_wait_mins}m <span className="text-sm font-normal text-slate-400">/ {kpis.peak_wait_mins}m peak</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Median wait time: {kpis.median_wait_mins} minutes
          </div>
        </div>

        {/* KPI 4: Prediction Accuracy & Abandonment */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>Prediction Accuracy</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600">
            {kpis.prediction_accuracy_pct}%
          </div>
          <div className="text-[11px] text-slate-500">
            Avg error ±{kpis.avg_prediction_error_mins}m • Abandon rate {kpis.abandonment_rate_pct}%
          </div>
        </div>
      </div>

      {/* SUB-TABS: WHEN, WHERE, WHY, IMPACT, SIMULATOR */}
      <div className="border-b border-slate-200 flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedSubTab('when')}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap rounded-lg transition-colors flex items-center gap-1.5 ${
            selectedSubTab === 'when'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          WHEN? (Time &amp; Hourly Rush)
        </button>

        <button
          onClick={() => setSelectedSubTab('where')}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap rounded-lg transition-colors flex items-center gap-1.5 ${
            selectedSubTab === 'where'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          WHERE? (Buildings &amp; Services)
        </button>

        <button
          onClick={() => setSelectedSubTab('why')}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap rounded-lg transition-colors flex items-center gap-1.5 ${
            selectedSubTab === 'why'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          WHY? (Delay Causes &amp; Incidents)
        </button>

        <button
          onClick={() => setSelectedSubTab('impact')}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap rounded-lg transition-colors flex items-center gap-1.5 ${
            selectedSubTab === 'impact'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Student Body Impact
        </button>

        <button
          onClick={() => setSelectedSubTab('peaks')}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap rounded-lg transition-colors flex items-center gap-1.5 ${
            selectedSubTab === 'peaks'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          PEAK INTELLIGENCE
        </button>

        <button
          onClick={() => setSelectedSubTab('simulator')}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap rounded-lg transition-colors flex items-center gap-1.5 ${
            selectedSubTab === 'simulator'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Staff Capacity Simulator
        </button>
      </div>

      {/* TAB CONTENT 1: WHEN? */}
      {selectedSubTab === 'when' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                When Do Longest Waits Occur? (Hourly Congestion Curve)
              </h3>
              <p className="text-xs text-slate-500">
                Hourly student arrival volume compared to average recorded waiting duration.
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
              Peak: {when_analysis.recurring_peak_window}
            </span>
          </div>

          {/* Hourly chart visualizer */}
          <div className="space-y-4">
            <div className="flex items-end gap-2 h-44 pt-4 border-b border-slate-200">
              {when_analysis.hourly_curve.map((h: any) => {
                const maxWait = Math.max(...when_analysis.hourly_curve.map((x: any) => x.avg_wait), 45);
                const heightPct = Math.max(12, Math.round((h.avg_wait / maxWait) * 100));
                const isPeak = h.avg_wait >= 28;

                return (
                  <div key={h.hour} className="flex-1 flex flex-col items-center group relative">
                    <div className="absolute -top-8 hidden group-hover:block bg-slate-900 text-white text-[10px] py-1 px-2 rounded whitespace-nowrap z-20 shadow-md">
                      <strong>{h.label}</strong>: ~{h.avg_wait}m wait ({h.arrivals} arrivals)
                    </div>
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t transition-all ${
                        isPeak ? 'bg-red-500' : h.avg_wait >= 16 ? 'bg-amber-400' : 'bg-indigo-400'
                      }`}
                    />
                    <span className="text-[10px] text-slate-500 font-bold mt-2 truncate w-full text-center">
                      {h.hour > 12 ? `${h.hour - 12}p` : `${h.hour}a`}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
              <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-red-900">
                <span className="font-bold block">🚨 Recurring Peak Surge</span>
                <span>{when_analysis.recurring_peak_window}</span>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900">
                <span className="font-bold block">⚡ Secondary Wave</span>
                <span>{when_analysis.secondary_peak_window}</span>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900">
                <span className="font-bold block">✓ Optimal Quiet Hours</span>
                <span>{when_analysis.quietest_window} (Lowest wait)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 2: WHERE? */}
      {selectedSubTab === 'where' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                Where Does Congestion Concentrate?
              </h3>
              <p className="text-xs text-slate-500">
                Campus locations and services ranked by wait time and bottleneck severity.
              </p>
            </div>
            <div className="text-xs text-slate-600">
              Primary Bottleneck: <strong>{where_analysis.top_congested_building}</strong>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider">
                  <th className="pb-2.5">Campus Service</th>
                  <th className="pb-2.5">Building Location</th>
                  <th className="pb-2.5">Category</th>
                  <th className="pb-2.5">Active / Total Counters</th>
                  <th className="pb-2.5">Average Recorded Wait</th>
                  <th className="pb-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {where_analysis.services_ranking.map((s: any) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 font-bold text-slate-900">{s.name}</td>
                    <td className="py-3 text-slate-600">{s.building_name}</td>
                    <td className="py-3 capitalize text-slate-500">{s.category.replace('_', ' ')}</td>
                    <td className="py-3 text-slate-700">
                      {s.active_counters} of {s.total_counters} open
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded font-black ${
                        s.avg_wait >= 25 ? 'bg-red-100 text-red-800' :
                        s.avg_wait >= 12 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        ~{s.avg_wait} mins
                      </span>
                    </td>
                    <td className="py-3 uppercase font-extrabold text-[10px]">
                      <span className={s.status === 'congested' ? 'text-amber-600' : 'text-emerald-600'}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: WHY? */}
      {selectedSubTab === 'why' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                Why Do Delays Occur? (Structured Cause Analysis)
              </h3>
              <p className="text-xs text-slate-500">
                Aggregated distribution of operational delay causes recorded by staff on duty.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Delay Causes Distribution */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Delay Causes Distribution (%)
              </h4>
              <div className="space-y-2.5">
                {why_analysis.delay_causes.map((cause: any) => (
                  <div key={cause.reason} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-700">{cause.label}</span>
                      <span className="font-bold text-slate-900">{cause.percentage}% ({cause.count} logs)</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${cause.percentage}%` }}
                        className="h-full bg-indigo-600 rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Operational Incidents Log */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Active Operational Incidents &amp; Staff Notes
              </h4>
              {why_analysis.active_incidents.length === 0 ? (
                <div className="p-6 bg-slate-50 rounded-xl text-center text-xs text-slate-400">
                  No active delay incidents logged.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[300px] overflow-y-auto">
                  {why_analysis.active_incidents.map((inc: any) => (
                    <div key={inc.id} className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5 text-xs">
                      <div className="flex items-center justify-between font-bold text-amber-900">
                        <span>{inc.service_name}</span>
                        <span className="text-[10px] bg-amber-200/80 px-1.5 py-0.5 rounded">
                          {inc.reason}
                        </span>
                      </div>
                      <p className="text-slate-700">{inc.notes}</p>
                      <div className="text-[10px] text-slate-400">
                        Reported by {inc.reported_by} at {new Date(inc.reported_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: IMPACT */}
      {selectedSubTab === 'impact' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="pb-3 border-b border-slate-200">
            <h3 className="font-bold text-slate-900 text-base">
              Campus Productivity &amp; Student Body Impact
            </h3>
            <p className="text-xs text-slate-500">
              Factual metrics showing aggregate lost student time due to physical queuing bottlenecks.
            </p>
          </div>

          <div className="bg-slate-900 text-white p-6 rounded-2xl space-y-4">
            <h4 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
              Executive Operational Statement
            </h4>
            <p className="text-base sm:text-lg leading-relaxed text-slate-200 font-medium">
              "{impact_summary.summary_text}"
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 font-medium">Students Queued Today</span>
              <div className="text-2xl font-black text-slate-900 mt-1">
                {impact_summary.total_students_affected}
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 font-medium">Total Minutes Lost in Line</span>
              <div className="text-2xl font-black text-amber-600 mt-1">
                {impact_summary.total_minutes_lost} mins
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-500 font-medium">Equivalent Academic Study Hours</span>
              <div className="text-2xl font-black text-indigo-600 mt-1">
                ~{impact_summary.equivalent_study_hours} hrs
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 5: PEAK INTELLIGENCE (recorded demand model) */}
      {selectedSubTab === 'peaks' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                RECORDED DEMAND
              </span>
              <h3 className="font-bold text-slate-900 text-base">
                Peak Prediction Model &amp; Smart Alternative Outcomes
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              The prediction model only runs where there is enough recorded history. Low-data services are
              listed with their confidence rather than a fabricated peak.
            </p>
          </div>
          <PeakIntelligencePanel />
        </div>
      )}

      {/* TAB CONTENT 6: STAFF CAPACITY SIMULATOR (Problem 30) */}
      {selectedSubTab === 'simulator' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                MATHEMATICAL MODELING
              </span>
              <h3 className="font-bold text-slate-900 text-base">
                Staff Capacity &amp; Arrival Smoothing Simulator
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Simulate operational scenarios: "What if we add one counter?", "What if 30% book appointments?", "What if arrivals surge 1.5x?"
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Simulation Input Controls */}
            <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200 text-xs">
              <h4 className="font-bold text-slate-800 uppercase tracking-wider mb-2">
                Simulation Variables
              </h4>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Target Service</label>
                <select
                  value={simServiceId}
                  onChange={e => setSimServiceId(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-300 bg-white"
                >
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.active_counters} current counters)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex justify-between font-bold text-slate-700 mb-1">
                  <span>Additional Open Counters: +{simAddedCounters}</span>
                  <span className="text-indigo-600">{simAddedCounters + (services.find(s => s.id === simServiceId)?.active_counters || 2)} total</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="1"
                  value={simAddedCounters}
                  onChange={e => setSimAddedCounters(parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <div>
                <div className="flex justify-between font-bold text-slate-700 mb-1">
                  <span>Average Service Time: {simAvgServiceTime} mins</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="12"
                  step="1"
                  value={simAvgServiceTime}
                  onChange={e => setSimAvgServiceTime(parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <div>
                <div className="flex justify-between font-bold text-slate-700 mb-1">
                  <span>Arrival Surge Multiplier: {simArrivalMultiplier}x</span>
                  <span>{simArrivalMultiplier >= 1.5 ? 'Heavy Rush' : 'Normal Flow'}</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="2.5"
                  step="0.1"
                  value={simArrivalMultiplier}
                  onChange={e => setSimArrivalMultiplier(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              <div>
                <div className="flex justify-between font-bold text-slate-700 mb-1">
                  <span>Appointment Slot Adoption: {simAppointmentPct}%</span>
                  <span className="text-emerald-700 font-semibold">Smooths arrival peaks</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="70"
                  step="5"
                  value={simAppointmentPct}
                  onChange={e => setSimAppointmentPct(parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-600"
                />
              </div>
            </div>

            {/* Simulation Results Output */}
            {simResult && (
              <div className="space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-800 uppercase">Simulated Queue Outcome</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                      M/M/c Queuing Model
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                      <span className="text-[11px] text-slate-500 font-medium">Baseline Wait</span>
                      <div className="text-xl font-bold text-slate-600 mt-1 line-through">
                        ~{simResult.baseline.estimated_wait_mins}m
                      </div>
                    </div>

                    <div className="bg-indigo-50 p-3.5 rounded-xl border border-indigo-200">
                      <span className="text-[11px] text-indigo-700 font-bold">Simulated New Wait</span>
                      <div className="text-2xl font-black text-indigo-600 mt-1">
                        ~{simResult.simulated.estimated_wait_mins}m
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1">
                    <div className="font-extrabold text-emerald-900 text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      Projected Improvement: {simResult.simulated.wait_reduction_pct}% Wait Reduction!
                    </div>
                    <p className="text-emerald-800 text-[11px] leading-relaxed">
                      Adding <strong>+{simAddedCounters} counter(s)</strong> and achieving <strong>{simAppointmentPct}% appointment adoption</strong> reduces student queue delay by approximately <strong>{simResult.simulated.wait_reduction_mins} minutes per student</strong>.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200">
                      <span>Server Utilization: </span>
                      <strong>{simResult.simulated.server_utilization_pct}%</strong>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200">
                      <span>Est. Line Length: </span>
                      <strong>{simResult.simulated.estimated_queue_length} students</strong>
                    </div>
                  </div>
                </div>

                {/* Live Capacity Optimization Dispatch Button */}
                <div className="pt-2 space-y-2">
                  {applySuccessMessage && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{applySuccessMessage}</span>
                    </div>
                  )}

                  <button
                    onClick={handleApplySimulation}
                    disabled={isApplyingConfig || simAddedCounters === 0}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isApplyingConfig ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Dispatching to Concourse Grid...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Apply +{simAddedCounters} Counter(s) to Live Service
                      </>
                    )}
                  </button>
                </div>

                <div className="text-[10px] text-slate-400 italic bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  * <strong>Simulation Model Notice:</strong> {simResult.model_metadata.disclaimer}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

