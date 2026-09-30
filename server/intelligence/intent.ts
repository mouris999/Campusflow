/**
 * "What do you need?" intent resolution.
 *
 * Deterministic matching against stored records only. A request is resolved to a
 * real catalogue item or a real service record, with the basis of the match
 * reported. If nothing verifiable matches, the resolver says so instead of
 * guessing — no semantic invention.
 */

import type { Service, ServiceCategory, Building } from '../../src/types/index.js';
import type { IntentMatch, IntentResolution, ServiceItem } from '../../src/types/traffic.js';
import { effectiveTrafficState } from '../../src/lib/trafficState.js';

export const MIN_TOKEN_MATCH_RATIO = 0.6;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'i', 'me', 'my', 'want', 'need', 'to', 'get', 'find', 'book', 'please',
  'near', 'nearby', 'somewhere', 'where', 'can', 'do', 'for', 'of', 'in', 'on', 'any', 'some'
]);

export function normaliseQuery(query: string): string {
  return String(query ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(query: string): string[] {
  return normaliseQuery(query)
    .split(' ')
    .filter(token => token.length > 0 && !STOP_WORDS.has(token));
}

/** Crude singularisation so "books" matches "book". */
function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function tokenOverlap(queryTokens: string[], target: string): number {
  const targetTokens = new Set(tokenize(target).map(stem));
  if (targetTokens.size === 0 || queryTokens.length === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(stem(token))) hits += 1;
  }
  return hits / queryTokens.length;
}

function itemMatchBasis(item: ServiceItem, query: string, queryTokens: string[]): { basis: IntentMatch['match_basis']; score: number } | null {
  const name = normaliseQuery(item.name);
  if (name && (name === query || name.split(' ').some(part => query === part))) {
    return { basis: 'item_exact', score: 1 };
  }
  for (const synonym of item.synonyms) {
    const normalised = normaliseQuery(synonym);
    if (normalised && (normalised === query || query.includes(normalised) || normalised.includes(query))) {
      return { basis: 'item_synonym', score: 0.9 };
    }
  }
  const overlap = tokenOverlap(queryTokens, item.name);
  if (overlap >= MIN_TOKEN_MATCH_RATIO) {
    return { basis: 'item_token', score: overlap * 0.8 };
  }
  return null;
}

function serviceMatchBasis(service: Service, query: string, queryTokens: string[]) {
  const name = normaliseQuery(service.name);
  if (name.includes(query) || query.includes(name)) {
    return { basis: 'service_name' as const, score: 0.85 };
  }
  const overlap = Math.max(
    tokenOverlap(queryTokens, service.name),
    tokenOverlap(queryTokens, service.description)
  );
  if (overlap >= MIN_TOKEN_MATCH_RATIO) {
    return { basis: 'service_description' as const, score: overlap * 0.7 };
  }
  return null;
}

export interface ResolveIntentInput {
  query: string;
  services: Service[];
  items: ServiceItem[];
  now: Date;
  limit?: number;
}

export function resolveIntent(input: ResolveIntentInput): IntentResolution {
  const query = normaliseQuery(input.query);
  const queryTokens = tokenize(input.query);

  if (queryTokens.length === 0) {
    return {
      query: input.query,
      normalized_query: '',
      verified: false,
      message: 'Tell us what you need — for example "veg thali", "study room" or "renew library book".',
      resolved_item: null,
      matches: [],
      suggestions: buildSuggestions(input.services),
      resolved_at: input.now.toISOString()
    };
  }

  // 1. Catalogue items win, because they are the most specific verified record.
  const itemHits: { item: ServiceItem; basis: IntentMatch['match_basis']; score: number }[] = [];
  for (const item of input.items) {
    const match = itemMatchBasis(item, query, queryTokens);
    if (match) itemHits.push({ item, basis: match.basis, score: match.score });
  }
  itemHits.sort((a, b) => b.score - a.score || a.item.service_id.localeCompare(b.item.service_id));

  const matches: IntentMatch[] = [];
  const seenServices = new Set<string>();
  let resolvedItem: IntentResolution['resolved_item'] = null;

  if (itemHits.length > 0) {
    resolvedItem = { id: itemHits[0].item.id, name: itemHits[0].item.name, kind: itemHits[0].item.kind };
    for (const hit of itemHits) {
      const service = input.services.find(s => s.id === hit.item.service_id);
      if (!service || seenServices.has(service.id)) continue;
      seenServices.add(service.id);
      matches.push(buildMatch(service, hit.item, hit.basis, hit.score));
    }
  }

  // 2. Fall back to service-level matches.
  if (matches.length === 0) {
    interface ServiceHit {
      service: Service;
      basis: IntentMatch['match_basis'];
      score: number;
    }
    const serviceHits: ServiceHit[] = [];
    for (const service of input.services) {
      const match = serviceMatchBasis(service, query, queryTokens);
      if (match) serviceHits.push({ service, basis: match.basis, score: match.score });
    }
    serviceHits.sort((a, b) => b.score - a.score);
    for (const hit of serviceHits) {
      matches.push(buildMatch(hit.service, null, hit.basis, hit.score));
    }
  }

  const limit = input.limit ?? 6;
  const verified = matches.length > 0;

  return {
    query: input.query,
    normalized_query: query,
    verified,
    message: verified
      ? matches[0].item
        ? `${matches[0].item.name} is tracked at ${matches.length} campus ${matches.length === 1 ? 'location' : 'locations'}.`
        : `Matched ${matches.length} campus ${matches.length === 1 ? 'service' : 'services'}.`
      : "We couldn't verify availability for this request.",
    resolved_item: resolvedItem,
    matches: matches.slice(0, limit),
    suggestions: verified ? buildSuggestions(input.services) : buildSuggestions(input.services),
    resolved_at: input.now.toISOString()
  };
}

function buildMatch(service: Service, item: ServiceItem | null, basis: IntentMatch['match_basis'], score: number): IntentMatch {
  return {
    service_id: service.id,
    service_name: service.name,
    building_name: service.building_name,
    category: service.category,
    status: service.status,
    current_wait_mins: service.estimated_wait_mins,
    traffic_state: effectiveTrafficState(service),
    item: item
      ? {
          id: item.id,
          name: item.name,
          available: item.available,
          quantity_available: item.quantity_available,
          unit_label: item.unit_label
        }
      : null,
    match_basis: basis,
    match_score: Number(score.toFixed(2))
  };
}

export function buildSuggestions(services: Service[]): string[] {
  const categories = new Set<ServiceCategory>(services.map(s => s.category));
  const pool: string[] = ['veg thali', 'study room', 'transcript', 'id card', 'print document'];
  if (categories.has('library')) pool.push('renew library book', 'quiet study');
  if (categories.has('canteen')) pool.push('masala dosa', 'coffee');
  if (categories.has('admin_office')) pool.push('payment plan', 'hold release');
  if (categories.has('laboratory')) pool.push('lab goggles', '3d print');
  if (categories.has('helpdesk')) pool.push('wifi setup', 'mfa reset');
  return pool.slice(0, 6);
}

export function buildingsUsedBy(services: Service[], buildings: Building[]): Building[] {
  const ids = new Set(services.map(s => s.building_id));
  return buildings.filter(b => ids.has(b.id));
}
