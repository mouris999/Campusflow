import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  AlternativesResult,
  DemandHeatmapModel,
  IntentResolution,
  PeakForecast,
  PeakIntelligenceAnalytics,
  PlanYourVisit,
  ServiceItem,
  SmartAlternative,
  TrafficAlert,
  UserTrafficPreference
} from '../types/traffic.js';
import type { Service } from '../types/index.js';
import { currentCsrfToken } from '../lib/api.js';

export interface CampusTrafficService {
  service_id: string;
  service_name: string;
  building_name: string;
  category: Service['category'];
  status: Service['status'];
  traffic_state: string;
  current_wait_mins: number;
  current_queue_length: number;
  predicted_peak: PeakForecast['predicted_peak'];
  better_window: PeakForecast['better_window'];
  confidence: PeakForecast['confidence'];
  confidence_pct: number;
  sufficient_data: boolean;
  insufficient_reason: string | null;
}

export interface CampusTrafficOverview {
  model_version: string;
  min_net_saved_mins: number;
  services: CampusTrafficService[];
}

export interface TrafficContextType {
  overview: CampusTrafficOverview | null;
  trafficByService: Record<string, CampusTrafficService>;
  forecasts: Record<string, PeakForecast>;
  plans: Record<string, PlanYourVisit>;
  alerts: TrafficAlert[];
  preference: UserTrafficPreference | null;
  isLoading: boolean;
  error: string | null;
  refreshTraffic: () => Promise<void>;
  loadForecast: (serviceId: string, force?: boolean) => Promise<PeakForecast | null>;
  loadPlan: (serviceId: string, itemId?: string | null) => Promise<PlanYourVisit | null>;
  loadAlternatives: (serviceId: string, itemId?: string | null) => Promise<AlternativesResult | null>;
  loadHeatmap: (serviceId: string) => Promise<DemandHeatmapModel | null>;
  loadItems: (serviceId?: string) => Promise<ServiceItem[]>;
  setItemAvailability: (itemId: string, available: boolean, quantity?: number) => Promise<ServiceItem | null>;
  resolveRequest: (query: string) => Promise<IntentResolution | null>;
  trackEvent: (originServiceId: string, recommendedServiceId: string, eventType: string, itemId?: string | null) => Promise<void>;
  sendFeedback: (originServiceId: string, recommendedServiceId: string, useful: boolean) => Promise<void>;
  loadAnalytics: () => Promise<PeakIntelligenceAnalytics | null>;
  dismissAlert: (key: string) => Promise<void>;
  savePreference: (patch: Partial<Omit<UserTrafficPreference, 'user_id'>>) => Promise<void>;
}

const TrafficContext = createContext<TrafficContextType | undefined>(undefined);

async function readJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    // Always send the session cookie so personalised traffic endpoints work,
    // and echo the CSRF token on writes so the server accepts them.
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    if (method !== 'GET' && method !== 'HEAD') {
      const token = await currentCsrfToken();
      if (token) headers.set('x-csrf-token', token);
    }
    const res = await fetch(url, { ...init, credentials: 'same-origin', headers });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.success === false ? null : (body as T);
  } catch (err) {
    console.error('[traffic] request failed:', err);
    return null;
  }
}

