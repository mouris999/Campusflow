import React, { useState } from 'react';
import { Service } from '../types/index.js';
import { useApp } from '../context/AppContext.js';
import {
  X,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText
} from 'lucide-react';

interface AppointmentModalProps {
  service: Service;
  onClose: () => void;
}

const AVAILABLE_SLOTS = [
  '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '13:30', '14:00',
  '14:30', '15:00', '15:30', '16:00'
];

export const AppointmentModal: React.FC<AppointmentModalProps> = ({ service, onClose }) => {
  const { bookAppointment, myAppointments } = useApp();

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(tomorrow);
  const [selectedSlot, setSelectedSlot] = useState<string>(AVAILABLE_SLOTS[2]);
  const [purpose, setPurpose] = useState<string>('Academic record verification and graduation audit');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Check if slot already booked by anyone or current user
  const isSlotBooked = (slot: string) => {
    return myAppointments.some(
      a => a.service_id === service.id && a.date === selectedDate && a.slot_time === slot && a.status === 'booked'
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const res = await bookAppointment({
      service_id: service.id,
      date: selectedDate,
      slot_time: selectedSlot,
      duration_mins: 20,
      service_purpose: purpose
    });

    setIsSubmitting(false);

    if (res.success) {
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } else {
      setErrorMessage(res.error || 'Failed to book slot.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-purple-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-700 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base">Schedule Appointment</h3>
              <p className="text-xs text-purple-200">{service.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-purple-200 hover:text-white hover:bg-purple-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h4 className="font-bold text-slate-900 text-lg">Appointment Confirmed!</h4>
            <p className="text-xs text-slate-500">
              Reserved for {selectedDate} at {selectedSlot}. A notification and confirmation badge have been added to your profile.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Date selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Select Date
              </label>
              <input
                type="date"
                value={selectedDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-full p-2.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />
            </div>

            {/* Time Slot selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Available Time Slots
              </label>
              <div className="grid grid-cols-4 gap-2">
                {AVAILABLE_SLOTS.map(slot => {
                  const booked = isSlotBooked(slot);
                  const isSelected = selectedSlot === slot;
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={booked}
                      onClick={() => setSelectedSlot(slot)}
                      className={`py-2 px-1 text-xs rounded-lg font-semibold border transition-all ${
                        booked
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through'
                          : isSelected
                          ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Purpose input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Reason / Service Purpose
              </label>
              <textarea
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                rows={2}
                className="w-full p-2.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="State your reason, e.g. Document verification, ID card renewal..."
                required
              />
            </div>

            {/* Error banner if concurrency conflict or issue */}
            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Actions */}
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
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow"
              >
                {isSubmitting ? 'Reserving...' : 'Confirm Appointment'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
