import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { enqueuePendingAction, flushPendingActions } from '../lib/pendingActions.js';
import { setCsrfToken } from '../lib/api.js';
import {
  Service,
  Building,
  QueueEntry,
  Appointment,
  AppNotification,
  CampusAnnouncement,
  UserProfile,
  IncidentRecord,
  DelayReason
} from '../types/index.js';

export interface AppContextType {
  /** null until a session is established. */
  currentUser: UserProfile | null;
  authStatus: 'loading' | 'authenticated' | 'anonymous';
  authError: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * Exchanges a verified Firebase ID token for a CampusFlow session. Lives here
   * rather than in the button so session state stays owned in one place, exactly
   * as `signIn` does.
   */
  signInWithGoogleToken: (idToken: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  services: Service[];
  buildings: Building[];
  myQueues: QueueEntry[];
  allActiveQueues: QueueEntry[];
  myAppointments: Appointment[];
  notifications: AppNotification[];
  announcements: CampusAnnouncement[];
  unreadNotifsCount: number;
  selectedService: Service | null;
  setSelectedService: (s: Service | null) => void;
  activeTab: 'services' | 'plan' | 'activity' | 'map' | 'traffic' | 'analytics' | 'staff' | 'chat' | 'veo';
  setActiveTab: (tab: 'services' | 'plan' | 'activity' | 'map' | 'traffic' | 'analytics' | 'staff' | 'chat' | 'veo') => void;
  isLoading: boolean;
  refreshData: () => Promise<void>;
  joinQueue: (serviceId: string, checkInType: 'remote' | 'qr' | 'kiosk' | 'walk_in') => Promise<{ success: boolean; entry?: QueueEntry; error?: string }>;
  callNextStudent: (serviceId: string, counterNumber: number, counterId?: string) => Promise<{ success: boolean; entry?: QueueEntry; error?: string }>;
  startService: (queueId: string) => Promise<boolean>;
  completeService: (queueId: string) => Promise<boolean>;
  skipStudent: (queueId: string, reason: 'skipped' | 'no_show') => Promise<boolean>;
  cancelQueue: (queueId: string) => Promise<boolean>;
  checkInAtCounter: (queueId: string) => Promise<boolean>;
  updateCapacity: (serviceId: string, activeCounters: number, activeServers: number, reason?: string) => Promise<boolean>;
  recordIncident: (serviceId: string, reason: DelayReason, notes: string) => Promise<boolean>;
  resolveIncident: (incidentId: string) => Promise<boolean>;
  bookAppointment: (params: { service_id: string; date: string; slot_time: string; duration_mins: number; service_purpose: string }) => Promise<{ success: boolean; error?: string }>;
  cancelAppointment: (appointmentId: string) => Promise<boolean>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  /** Returns the CSRF token for writes made outside the context helper. */
  getCsrfToken: () => Promise<string | null>;
  resetDatabaseSeed: () => Promise<void>;
  playChime: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [myQueues, setMyQueues] = useState<QueueEntry[]>([]);
  const [allActiveQueues, setAllActiveQueues] = useState<QueueEntry[]>([]);
  const [myAppointments, setMyAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [announcements, setAnnouncements] = useState<CampusAnnouncement[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [activeTab, setActiveTab] = useState<'services' | 'plan' | 'activity' | 'map' | 'traffic' | 'analytics' | 'staff' | 'chat' | 'veo'>('services');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /** CSRF token issued with the current session; sent on every write. */
  const csrfTokenRef = React.useRef<string | null>(null);

  const playChime = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }, []);

  /** Resolves the session cookie held by the browser. */
  const resolveSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          setCurrentUser(data.user);
          setAuthStatus('authenticated');
          setAuthError(null);
          // Held for the request helper to echo on state-changing calls.
          csrfTokenRef.current = data.csrf_token ?? null;
          setCsrfToken(data.csrf_token ?? null);
          return;
        }
      }
      setCurrentUser(null);
      setAuthStatus('anonymous');
    } catch {
      setCurrentUser(null);
      setAuthStatus('anonymous');
      setAuthError('Cannot reach the CampusFlow server. Check your connection and try again.');
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Sign-in failed. Please try again.' };
      }
      setCurrentUser(data.user);
      setAuthStatus('authenticated');
      setAuthError(null);
      return { success: true };
    } catch {
      return { success: false, error: 'Cannot reach the CampusFlow server. Check your connection and try again.' };
    }
  }, []);

  /**
   * Exchanges a verified Firebase ID token for a CampusFlow session.
   *
   * The browser has already proved identity to Google; the server re-verifies the
   * token against Firebase's keys, pins it to the configured project, and only
   * then issues a session. This function just carries the token and adopts the
   * result, so the caller never handles a session cookie itself.
   */
  const signInWithGoogleToken = useCallback(async (idToken: string) => {
    try {
      const res = await fetch('/api/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ idToken })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Google sign-in failed. Please try again.' };
      }
      setCurrentUser(data.user);
      setAuthStatus('authenticated');
      setAuthError(null);
      return { success: true };
    } catch {
      return { success: false, error: 'Cannot reach the CampusFlow server. Check your connection and try again.' };
    }
  }, []);

  /** Reads the CSRF token for components that write outside the context helper. */
  const getCsrfToken = useCallback(async (): Promise<string | null> => {
    if (csrfTokenRef.current) return csrfTokenRef.current;
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      csrfTokenRef.current = data?.csrf_token ?? null;
      return csrfTokenRef.current;
    } catch {
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const token = await getCsrfToken();
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        ...(token ? { headers: { 'x-csrf-token': token } } : {})
      });
    } catch {
      // Even if the call fails locally, drop the client session.
    }
    setCurrentUser(null);
    setAuthStatus('anonymous');
    setMyQueues([]);
    setAllActiveQueues([]);
    setMyAppointments([]);
    setNotifications([]);
  }, []);

  const refreshData = useCallback(async () => {
    const userId = currentUser?.id;
    if (!userId) return;
    try {
      const [srvRes, bldRes, qUserRes, qAllRes, aptRes, notifRes, ancRes] = await Promise.all([
        fetch('/api/services', { credentials: 'same-origin' }),
        fetch('/api/buildings', { credentials: 'same-origin' }),
        fetch('/api/queue/user/me', { credentials: 'same-origin' }),
        fetch('/api/queue', { credentials: 'same-origin' }),
        fetch(`/api/appointments?user_id=${encodeURIComponent(userId)}`, { credentials: 'same-origin' }),
        fetch('/api/notifications/me', { credentials: 'same-origin' }),
        fetch('/api/announcements', { credentials: 'same-origin' })
      ]);

      // A 401 anywhere means the session lapsed; send the user back to sign-in.
      if ([srvRes, qUserRes, aptRes, notifRes].some(r => r.status === 401)) {
        await resolveSession();
        return;
      }

      const [srvData, bldData, qUserData, qAllData, aptData, notifData, ancData] = await Promise.all([
        srvRes.json(),
        bldRes.json(),
        qUserRes.json(),
        qAllRes.json(),
        aptRes.json(),
        notifRes.json(),
        ancRes.json()
      ]);

      if (srvData.success) setServices(srvData.services);
      if (bldData.success) setBuildings(bldData.buildings);
      if (qUserData.success) setMyQueues(qUserData.entries);
      if (qAllData.success) setAllActiveQueues(qAllData.entries);
      if (aptData.success) setMyAppointments(aptData.appointments);
      if (notifData.success) setNotifications(notifData.notifications);
      if (ancData.success) setAnnouncements(ancData.announcements);
    } catch (err) {
      console.error('Failed to refresh data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.id, resolveSession]);

  useEffect(() => {
    resolveSession();
  }, [resolveSession]);

  useEffect(() => {
    if (authStatus === 'authenticated') {
      setIsLoading(true);
      refreshData();
    }
  }, [authStatus, refreshData]);

  // Real-Time Server-Sent Events (SSE) Listener
  useEffect(() => {
    // Only stream while signed in; EventSource reconnects on its own if the
    // connection drops (which happens on serverless between invocations).
    if (authStatus !== 'authenticated' || !currentUser) return;

    const sse = new EventSource('/api/realtime', { withCredentials: true });

    sse.addEventListener('QUEUE_UPDATED', () => {
      refreshData();
    });

    sse.addEventListener('SERVICE_UPDATED', () => {
      refreshData();
    });

    sse.addEventListener('NOTIFICATION_NEW', (e) => {
      try {
        const notif: AppNotification = JSON.parse(e.data);
        if (notif.user_id === currentUser.id) {
          playChime();
        }
      } catch (err) {}
      refreshData();
    });

    sse.addEventListener('INCIDENT_RECORDED', () => {
      refreshData();
    });

    sse.addEventListener('INCIDENT_RESOLVED', () => {
      refreshData();
    });

    sse.addEventListener('APPOINTMENT_BOOKED', () => {
      refreshData();
    });

    sse.addEventListener('APPOINTMENT_CANCELLED', () => {
      refreshData();
    });

    sse.addEventListener('ANNOUNCEMENT_NEW', () => {
      refreshData();
    });

    sse.addEventListener('DATA_REFRESH', () => {
      refreshData();
    });

    return () => {
      sse.close();
    };
  }, [authStatus, currentUser, playChime, refreshData]);

  /**
   * Single request helper: attaches the session cookie and CSRF token,
   * surfaces real server errors, and treats a 401 as "your session lapsed"
   * rather than silently failing.
   */
  const request = useCallback(
    async (url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> => {
      const isMutation = Boolean(init.method && init.method.toUpperCase() !== 'GET');
      const headers: Record<string, string> = {
        ...((init.headers as Record<string, string>) ?? {}),
      };
      if (init.body) headers['Content-Type'] = 'application/json';
      if (isMutation && csrfTokenRef.current) headers['x-csrf-token'] = csrfTokenRef.current;

      const res = await fetch(url, { ...init, credentials: 'same-origin', headers });

      if (res.status === 401) {
        setAuthError('Your session expired. Please sign in again.');
        await resolveSession();
        return { ok: false, status: 401, data: { success: false, error: 'Your session expired. Please sign in again.' } };
      }
      const data = await res.json().catch(() => ({ success: false, error: 'Unexpected server response.' }));
      return { ok: res.ok && data.success !== false, status: res.status, data };
    },
    [resolveSession]
  );

  const joinQueue = async (serviceId: string, checkInType: 'remote' | 'qr' | 'kiosk' | 'walk_in') => {
    try {
      // Identity is taken from the session server-side; we never send it.
      // The idempotency key makes a retry safe: the server replays the first
      // outcome instead of creating a second ticket.
      const { ok, status, data } = await request('/api/queue/join', {
        method: 'POST',
        body: JSON.stringify({
          service_id: serviceId,
          check_in_type: checkInType,
          idempotency_key: `join-${serviceId}`
        })
      });
      if (ok) {
        playChime();
        await refreshData();
        return { success: true, entry: data.entry };
      }

      // A network failure must never look like a confirmed token.
      if (status === 0) {
        enqueuePendingAction({
          kind: 'join_queue',
          label: `Join virtual queue at service ${serviceId}`,
          endpoint: '/api/queue/join',
          method: 'POST',
          body: { service_id: serviceId, check_in_type: checkInType },
          idempotency_key: `join-${serviceId}`
        });
        return {
          success: false,
          error:
            "You're offline. Your queue request is queued but NOT confirmed — it will be sent when you reconnect."
        };
      }

      return { success: false, error: data.error || 'Could not join the queue.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error occurred.' };
    }
  };

  const callNextStudent = async (serviceId: string, counterNumber: number, counterId?: string) => {
    try {
      const { ok, data } = await request('/api/queue/call-next', {
        method: 'POST',
        body: JSON.stringify({ service_id: serviceId, counter_id: counterId, counter_number: counterNumber })
      });
      if (ok) {
        await refreshData();
        return { success: true, entry: data.entry };
      }
      return { success: false, error: data.error || 'Could not call the next student.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error occurred.' };
    }
  };

  const runQueueAction = async (queueId: string, action: 'start' | 'complete' | 'cancel' | 'check-in') => {
    try {
      const { ok, data } = await request(`/api/queue/${queueId}/${action}`, { method: 'POST' });
      if (ok) {
        await refreshData();
        return { success: true, data };
      }
      return { success: false, error: data.error || `Could not ${action} this ticket.` };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error occurred.' };
    }
  };

  const startService = async (queueId: string) => (await runQueueAction(queueId, 'start')).success;
  const completeService = async (queueId: string) => (await runQueueAction(queueId, 'complete')).success;
  const cancelQueue = async (queueId: string) => (await runQueueAction(queueId, 'cancel')).success;
  const checkInAtCounter = async (queueId: string) => (await runQueueAction(queueId, 'check-in')).success;

  const skipStudent = async (queueId: string, reason: 'skipped' | 'no_show') => {
    try {
      const { ok, data } = await request(`/api/queue/${queueId}/skip`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      if (ok) {
        await refreshData();
        return true;
      }
      console.warn('Skip failed:', data.error);
      return false;
    } catch {
      return false;
    }
  };

  const updateCapacity = async (serviceId: string, activeCounters: number, activeServers: number, reason?: string) => {
    try {
      const { ok, data } = await request(`/api/services/${serviceId}/capacity`, {
        method: 'POST',
        body: JSON.stringify({ active_counters: activeCounters, active_servers: activeServers, reason })
      });
      if (ok) {
        await refreshData();
        return true;
      }
      console.warn('Capacity update failed:', data.error);
      return false;
    } catch {
      return false;
    }
  };

  const recordIncident = async (serviceId: string, reason: DelayReason, notes: string) => {
    try {
      const { ok } = await request(`/api/services/${serviceId}/incidents`, {
        method: 'POST',
        body: JSON.stringify({ reason, notes })
      });
      if (ok) {
        await refreshData();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const resolveIncident = async (incidentId: string) => {
    try {
      const { ok } = await request(`/api/incidents/${incidentId}/resolve`, { method: 'POST' });
      if (ok) {
        await refreshData();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const bookAppointment = async (params: {
    service_id: string;
    date: string;
    slot_time: string;
    duration_mins: number;
    service_purpose: string;
  }) => {
    try {
      const { ok, data } = await request('/api/appointments/book', {
        method: 'POST',
        body: JSON.stringify(params)
      });
      if (ok) {
        playChime();
        await refreshData();
        return { success: true };
      }
      return { success: false, error: data.error || 'That slot could not be booked.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Booking conflict or network issue.' };
    }
  };

  const cancelAppointment = async (appointmentId: string) => {
    try {
      const { ok } = await request(`/api/appointments/${appointmentId}/cancel`, { method: 'POST' });
      if (ok) {
        await refreshData();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const markNotificationAsRead = async (id: string) => {
    try {
      await request(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    } catch {
      // Optimistic read state is reconciled on the next refresh.
    }
  };

  const markAllNotificationsAsRead = async () => {
    try {
      await request('/api/notifications/user/me/read-all', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      // Ignored; state resyncs on the next refresh.
    }
  };

  const resetDatabaseSeed = async () => {
    try {
      await request('/api/reset-seed', { method: 'POST' });
      await resolveSession();
    } catch {
      // Ignored; the UI surfaces a generic failure.
    }
  };

  const unreadNotifsCount = notifications.filter(n => !n.read).length;

  return (
    <AppContext.Provider
      value={{
        currentUser,
        authStatus,
        authError,
        signIn,
        signInWithGoogleToken,
        signOut,
        services,
        buildings,
        myQueues,
        allActiveQueues,
        myAppointments,
        notifications,
        announcements,
        unreadNotifsCount,
        selectedService,
        setSelectedService,
        activeTab,
        setActiveTab,
        isLoading,
        refreshData,
        joinQueue,
        callNextStudent,
        startService,
        completeService,
        skipStudent,
        cancelQueue,
        checkInAtCounter,
        updateCapacity,
        recordIncident,
        resolveIncident,
        bookAppointment,
        cancelAppointment,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        getCsrfToken,
        resetDatabaseSeed,
        playChime
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};