export const TrafficProvider: React.FC<{
  /** null until a session exists, so per-user traffic calls are skipped. */
  userId: string | null;
  children: React.ReactNode;
}> = ({ userId, children }) => {
  const [overview, setOverview] = useState<CampusTrafficOverview | null>(null);
  const [forecasts, setForecasts] = useState<Record<string, PeakForecast>>({});
  const [plans, setPlans] = useState<Record<string, PlanYourVisit>>({});
  const [alerts, setAlerts] = useState<TrafficAlert[]>([]);
  const [preference, setPreference] = useState<UserTrafficPreference | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const trafficByService = useMemo(() => {
    const map: Record<string, CampusTrafficService> = {};
    for (const entry of overview?.services ?? []) map[entry.service_id] = entry;
    return map;
  }, [overview]);

  const refreshTraffic = useCallback(async () => {
    if (!userId) {
      // Only the campus-wide snapshot is public.
      const publicData = await readJson<CampusTrafficOverview>('/api/intelligence/overview');
      if (publicData) setOverview(publicData);
      setAlerts([]);
      setIsLoading(false);
      return;
    }
    try {
      setError(null);
      const [overviewData, alertData, preferenceData] = await Promise.all([
        readJson<CampusTrafficOverview>('/api/intelligence/overview'),
        readJson<{ alerts: TrafficAlert[] }>(`/api/intelligence/alerts?user_id=${encodeURIComponent(userId)}`),
        readJson<{ preference: UserTrafficPreference | null }>(`/api/intelligence/preferences/${encodeURIComponent(userId)}`)
      ]);
      if (overviewData) setOverview(overviewData);
      if (alertData) setAlerts(alertData.alerts ?? []);
      if (preferenceData) setPreference(preferenceData.preference);
    } catch (err) {
      setError('Smart traffic data is unavailable right now.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setIsLoading(true);
    refreshTraffic();
    const timer = setInterval(refreshTraffic, 120000);
    return () => clearInterval(timer);
  }, [refreshTraffic]);

  const loadForecast = useCallback(async (serviceId: string, force = false) => {
    const data = await readJson<{ forecast: PeakForecast }>(
      `/api/intelligence/services/${encodeURIComponent(serviceId)}/peak${force ? '?force=true' : ''}`
    );
    if (!data?.forecast) return null;
    setForecasts(current => ({ ...current, [serviceId]: data.forecast }));
    return data.forecast;
  }, []);

  const loadPlan = useCallback(async (serviceId: string, itemId?: string | null) => {
    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);
    if (itemId) params.set('item_id', itemId);
    const data = await readJson<{ plan: PlanYourVisit }>(
      `/api/intelligence/services/${encodeURIComponent(serviceId)}/plan?${params.toString()}`
    );
    if (!data?.plan) return null;
    setPlans(current => ({ ...current, [serviceId]: data.plan }));
    return data.plan;
  }, [userId]);

  const loadAlternatives = useCallback(async (serviceId: string, itemId?: string | null) => {
    const params = new URLSearchParams({ limit: '3' });
    if (userId) params.set('user_id', userId);
    if (itemId) params.set('item_id', itemId);
    return readJson<AlternativesResult>(
      `/api/intelligence/services/${encodeURIComponent(serviceId)}/alternatives?${params.toString()}`
    );
  }, [userId]);

  const loadHeatmap = useCallback(async (serviceId: string) => {
    const data = await readJson<{ heatmap: DemandHeatmapModel }>(
      `/api/intelligence/services/${encodeURIComponent(serviceId)}/heatmap`
    );
    return data?.heatmap ?? null;
  }, []);

  const loadItems = useCallback(async (serviceId?: string) => {
    const params = serviceId ? `?service_id=${encodeURIComponent(serviceId)}` : '';
    const data = await readJson<{ items: ServiceItem[] }>(`/api/intelligence/items${params}`);
    return data?.items ?? [];
  }, []);

  const setItemAvailability = useCallback(async (itemId: string, available: boolean, quantity?: number) => {
    const data = await readJson<{ item: ServiceItem }>(`/api/intelligence/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available, quantity_available: quantity ?? (available ? 1 : 0) })
    });
    if (!data?.item) return null;
    await refreshTraffic();
    return data.item;
  }, [refreshTraffic]);

  const resolveRequest = useCallback(async (query: string) => {
    const data = await readJson<{ resolution: IntentResolution }>(
      `/api/intelligence/resolve?q=${encodeURIComponent(query)}`
    );
    return data?.resolution ?? null;
  }, []);

  const trackEvent = useCallback(async (
    originServiceId: string,
    recommendedServiceId: string,
    eventType: string,
    itemId?: string | null
  ) => {
    await readJson('/api/intelligence/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        origin_service_id: originServiceId,
        recommended_service_id: recommendedServiceId,
        event_type: eventType,
        item_id: itemId ?? null
      })
    });
  }, [userId]);

  const sendFeedback = useCallback(async (originServiceId: string, recommendedServiceId: string, useful: boolean) => {
    await readJson('/api/intelligence/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        origin_service_id: originServiceId,
        recommended_service_id: recommendedServiceId,
        useful
      })
    });
  }, [userId]);

  const loadAnalytics = useCallback(async () => {
    const data = await readJson<{ analytics: PeakIntelligenceAnalytics }>('/api/intelligence/admin/peak-analytics');
    return data?.analytics ?? null;
  }, []);

  const dismissAlert = useCallback(async (key: string) => {
    const data = await readJson<{ key: string }>('/api/intelligence/alerts/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, key })
    });
    if (data) setAlerts(current => current.filter(alert => alert.key !== key));
  }, [userId]);

  const savePreference = useCallback(async (patch: Partial<Omit<UserTrafficPreference, 'user_id'>>) => {
    const data = await readJson<{ preference: UserTrafficPreference }>('/api/intelligence/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...patch })
    });
    if (data?.preference) setPreference(data.preference);
  }, [userId]);

  const value: TrafficContextType = {
    overview,
    trafficByService,
    forecasts,
    plans,
    alerts,
    preference,
    isLoading,
    error,
    refreshTraffic,
    loadForecast,
    loadPlan,
    loadAlternatives,
    loadHeatmap,
    loadItems,
    setItemAvailability,
    resolveRequest,
    trackEvent,
    sendFeedback,
    loadAnalytics,
    dismissAlert,
    savePreference
  };

  return <TrafficContext.Provider value={value}>{children}</TrafficContext.Provider>;
};

export function useTraffic(): TrafficContextType {
  const ctx = useContext(TrafficContext);
  if (!ctx) throw new Error('useTraffic must be used inside a TrafficProvider');
  return ctx;
}
