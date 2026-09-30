/**
 * Smart Traffic Intelligence HTTP API.
 *
 * Mounted under /api/intelligence. Every response is derived from stored
 * CampusFlow records; endpoints that would need data the database does not have
 * say so instead of guessing.
 */

import { Router } from 'express';
import { db } from './db.js';
import { trafficIntelligence } from './intelligence/index.js';
import { PEAK_MODEL_VERSION } from './intelligence/prediction.js';
import { MIN_NET_SAVED_MINS } from './intelligence/alternatives.js';
import { effectiveTrafficState } from '../src/lib/trafficState.js';
import { requireRole } from './auth.js';
import { trafficStore } from './intelligence/store.js';
import { computeTrafficTrend } from './intelligence/trend.js';

export const intelligenceRouter = Router();

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function int(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// ------------------------------------------------------------------ services

/** Campus-wide traffic snapshot used by the Smart Traffic tab. */
intelligenceRouter.get('/overview', (req, res) => {
  const services = db.getServices().map(service => {
    const forecast = trafficIntelligence.getForecast(service.id);
    return {
      service_id: service.id,
      service_name: service.name,
      building_name: service.building_name,
      category: service.category,
      status: service.status,
      traffic_state: effectiveTrafficState(service),
      current_wait_mins: service.estimated_wait_mins,
      current_queue_length: service.current_queue_length,
      predicted_peak: forecast?.predicted_peak ?? null,
      better_window: forecast?.better_window ?? null,
      confidence: forecast?.confidence ?? 'low',
      confidence_pct: forecast?.confidence_pct ?? 0,
      sufficient_data: forecast?.sufficient_data ?? false,
      insufficient_reason: forecast?.insufficient_reason ?? null
    };
  });

  res.json({
    success: true,
    model_version: PEAK_MODEL_VERSION,
    min_net_saved_mins: MIN_NET_SAVED_MINS,
    services
  });
});

/** Peak forecast for one service. */
intelligenceRouter.get('/services/:id/peak', (req, res) => {
  const forecast = trafficIntelligence.getForecast(req.params.id, {
    force: req.query.force === 'true'
  });
  if (!forecast) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.json({ success: true, forecast });
});

/** Verified smart alternatives for a service, optionally for a specific item. */
intelligenceRouter.get('/services/:id/alternatives', async (req, res) => {
  const itemId = str(req.query.item_id);
  if (itemId && !trafficIntelligence.getItem(itemId)) {
    return res.status(404).json({ success: false, error: 'Catalogue item not found.' });
  }

  try {
    const result = await trafficIntelligence.getAlternatives({
      serviceId: req.params.id,
      itemId,
      userId: str(req.query.user_id),
      limit: int(req.query.limit) ?? 3,
      explain: req.query.explain !== 'false'
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Service not found.' });
    }
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[traffic] alternatives failed:', error);
    res.status(500).json({ success: false, error: 'Unable to compute alternatives right now.' });
  }
});

/** Now / next peak / suggested window / alternative in one call. */
intelligenceRouter.get('/services/:id/plan', async (req, res) => {
  try {
    const plan = await trafficIntelligence.getPlan({
      serviceId: req.params.id,
      userId: str(req.query.user_id),
      itemId: str(req.query.item_id)
    });
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Service not found.' });
    }
    res.json({ success: true, plan });
  } catch (error: any) {
    console.error('[traffic] plan failed:', error);
    res.status(500).json({ success: false, error: 'Unable to build a visit plan right now.' });
  }
});

/** Day x hour recorded demand for one service (admin heatmap). */
intelligenceRouter.get('/services/:id/heatmap', (req, res) => {
  const service = db.getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.json({ success: true, heatmap: trafficIntelligence.getServiceHeatmap(service.id) });
});

/**
 * Live traffic trend, from recorded demand samples. Returns "unknown" with a
 * stated reason when there is not enough recent history.
 */
intelligenceRouter.get('/services/:id/trend', (req, res) => {
  const service = db.getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }

  const windowMins = int(req.query.window_mins) ?? 30;
  const trend = computeTrafficTrend(
    service,
    trafficStore.getMeasurements(service.id),
    new Date(),
    windowMins
  );
  res.json({ success: true, trend });
});

// ------------------------------------------------------------------ catalogue

intelligenceRouter.get('/items', (req, res) => {
  const serviceId = str(req.query.service_id);
  res.json({ success: true, items: trafficIntelligence.getItems(serviceId ?? undefined) });
});

