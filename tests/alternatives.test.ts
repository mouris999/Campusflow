import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_NET_SAVED_MINS,
  rankAlternatives,
  type AlternativeServiceFacts,
  type CandidateFacts
} from '../server/intelligence/alternatives.js';

const NOW = new Date('2026-09-30T10:00:00');

function service(overrides: Partial<AlternativeServiceFacts>): AlternativeServiceFacts {
  return {
    id: 'srv-a',
    name: 'Central Canteen',
    code: 'CAN-CENTRAL',
    category: 'canteen',
    status: 'open',
    building_id: 'bld-1',
    building_name: 'Student Union',
    floor: 'Ground Floor',
    room_counter: 'Lines 1-3',
    current_queue_length: 28,
    estimated_wait_mins: 31,
    current_demand_level: 'high',
    active_counters: 3,
    total_counters: 3,
    max_queue_capacity: 80,
    operating_hours: { open: '08:00', close: '20:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
    alternate_service_ids: ['srv-b'],
    ...overrides
  };
}

type CandidateOptions = { service?: Partial<AlternativeServiceFacts> } & Omit<Partial<CandidateFacts>, 'service'>;

function candidate(options: CandidateOptions): CandidateFacts {
  const { service: serviceOverrides, ...facts } = options;
  return {
    distance_meters: 250,
    walk_mins: 3,
    item: null,
    predicted_wait_mins: null,
    predicted_intensity: null,
    is_open_now: true,
    ...facts,
    service: service(serviceOverrides ?? {})
  };
}

const origin = service({});

test('selects the alternative with the lower wait', () => {
  const result = rankAlternatives({
    origin,
    candidates: [
      candidate({ service: { id: 'srv-b', name: 'North Canteen', estimated_wait_mins: 7, current_queue_length: 6 } }),
      candidate({ service: { id: 'srv-c', name: 'Student Cafe', estimated_wait_mins: 4, current_queue_length: 3, alternate_service_ids: [] }, distance_meters: 420, walk_mins: 5 })
    ],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended.length, 2);
  assert.equal(result.recommended[0].service_name, 'North Canteen');
  assert.ok(result.recommended[0].time_saved_mins > 0);
});

test('excludes an alternative where the requested item is unavailable', () => {
  const result = rankAlternatives({
    origin,
    candidates: [
      candidate({
        service: { id: 'srv-b', name: 'North Canteen', estimated_wait_mins: 7 },
        item: { id: 'itm-b-veg-thali', name: 'Veg Thali', available: false, quantity_available: 0, unit_label: 'portions', source_system: 'canteen-pos', updated_at: NOW.toISOString() }
      })
    ],
    requestedItem: { id: 'itm-a-veg-thali', name: 'Veg Thali', available_at_origin: true },
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
  assert.equal(result.not_usable.length, 1);
  assert.equal(result.not_usable[0].blocked_reason, 'item_unavailable');
});

test('excludes an alternative that does not offer the requested item at all', () => {
  const result = rankAlternatives({
    origin,
    candidates: [candidate({ service: { id: 'srv-b', name: 'North Canteen', estimated_wait_mins: 3 }, item: null })],
    requestedItem: { id: 'itm-a-veg-thali', name: 'Veg Thali', available_at_origin: true },
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
  assert.equal(result.not_usable[0].blocked_reason, 'item_not_offered');
  assert.equal(result.not_usable[0].availability.verified, false);
});

test('excludes a closed service', () => {
  const result = rankAlternatives({
    origin,
    candidates: [candidate({ service: { id: 'srv-b', name: 'Closed Canteen', status: 'closed', estimated_wait_mins: 1 } })],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
  assert.equal(result.not_usable[0].blocked_reason, 'closed_now');
});

test('excludes a service that is not open right now', () => {
  const result = rankAlternatives({
    origin,
    candidates: [
      candidate({
        service: { id: 'srv-b', name: 'After Hours Canteen', estimated_wait_mins: 1, operating_hours: { open: '18:00', close: '22:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] } },
        is_open_now: false
      })
    ],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
  assert.equal(result.not_usable[0].blocked_reason, 'outside_operating_hours');
});

test('penalises a much farther alternative with a slightly better wait', () => {
  // A large origin wait so both options clear the net-saving floor; the far one
  // must still lose to the nearby branch.
  const busyOrigin = service({ estimated_wait_mins: 120, current_queue_length: 60, current_demand_level: 'critical' });
  const result = rankAlternatives({
    origin: busyOrigin,
    candidates: [
      candidate({ service: { id: 'srv-b', name: 'Near Canteen', estimated_wait_mins: 40 } }),
      candidate({
        service: { id: 'srv-c', name: 'Far Canteen', estimated_wait_mins: 30, alternate_service_ids: [] },
        distance_meters: 3000,
        walk_mins: 38
      })
    ],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended[0].service_name, 'Near Canteen');
  const far = result.recommended.concat(result.not_usable).find(a => a.service_name === 'Far Canteen');
  assert.ok(far);
  assert.equal(far?.usable, false);
  assert.equal(far?.blocked_reason, 'too_far');
  assert.equal(far?.time_saved_mins, 120 - 30 - 38);
});

test('recommends a branch of the same service', () => {
  const result = rankAlternatives({
    origin,
    candidates: [
      candidate({
        service: { id: 'srv-b', name: 'North Annex Registrar', category: 'admin_office', estimated_wait_mins: 5, alternate_service_ids: ['srv-a'] },
        item: { id: 'itm-b-transcript', name: 'Academic Transcript', available: true, quantity_available: 8, unit_label: 'slots', source_system: 'registrar-records', updated_at: NOW.toISOString() }
      })
    ],
    requestedItem: { id: 'itm-a-transcript', name: 'Academic Transcript', available_at_origin: true },
    now: NOW
  });

  assert.equal(result.recommended.length, 1);
  assert.equal(result.recommended[0].same_service_branch, true);
  assert.ok(result.recommended[0].reasons.some(r => r.code === 'verified_availability'));
  assert.ok(result.recommended[0].reasons.some(r => r.code === 'wait_saved'));
});

test('never invents a queue or wait it was not given', () => {
  const result = rankAlternatives({
    origin,
    candidates: [candidate({ service: { id: 'srv-b', name: 'North Canteen', estimated_wait_mins: 7, current_queue_length: 6 } })],
    requestedItem: null,
    now: NOW
  });

  const best = result.recommended[0];
  assert.equal(best.current_wait_mins, 7);
  assert.equal(best.current_queue_length, 6);
  assert.equal(best.predicted_wait_mins, null);
  assert.equal(best.predicted_intensity, null);
  assert.equal(best.gross_wait_saved_mins, origin.estimated_wait_mins - 7);
  assert.equal(best.time_saved_mins, origin.estimated_wait_mins - 7 - best.walk_mins);
});

test('does not recommend an alternative with no wait advantage', () => {
  const result = rankAlternatives({
    origin,
    candidates: [candidate({ service: { id: 'srv-b', name: 'Equally Busy', estimated_wait_mins: 31 } })],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
  assert.equal(result.not_usable[0].blocked_reason, 'no_wait_advantage');
});

test('excludes a service whose virtual queue is full', () => {
  const result = rankAlternatives({
    origin,
    candidates: [candidate({ service: { id: 'srv-b', name: 'Full Canteen', estimated_wait_mins: 2, current_queue_length: 40, max_queue_capacity: 40 } })],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
  assert.equal(result.not_usable[0].blocked_reason, 'at_capacity');
});

test('ignores services that cannot satisfy the request at all', () => {
  const result = rankAlternatives({
    origin,
    candidates: [
      candidate({
        service: { id: 'srv-z', name: 'Chemistry Lab', category: 'laboratory', estimated_wait_mins: 1, alternate_service_ids: [] }
      })
    ],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
  assert.equal(result.not_usable.length, 0);
});

test('net saving threshold is respected', () => {
  const result = rankAlternatives({
    origin,
    candidates: [candidate({ service: { id: 'srv-b', name: 'Marginal', estimated_wait_mins: 31 - (MIN_NET_SAVED_MINS - 1) }, walk_mins: 1 })],
    requestedItem: null,
    now: NOW
  });

  assert.equal(result.recommended.length, 0);
});
