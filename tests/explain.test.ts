import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNarrative, type NarrativeFacts } from '../server/intelligence/guard.js';
import { composeRuleExplanation, explainRecommendation, type ExplanationInput } from '../server/intelligence/explain.js';
import type { SmartAlternative } from '../src/types/traffic.js';

const FACTS: NarrativeFacts = {
  allowedServiceNames: ['Student Union Central Canteen', 'Engineering Pavilion Cafe & Deli'],
  knownServiceNames: [
    'Student Union Central Canteen',
    'Engineering Pavilion Cafe & Deli',
    'Library Circulation & Course Reserves',
    'Learning Commons Study Hub',
    'Student Records & Registrar (Main)'
  ],
  allowedNumbers: [31, 28, 8, 6, 450, 5, 12],
  allowedItemNames: ['Veg Thali']
};

test('accepts a narrative that only restates verified facts', () => {
  const result = validateNarrative(
    'Headline about the canteen\nBody sentence\n- Save about 12 minutes\n- 5 min walk',
    FACTS
  );
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test('rejects a narrative that invents a number', () => {
  const result = validateNarrative('Only 3 minutes wait at the cafe', FACTS);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.startsWith('unverified_number')));
});

test('rejects a narrative that mentions a service we did not offer', () => {
  const result = validateNarrative(
    'Try the Learning Commons Study Hub instead\nBody\n- Save about 12 minutes',
    FACTS
  );
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.startsWith('unverified_service')));
});

test('rejects overclaiming language even when every number checks out', () => {
  const result = validateNarrative('This is guaranteed wait free\nBody\n- Save about 12 minutes', FACTS);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.startsWith('overclaim')));
});

test('rejects an empty response', () => {
  assert.deepEqual(validateNarrative('   ', FACTS).violations, ['empty_response']);
});

const ALTERNATIVE: SmartAlternative = {
  service_id: 'srv-canteen-eng',
  service_name: 'Engineering Pavilion Cafe & Deli',
  code: 'CAN-ENG',
  category: 'canteen',
  building_id: 'bld-eng',
  building_name: 'Engineering Pavilion',
  floor: 'Ground Floor',
  room_counter: 'Express Counter 1',
  status: 'open',
  traffic_state: 'low',
  current_queue_length: 5,
  current_wait_mins: 8,
  active_counters: 2,
  total_counters: 2,
  capacity_headroom_pct: 90,
  distance_meters: 450,
  walk_mins: 6,
  predicted_wait_mins: 7,
  predicted_intensity: 35,
  open_now: true,
  opens_at: '07:30',
  closes_at: '18:30',
  same_service_branch: true,
  availability: {
    item_id: 'itm-x',
    item_name: 'Veg Thali',
    verified: true,
    available: true,
    checked_at: '2026-09-30T09:56:00',
    source_system: 'campusflow-catalogue',
    note: 'Confirmed 4 minutes ago'
  },
  gross_wait_saved_mins: 23,
  time_saved_mins: 25,
  usable: true,
  blocked_reason: null,
  blocked_text: null,
  reasons: [
    { code: 'verified_availability', text: 'Veg Thali available now' },
    { code: 'wait_saved', text: 'About 23 min less waiting (31m here vs 8m there)' }
  ]
};

const INPUT: ExplanationInput = {
  origin: { service_name: 'Student Union Central Canteen', wait_mins: 31, queue_length: 28, building_name: 'Student Union' },
  alternatives: [ALTERNATIVE],
  forecast: null,
  requestedItem: 'Veg Thali',
  allServiceNames: FACTS.knownServiceNames
};

test('the deterministic narrative never states a number it was not given', () => {
  const explanation = composeRuleExplanation(INPUT);
  const text = [explanation.headline, explanation.body, ...explanation.bullets].join(' ');
  const result = validateNarrative(text, {
    ...FACTS,
    allowedNumbers: [...FACTS.allowedNumbers, 25, 23, 7, 14, 39, 12, 6]
  });
  assert.deepEqual(result.violations, []);
  assert.equal(explanation.source, 'verified_rules');
  assert.ok(explanation.disclaimer.length > 0);
});

test('falls back to the deterministic narrative when the provider fails', async () => {
  const explanation = await explainRecommendation(INPUT, {
    generate: async () => {
      throw new Error('provider unavailable');
    }
  });
  assert.equal(explanation.source, 'verified_rules');
  assert.ok(explanation.headline.includes('Engineering Pavilion Cafe & Deli'));
});

test('falls back when the provider invents a number', async () => {
  const explanation = await explainRecommendation(INPUT, {
    generate: async () => 'Walk is only 2 minutes away\nHead to the cafe now\n- Save about 25 minutes'
  });
  assert.equal(explanation.source, 'verified_rules');
  assert.ok(explanation.guard_violations?.some(v => v.startsWith('unverified_number')));
});

test('keeps a guarded AI narrative that stays within the facts', async () => {
  const explanation = await explainRecommendation(INPUT, {
    generate: async () =>
      'Engineering Pavilion Cafe & Deli has the shorter wait\nHead there now and you will walk past the busiest stretch\n- Veg Thali available now\n- About 6 min walk'
  });
  assert.equal(explanation.source, 'ai_guarded');
  assert.equal(explanation.bullets.length, 2);
  assert.ok(explanation.guard_violations === undefined);
});

test('explains honestly when there is no verified alternative', async () => {
  const input: ExplanationInput = { ...INPUT, alternatives: [] };
  const explanation = await explainRecommendation(input, { generate: async () => null });
  assert.equal(explanation.source, 'verified_rules');
  assert.ok(explanation.headline.includes('only verified option'));
});
