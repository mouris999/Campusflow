/**
 * AI explanation layer.
 *
 * The database is the source of truth. This module receives only verified
 * campus facts, asks the model to phrase them for a student, then re-checks the
 * answer against those same facts. If the provider is unavailable — or the
 * answer fails the guard — the deterministic narrative is returned instead, so
 * the product never depends on the model being up.
 */

import type { SmartAlternative, PeakForecast } from '../../src/types/traffic.js';
import { validateNarrative, type NarrativeFacts } from './guard.js';

export interface ExplanationInput {
  origin: { service_name: string; wait_mins: number; queue_length: number; building_name: string };
  alternatives: SmartAlternative[];
  forecast: PeakForecast | null;
  requestedItem: string | null;
  allServiceNames: string[];
}

export interface Explanation {
  headline: string;
  body: string;
  bullets: string[];
  source: 'verified_rules' | 'ai_guarded';
  guard_violations?: string[];
  disclaimer: string;
}

const DISCLAIMER =
  'Live wait times are estimates from the queue model. Predictions come from recorded demand and can change.';

function minutes(n: number): string {
  return `${n} min`;
}

/**
 * Deterministic narrative. This is the guaranteed path — it is always
 * available and can never invent a fact.
 */
export function composeRuleExplanation(input: ExplanationInput): Explanation {
  const top = input.alternatives[0];
  const { origin } = input;
  const itemWord = input.requestedItem ? `${input.requestedItem} ` : '';

  if (!top) {
    const peak = input.forecast?.predicted_peak;
    return {
      headline: `${origin.service_name} is the only verified option for this right now.`,
      body: peak
        ? `No other campus location is verified as offering ${itemWord || 'this service'} with a shorter wait. Recorded demand shows a likely peak at ${peak.label} today.`
        : `No other campus location is verified as offering ${itemWord || 'this service'} with a shorter wait right now.`,
      bullets: [
        `Current wait here: ${minutes(origin.wait_mins)} (${origin.queue_length} in queue)`,
        'Alternatives are only listed when the catalogue verifies the same offer',
        'Check again later — queues move throughout the day'
      ],
      source: 'verified_rules',
      disclaimer: DISCLAIMER
    };
  }

  const bullets = top.reasons.map(reason => reason.text);
  if (top.predicted_wait_mins !== null) {
    bullets.push(`Predicted wait for this hour: ~${top.predicted_wait_mins} min`);
  }

  const peak = input.forecast?.predicted_peak;
  const body = peak
    ? `${top.service_name} is the better nearby option right now. Expect it to stay busy around ${peak.label} here, so moving now also avoids the peak.`
    : `${top.service_name} is the better nearby option right now.`;

  return {
    headline: top.availability.verified && top.availability.available
      ? `${itemWord || 'This service'} is available at ${top.service_name} — save about ${top.time_saved_mins} minutes.`
      : `${top.service_name} has a shorter wait — save about ${top.time_saved_mins} minutes.`,
    body,
    bullets,
    source: 'verified_rules',
    disclaimer: DISCLAIMER
  };
}

function buildGuardFacts(input: ExplanationInput, explanation: Explanation): NarrativeFacts {
  const numbers = new Set<number>();
  numbers.add(input.origin.wait_mins);
  numbers.add(input.origin.queue_length);
  numbers.add(input.alternatives[0]?.time_saved_mins ?? 0);
  numbers.add(input.alternatives[0]?.current_wait_mins ?? 0);
  numbers.add(input.alternatives[0]?.current_queue_length ?? 0);
  numbers.add(input.alternatives[0]?.distance_meters ?? 0);
  numbers.add(input.alternatives[0]?.walk_mins ?? 0);
  if (input.alternatives[0]?.predicted_wait_mins !== null && input.alternatives[0]?.predicted_wait_mins !== undefined) {
    numbers.add(input.alternatives[0].predicted_wait_mins as number);
  }
  for (const alt of input.alternatives) {
    numbers.add(alt.time_saved_mins);
    numbers.add(alt.current_wait_mins);
    numbers.add(alt.current_queue_length);
    numbers.add(alt.distance_meters);
    numbers.add(alt.walk_mins);
  }
  if (input.forecast) {
    numbers.add(input.forecast.confidence_pct);
    if (input.forecast.predicted_peak) {
      numbers.add(input.forecast.predicted_peak.expected_queue);
      numbers.add(input.forecast.predicted_peak.expected_wait_min);
      numbers.add(input.forecast.predicted_peak.expected_wait_max);
    }
  }

  return {
    allowedServiceNames: [input.origin.service_name, ...input.alternatives.map(a => a.service_name)],
    knownServiceNames: input.allServiceNames,
    allowedNumbers: Array.from(numbers).filter(n => Number.isFinite(n)),
    allowedItemNames: input.requestedItem ? [input.requestedItem] : []
  };
}

