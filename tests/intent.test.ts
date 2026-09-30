import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseQuery, resolveIntent, tokenize, tokenOverlap } from '../server/intelligence/intent.js';
import { buildServiceItems } from '../server/intelligence/catalog.js';
import type { ServiceItem } from '../src/types/traffic.js';
import type { Service } from '../src/types/index.js';

const NOW = new Date('2026-09-30T10:00:00');

function makeService(overrides: Partial<Service> & { id: string; name: string }): Service {
  return {
    code: overrides.id.toUpperCase(),
    category: 'canteen',
    building_id: 'bld-stu',
    building_name: 'Student Union',
    floor: 'Ground Floor',
    room_counter: 'Counter 1',
    status: 'open',
    operating_hours: { open: '08:00', close: '20:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
    current_queue_length: 4,
    active_counters: 2,
    total_counters: 2,
    active_servers: 2,
    avg_service_duration_mins: 4,
    estimated_wait_mins: 8,
    current_demand_level: 'low',
    demand_ratio: 0.5,
    virtual_queue_enabled: true,
    allow_remote_join: true,
    appointments_enabled: false,
    max_queue_capacity: 40,
    description: '',
    required_documents: [],
    important_instructions: [],
    alternate_service_ids: [],
    ...overrides
  } as Service;
}

const SERVICES: Service[] = [
  makeService({ id: 'srv-canteen-main', name: 'Student Union Central Canteen', current_queue_length: 28, estimated_wait_mins: 31, current_demand_level: 'critical' }),
  makeService({ id: 'srv-canteen-eng', name: 'Engineering Pavilion Cafe & Deli' }),
  makeService({ id: 'srv-lib-desk', name: 'Library Circulation & Course Reserves', category: 'library' }),
  makeService({ id: 'srv-lib-commons', name: 'Learning Commons Study Hub', category: 'library' }),
  makeService({ id: 'srv-reg-main', name: 'Student Records & Registrar (Main)', category: 'admin_office' })
];

const ITEMS: ServiceItem[] = SERVICES.flatMap(service => buildServiceItems(service.id, service.name, NOW));

function resolve(query: string) {
  return resolveIntent({ query, services: SERVICES, items: ITEMS, now: NOW });
}

test('normalises a free-text request', () => {
  assert.equal(normaliseQuery('  Renew Library Book!  '), 'renew library book');
  assert.deepEqual(tokenize('I need a veg thali'), ['need', 'veg', 'thali'].filter(t => t !== 'need'));
});

test('resolves a food item to the verified locations that stock it', () => {
  const result = resolve('veg thali');

  assert.equal(result.verified, true);
  assert.equal(result.resolved_item?.name, 'Veg Thali');
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map(m => m.service_id).sort(), ['srv-canteen-eng', 'srv-canteen-main']);
  assert.ok(result.matches.every(m => m.item?.available === true));
});

test('reports real availability instead of assuming it', () => {
  const result = resolve('masala dosa');
  const central = result.matches.find(m => m.service_id === 'srv-canteen-main');
  const cafe = result.matches.find(m => m.service_id === 'srv-canteen-eng');

  assert.equal(central?.item?.available, false);
  assert.equal(central?.item?.quantity_available, 0);
  assert.equal(cafe?.item?.available, true);
});

test('resolves a study space request to the library branch that has rooms', () => {
  const result = resolve('study room');

  assert.equal(result.verified, true);
  assert.equal(result.matches.length, 2);
  const central = result.matches.find(m => m.service_id === 'srv-lib-desk');
  const commons = result.matches.find(m => m.service_id === 'srv-lib-commons');
  assert.equal(central?.item?.available, false);
  assert.equal(commons?.item?.available, true);
});

test('resolves an administrative task across branches', () => {
  const result = resolve('id card');
  assert.equal(result.verified, true);
  assert.ok(result.matches.every(m => m.match_basis.startsWith('item')));
  assert.ok(result.matches.some(m => m.service_id === 'srv-reg-main'));
  assert.ok(result.matches.every(m => typeof m.current_wait_mins === 'number'));
});

test('resolves a print request from stored records', () => {
  const result = resolve('print document');
  assert.equal(result.verified, true);
  assert.ok(result.matches.every(m => m.item?.name === 'Print And Scan'));
});

test('does not fabricate a match for an unknown request', () => {
  const result = resolve('quantum tunnelling lab booking');

  assert.equal(result.verified, false);
  assert.equal(result.matches.length, 0);
  assert.equal(result.message, "We couldn't verify availability for this request.");
  assert.ok(result.suggestions.length > 0);
});

test('asks for clarification when the request has no content', () => {
  const result = resolve('   ');
  assert.equal(result.verified, false);
  assert.equal(result.resolved_item, null);
});

test('does not match on a partial token overlap', () => {
  assert.ok(tokenOverlap(['veg', 'thali'], 'Veg Thali') === 1);
  assert.ok(tokenOverlap(['veg', 'curry'], 'Veg Thali') < 0.6);
});

test('matches a service by name when no catalogue item matches', () => {
  const result = resolve('learning commons');
  assert.equal(result.verified, true);
  assert.equal(result.resolved_item, null);
  assert.ok(result.matches.some(m => m.service_id === 'srv-lib-commons'));
});
