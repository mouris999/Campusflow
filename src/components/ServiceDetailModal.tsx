import React, { useState, useEffect } from 'react';
import { Service, DELAY_REASON_LABELS } from '../types/index.js';
import {
  X,
  MapPin,
  Clock,
  Users,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  FileCheck,
  TrendingUp,
  Sparkles,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Building2
} from 'lucide-react';
import { ServiceTrafficPanel } from './traffic/ServiceTrafficPanel.js';
import { TrafficPeakPanel } from './TrafficPeakPanel.js';
import { ServiceIntelligenceExtras } from './ServiceIntelligenceExtras.js';

interface ServiceDetailModalProps {
  service: Service;
  onClose: () => void;
  onJoinQueue: (service: Service) => void;
  onBookAppointment: (service: Service) => void;
  onSwitchService: (serviceId: string) => void;
  isInQueue: boolean;
}

export const ServiceDetailModal: React.FC<ServiceDetailModalProps> = ({
  service,
  onClose,
  onJoinQueue,
  onBookAppointment,
  onSwitchService,
  isInQueue
}) => {
  const [whyLongData, setWhyLongData] = useState<any>(null);
  const [bestTimeData, setBestTimeData] = useState<any>(null);
  const [alternatives, setAlternatives] = useState<any[]>([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoadingAnalysis(true);

    Promise.all([
      fetch(`/api/services/${service.id}/why-long`).then(r => r.json()),
      fetch(`/api/services/${service.id}/best-time`).then(r => r.json()),
      fetch(`/api/services/${service.id}/alternatives`).then(r => r.json())
    ]).then(([whyRes, bestRes, altRes]) => {
      if (isMounted) {
        if (whyRes.success) setWhyLongData(whyRes.analysis);
        if (bestRes.success) setBestTimeData(bestRes.best_time);
        if (altRes.success) setAlternatives(altRes.alternatives);
        setLoadingAnalysis(false);
      }
    }).catch(err => {
      if (isMounted) setLoadingAnalysis(false);
    });

    return () => {
      isMounted = false;
    };
  }, [service.id]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">
              {service.category.replace('_', ' ')}
            </span>
            <h2 className="text-xl font-bold text-slate-900 leading-snug">
              {service.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close service details"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Top Status & Queue Snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <p className="text-[11px] text-slate-500 font-medium">Current Status</p>
              <p className={`text-sm font-bold uppercase mt-0.5 ${
                service.status === 'congested' ? 'text-amber-600' :
                service.status === 'closed' ? 'text-slate-600' : 'text-emerald-600'
              }`}>
                {service.status}
              </p>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 font-medium">Estimated Wait</p>
              <p className="text-base font-extrabold text-slate-900 mt-0.5">
                ~{service.estimated_wait_mins} mins
              </p>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 font-medium">Active Line</p>
              <p className="text-base font-extrabold text-slate-900 mt-0.5">
                {service.current_queue_length} students
              </p>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 font-medium">Open Counters</p>
              <p className="text-base font-extrabold text-slate-900 mt-0.5">
                {service.active_counters} / {service.total_counters} open
              </p>
            </div>
          </div>

          {/* Location & Operating Hours */}
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>
                <strong>Location:</strong> {service.building_name}, {service.floor} — {service.room_counter}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>
                <strong>Operating Hours:</strong> {service.operating_hours.open} – {service.operating_hours.close} ({service.operating_hours.days.join(', ')})
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">Service Scope</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              {service.description}
            </p>
          </div>

          {/* FEATURE: "WHY IS THE QUEUE LONG?" (Factual explanation from stored records) */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                Live Demand & Delay Cause Analysis
              </h4>
              {whyLongData?.is_congested ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  Congestion Detected
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Normal Flow
                </span>
              )}
            </div>

            {loadingAnalysis ? (
              <p className="text-xs text-slate-400 italic">Calculating operational queue metrics...</p>
            ) : whyLongData ? (
              <div className="text-xs text-slate-700 space-y-2">
                <p className="font-semibold text-slate-800 bg-white p-2.5 rounded-lg border border-slate-200 leading-relaxed">
                  {whyLongData.summary_explanation}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-slate-500">
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="block text-slate-400">Current Arrivals</span>
                    <strong className="text-slate-800">{whyLongData.arrivals_per_hour} / hour</strong>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="block text-slate-400">Normal Capacity</span>
                    <strong className="text-slate-800">{whyLongData.baseline_capacity_per_hour} / hour</strong>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="block text-slate-400">Demand Ratio</span>
                    <strong className={whyLongData.demand_ratio >= 1.3 ? 'text-red-600' : 'text-slate-800'}>
                      {whyLongData.demand_ratio}x normal
                    </strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* FEATURE: "BEST TIME TO VISIT" (Historical Hourly Wait Curve) */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-purple-600" />
              Historical Best Time to Visit
            </h4>

            {bestTimeData ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  {bestTimeData.recommendation}
                </p>

                {/* Hourly wait bar visualizer */}
                <div className="pt-2">
                  <div className="flex items-end gap-1.5 h-20 pt-2 border-b border-slate-200">
                    {bestTimeData.hourly_curve.map((h: any) => {
                      const maxWait = Math.max(...bestTimeData.hourly_curve.map((x: any) => x.avg_wait), 40);
                      const heightPct = Math.max(15, Math.round((h.avg_wait / maxWait) * 100));
                      const isBest = h.avg_wait <= (bestTimeData.min_expected_wait + 4);
                      const isPeak = h.avg_wait >= (bestTimeData.max_expected_wait - 5);

                      return (
                        <div key={h.hour} className="flex-1 flex flex-col items-center group relative">
                          {/* Tooltip */}
                          <div className="absolute -top-7 hidden group-hover:block bg-slate-900 text-white text-[10px] py-0.5 px-1.5 rounded whitespace-nowrap z-20">
                            {h.label}: ~{h.avg_wait}m wait
                          </div>
                          <div
                            style={{ height: `${heightPct}%` }}
                            className={`w-full rounded-t transition-all ${
                              isPeak ? 'bg-red-400' : isBest ? 'bg-emerald-400' : 'bg-slate-300'
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>8:00 AM (Low)</span>
                    <span className="text-red-500 font-semibold">12:00 PM (Lunch Peak)</span>
                    <span>5:00 PM (Closing)</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* FEATURE: MULTI-LOCATION LOAD BALANCING (Alternatives) */}
          {alternatives.length > 0 && (
            <div className="bg-indigo-50/70 rounded-xl p-4 border border-indigo-100 space-y-3">
              <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-indigo-600" />
                Multi-Location Load Balancing: Nearby Alternatives
              </h4>

              <div className="space-y-2">
                {alternatives.map((alt: any) => (
                  <div
                    key={alt.id}
                    className="bg-white p-3 rounded-lg border border-indigo-200 flex items-center justify-between gap-3 shadow-sm"
                  >
                    <div>
                      <div className="font-bold text-slate-900 text-xs">{alt.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {alt.building_name} ({alt.floor}) • ~{alt.walking_time_mins} min walk away
                      </div>
                      <div className="text-[11px] text-emerald-700 font-semibold mt-1">
                        Current wait: ~{alt.current_wait_mins}m ({alt.queue_length} in line)
                        {alt.time_saved_mins > 0 && ` — Saves ~${alt.time_saved_mins} mins net!`}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        onSwitchService(alt.id);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shrink-0 flex items-center gap-1"
                    >
                      View &rarr;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FEATURE: SMART TRAFFIC (peak prediction, verified catalogue, alternatives) */}
          <div className="rounded-xl border border-slate-200 p-4">
            <ServiceTrafficPanel
              service={service}
              onSwitchService={onSwitchService}
              onJoinQueue={onJoinQueue}
            />
          </div>

          {/* FEATURE: TRAFFIC TREND, PEAK TIMELINE, VIRTUAL TOKEN, SEATING */}
          <div className="space-y-3">
            <TrafficPeakPanel serviceId={service.id} />

            <ServiceIntelligenceExtras
              serviceId={service.id}
              serviceName={service.name}
              category={service.category}
              hasSeating={service.category === 'library'}
            />
          </div>

          {/* Required Documents Checklist */}
          {service.required_documents.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileCheck className="w-4 h-4 text-indigo-600" />
                Required Documents Before Arriving
              </h4>
              <ul className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                {service.required_documents.map((doc, idx) => (
                  <li key={idx} className="text-xs text-slate-700 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                    <span>{doc}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Important Instructions */}
          {service.important_instructions.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                Important Instructions
              </h4>
              <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside bg-slate-50 p-3 rounded-lg border border-slate-200">
                {service.important_instructions.map((inst, idx) => (
                  <li key={idx}>{inst}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 p-4 px-6 flex items-center justify-end gap-3 z-10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Close
          </button>

          {service.appointments_enabled && (
            <button
              onClick={() => {
                onClose();
                onBookAppointment(service);
              }}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-600 text-white hover:bg-purple-700 transition-colors flex items-center gap-1.5"
            >
              <Calendar className="w-4 h-4" />
              Schedule Appointment
            </button>
          )}

          {isInQueue ? (
            <span className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              ✓ Active Ticket Held
            </span>
          ) : (
            <button
              onClick={() => {
                onClose();
                onJoinQueue(service);
              }}
              disabled={service.status === 'closed'}
              className={`px-5 py-2 rounded-lg text-xs font-bold shadow transition-colors flex items-center gap-1.5 ${
                service.status === 'closed'
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98]'
              }`}
            >
              Join Virtual Queue
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