function buildPrompt(input: ExplanationInput): string {
  const facts = {
    current_location: {
      service: input.origin.service_name,
      building: input.origin.building_name,
      estimated_wait_minutes: input.origin.wait_mins,
      people_waiting: input.origin.queue_length
    },
    requested_item: input.requestedItem,
    verified_nearby_options: input.alternatives.slice(0, 3).map(alt => ({
      service: alt.service_name,
      building: alt.building_name,
      estimated_wait_minutes: alt.current_wait_mins,
      people_waiting: alt.current_queue_length,
      distance_meters: alt.distance_meters,
      walking_minutes: alt.walk_mins,
      item_available: alt.availability.available,
      availability_verified: alt.availability.verified,
      minutes_saved: alt.time_saved_mins,
      verified_reasons: alt.reasons.map(r => r.text)
    })),
    predicted_peak: input.forecast?.sufficient_data
      ? {
          window: input.forecast.predicted_peak?.label ?? null,
          confidence_percent: input.forecast.confidence_pct,
          expected_queue: input.forecast.predicted_peak?.expected_queue ?? null
        }
      : null
  };

  return [
    'You are the CampusFlow Smart Traffic assistant.',
    'You may ONLY restate the structured facts below. Never invent a service, a number, a queue, a wait time or an availability status.',
    'Write 1 headline sentence, then 1 short sentence, then 2-3 bullet points using "-" for each bullet.',
    'Use only numbers that appear in the facts. Do not add hours or times of day.',
    'If the facts show no verified option, say so plainly.',
    '',
    'VERIFIED FACTS:',
    JSON.stringify(facts, null, 2)
  ].join('\n');
}

const VALID_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'];

export interface ExplainOptions {
  /** Injected for tests; defaults to the real Gemini client factory. */
  generate?: (prompt: string) => Promise<string | null>;
  model?: string;
  timeoutMs?: number;
}

export async function explainRecommendation(
  input: ExplanationInput,
  options: ExplainOptions = {}
): Promise<Explanation> {
  const fallback = composeRuleExplanation(input);

  let generated: string | null = null;
  try {
    if (options.generate) {
      generated = await options.generate(buildPrompt(input));
    } else {
      generated = await callGemini(buildPrompt(input), options.model, options.timeoutMs ?? 8000);
    }
  } catch {
    generated = null;
  }

  if (!generated) {
    return fallback;
  }

  const guardFacts = buildGuardFacts(input, fallback);
  const result = validateNarrative(generated, guardFacts);
  if (!result.ok) {
    return { ...fallback, guard_violations: result.violations };
  }

  const parsed = parseNarrative(generated);
  if (!parsed) {
    return { ...fallback, guard_violations: ['unparseable_response'] };
  }

  return {
    headline: parsed.headline,
    body: parsed.body,
    bullets: parsed.bullets.length ? parsed.bullets : fallback.bullets,
    source: 'ai_guarded',
    disclaimer: DISCLAIMER
  };
}

function parseNarrative(text: string): { headline: string; body: string; bullets: string[] } | null {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length === 0) return null;

  const headline = lines[0].replace(/^[-*\d.)\s]+/, '').trim();
  if (!headline) return null;

  const bullets: string[] = [];
  let body = '';
  for (const line of lines.slice(1)) {
    if (/^[-*•]/.test(line)) {
      bullets.push(line.replace(/^[-*•]\s*/, '').trim());
    } else if (!body) {
      body = line;
    }
  }
  if (bullets.length === 0 && !body) return null;
  return { headline, body, bullets };
}

async function callGemini(prompt: string, model?: string, timeoutMs = 8000): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });

  const chosen = model && VALID_MODELS.includes(model) ? model : 'gemini-3.1-flash-lite';

  const response = await Promise.race([
    ai.models.generateContent({
      model: chosen,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.2, systemInstruction: 'You only restate verified campus facts. You never invent data.' }
    }),
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))
  ]);

  if (!response) return null;
  const text = (response as { text?: string }).text;
  return text && text.trim().length > 0 ? text.trim() : null;
}