/** Staff availability update. This is the write path behind the item toggles. */
intelligenceRouter.patch('/items/:id', requireRole('staff', 'admin'), (req, res) => {
  const { available, quantity_available, actor, note } = req.body ?? {};
  if (typeof available !== 'boolean') {
    return res.status(400).json({ success: false, error: 'available (boolean) is required.' });
  }
  const quantity = int(quantity_available);
  const item = trafficIntelligence.setItemAvailability({
    item_id: req.params.id,
    available,
    quantity_available: quantity ?? (available ? 1 : 0),
    actor: str(actor) ?? 'Staff',
    ...(typeof note === 'string' ? { note } : {})
  });
  if (!item) {
    return res.status(404).json({ success: false, error: 'Catalogue item not found.' });
  }
  res.json({ success: true, item });
});

// -------------------------------------------------------------------- intent

intelligenceRouter.get('/resolve', (req, res) => {
  const query = str(req.query.q);
  if (!query) {
    return res.status(400).json({ success: false, error: 'q (query) is required.' });
  }
  res.json({ success: true, resolution: trafficIntelligence.resolveIntent(query) });
});

// -------------------------------------------------------------------- events

const EVENT_TYPES = new Set([
  'shown',
  'clicked',
  'alternative_opened',
  'selected',
  'arrived',
  'returned_to_origin',
  'dismissed'
]);

intelligenceRouter.post('/events', (req, res) => {
  const { user_id, origin_service_id, recommended_service_id, event_type, item_id } = req.body ?? {};
  if (!user_id || !origin_service_id || !recommended_service_id || !event_type) {
    return res.status(400).json({ success: false, error: 'user_id, origin_service_id, recommended_service_id and event_type are required.' });
  }
  if (!EVENT_TYPES.has(String(event_type))) {
    return res.status(400).json({ success: false, error: `event_type must be one of: ${Array.from(EVENT_TYPES).join(', ')}.` });
  }
  const event = trafficIntelligence.trackEvent({
    user_id,
    origin_service_id,
    recommended_service_id,
    event_type,
    item_id: str(item_id)
  });
  if (!event) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.status(201).json({ success: true, event });
});

intelligenceRouter.post('/feedback', (req, res) => {
  const { user_id, origin_service_id, recommended_service_id, useful } = req.body ?? {};
  if (!user_id || !origin_service_id || !recommended_service_id || typeof useful !== 'boolean') {
    return res.status(400).json({ success: false, error: 'user_id, origin_service_id, recommended_service_id and useful (boolean) are required.' });
  }
  const outcome = trafficIntelligence.submitFeedback({
    user_id,
    origin_service_id,
    recommended_service_id,
    useful
  });
  if (!outcome) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.status(201).json({ success: true, outcome });
});

// -------------------------------------------------------------------- alerts

intelligenceRouter.get('/alerts', (req, res) => {
  const userId = str(req.query.user_id);
  if (!userId) {
    return res.status(400).json({ success: false, error: 'user_id is required.' });
  }
  res.json({ success: true, alerts: trafficIntelligence.getAlerts(userId) });
});

intelligenceRouter.post('/alerts/dismiss', (req, res) => {
  const { user_id, key } = req.body ?? {};
  if (!user_id || !key) {
    return res.status(400).json({ success: false, error: 'user_id and key are required.' });
  }
  const dismissed = trafficIntelligence.dismissAlert({ user_id, key });
  if (!dismissed) {
    return res.status(404).json({ success: false, error: 'Alert not found.' });
  }
  res.json({ success: true, key });
});

// --------------------------------------------------------------- preferences

intelligenceRouter.get('/preferences/:userId', (req, res) => {
  const preference = trafficIntelligence.getPreference(req.params.userId);
  res.json({ success: true, preference });
});

intelligenceRouter.post('/preferences', (req, res) => {
  const { user_id, max_distance_meters, preferred_hour, avoid_peak } = req.body ?? {};
  if (!user_id) {
    return res.status(400).json({ success: false, error: 'user_id is required.' });
  }
  const preference = trafficIntelligence.setPreference({
    user_id,
    max_distance_meters: int(max_distance_meters),
    preferred_hour: int(preferred_hour) ?? null,
    avoid_peak: typeof avoid_peak === 'boolean' ? avoid_peak : undefined
  });
  res.json({ success: true, preference });
});

// ---------------------------------------------------------------- admin view
// These expose campus-wide operational records, so they are staff/admin only.

intelligenceRouter.get('/admin/peak-analytics', requireRole('staff', 'admin'), (req, res) => {
  res.json({ success: true, analytics: trafficIntelligence.getAdminAnalytics() });
});

intelligenceRouter.post('/admin/rebuild', requireRole('admin'), (req, res) => {
  const run = trafficIntelligence.rebuildAll('manual');
  res.json({ success: true, run });
});

intelligenceRouter.get('/admin/runs', requireRole('admin'), (req, res) => {
  res.json({ success: true, runs: trafficIntelligence.getRuns(int(req.query.limit) ?? 10) });
});
