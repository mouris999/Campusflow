import React, { useState } from 'react';
import { Service, CheckInType } from '../types/index.js';
import {
  X,
  Ticket,
  Smartphone,
  QrCode,
  Footprints,
  Clock,
  Users,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';

interface JoinQueueModalProps {
  service: Service;
  onClose: () => void;
  onConfirm: (serviceId: string, checkInType: CheckInType) => Promise<{ success: boolean; error?: string }>;
}

export const JoinQueueModal: React.FC<JoinQueueModalProps> = ({
  service,
  onClose,
  onConfirm
}) => {
  const [checkInType, setCheckInType] = useState<CheckInType>('remote');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    const res = await onConfirm(service.id, checkInType);
    setIsSubmitting(false);
    if (res.success) {
      onClose();
    } else {
      setErrorMessage(res.error || 'Failed to join queue.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Ticket className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base">Join Virtual Queue</h3>
              <p className="text-xs text-slate-300">{service.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Queue Snapshot */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center">
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Estimated Wait</div>
              <div className="text-lg font-black text-slate-900 mt-0.5">
                ~{service.estimated_wait_mins} mins
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Your Position</div>
              <div className="text-lg font-black text-indigo-600 mt-0.5">
                #{service.current_queue_length + 1} in line
              </div>
            </div>
          </div>

          {/* Check-In Mode Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Where are you joining from?
            </label>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setCheckInType('remote')}
                className={`w-full p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                  checkInType === 'remote'
                    ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Smartphone className={`w-5 h-5 shrink-0 mt-0.5 ${checkInType === 'remote' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <div>
                  <div className="text-xs font-bold text-slate-900">Remote Queue Entry (Recommended)</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    I am in my dorm, library, or anywhere on campus. CampusFlow will alert me when to walk over.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCheckInType('qr')}
                className={`w-full p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                  checkInType === 'qr'
                    ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <QrCode className={`w-5 h-5 shrink-0 mt-0.5 ${checkInType === 'qr' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <div>
                  <div className="text-xs font-bold text-slate-900">On-Site QR Scan Check-In</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    I am standing near the service counter or kiosk screen in {service.building_name}.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCheckInType('walk_in')}
                className={`w-full p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                  checkInType === 'walk_in'
                    ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Footprints className={`w-5 h-5 shrink-0 mt-0.5 ${checkInType === 'walk_in' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <div>
                  <div className="text-xs font-bold text-slate-900">Walk-In Waiting Area</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    I am currently seated in the hallway / waiting lounge.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Anti-Abuse Notice */}
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-[11px] leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Your digital ticket is bound to your student account. When your turn is called, you have a <strong>5-minute grace period</strong> to present your ticket at the counter.
            </span>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-400 transition-colors shadow"
            >
              {isSubmitting ? 'Issuing Ticket...' : 'Get Queue Ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
