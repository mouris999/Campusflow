import React from 'react';
import { useApp } from '../context/AppContext.js';
import {
  X,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Ticket,
  Calendar,
  CheckCheck
} from 'lucide-react';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose
}) => {
  const {
    notifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    unreadNotifsCount,
    setActiveTab
  } = useApp();

  if (!isOpen) return null;

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'turn_ready':
        return <Bell className="w-4 h-4 text-amber-500 animate-bounce" />;
      case 'return_soon':
        return <Clock className="w-4 h-4 text-indigo-500" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'delay_alert':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'appointment':
        return <Calendar className="w-4 h-4 text-purple-500" />;
      default:
        return <Ticket className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/60 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-400" />
            <h3 className="font-bold text-base">Live Activity Notifications</h3>
            {unreadNotifsCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-500 text-white">
                {unreadNotifsCount} new
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Actions bar */}
        <div className="p-2.5 px-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Real-time event stream</span>
          {unreadNotifsCount > 0 && (
            <button
              onClick={() => markAllNotificationsAsRead()}
              className="font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all as read
            </button>
          )}
        </div>

        {/* Notification Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {notifications.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-xs">
              <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p>No notifications yet.</p>
              <p className="text-[11px] text-slate-400 mt-1">Join a virtual queue or book an appointment to receive live turn alerts.</p>
            </div>
          ) : (
            notifications.map(notif => (
              <div
                key={notif.id}
                onClick={() => {
                  markNotificationAsRead(notif.id);
                  if (notif.type === 'turn_ready' || notif.type === 'return_soon' || notif.type === 'joined') {
                    setActiveTab('activity');
                    onClose();
                  }
                }}
                className={`p-3.5 rounded-xl border text-xs cursor-pointer transition-all hover:shadow-sm space-y-1 ${
                  !notif.read
                    ? 'bg-indigo-50/60 border-indigo-200'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900">
                    {getNotifIcon(notif.type)}
                    <span className="leading-snug">{notif.title}</span>
                  </div>
                  {!notif.read && (
                    <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0 mt-1" />
                  )}
                </div>

                <p className="text-slate-600 leading-relaxed text-[11px] pl-5">
                  {notif.message}
                </p>

                <div className="text-[10px] text-slate-400 pl-5 pt-0.5">
                  {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {notif.service_name}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
          Notifications are pushed in real time via Server-Sent Events.
        </div>
      </div>
    </div>
  );
};
