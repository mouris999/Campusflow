import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const path = 'src/components/Campus3D.tsx';
const src = readFileSync(join(process.cwd(), path), 'utf-8');

/** Strips block and line comments so a mention in prose is not read as code. */
function code(srcText: string): string {
  return srcText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Returns the body of a top-level function, up to the first column-0 brace. */
function functionBody(srcText: string, name: string): string {
  const at = srcText.indexOf('function ' + name);
  if (at < 0) return '';
  const end = srcText.indexOf('\n}\n', at);
  return srcText.slice(at, end < 0 ? undefined : end + 3);
}

test('alternatives are ranked by time saved, not by raw wait', () => {
  // Regression guard. The 3D panel previously sorted with
  //   a.wait - selected.wait - (b.wait - selected.wait)
  // which reduces to a.wait - b.wait, so it ranked by raw wait and could offer a
  // slower service above a much faster one. The ranking must be by saving.
  const body = functionBody(src, 'bestAlternatives');
  assert.ok(body.length > 0, 'the ranking helper must exist');
  assert.match(
    body,
    /\.sort\(\(a, b\) => b\.saved - a\.saved\)/,
    'alternatives must be sorted by descending time saved'
  );
  assert.match(
    body,
    /saved >= -1/,
    'a candidate slower than the original must never be offered as an improvement'
  );
  assert.match(body, /\.filter\(m => m\.isOpen\)/, 'a closed service must not be offered');
});

test('the 3D panel does not read a global that nothing sets', () => {
  // Regression guard. Mapping a picked real building to its services read
  // window.__cfCampusLinks, which no code ever assigned, so every real building
  // reported "no CampusFlow service linked" even after an admin had confirmed one.
  const body = code(src);
  assert.ok(
    !/__cfCampusLinks/.test(body),
    'the 3D panel must take links from props, not an unassigned global'
  );
  const helper = functionBody(src, 'linkedServicesFor');
  assert.ok(helper.length > 0, 'links must be resolved by a real helper');
  assert.match(helper, /links: CampusLink\[\]/, 'the helper must take links as an argument');
});

test('a peak label is never invented when history is insufficient', () => {
  const body = functionBody(src, 'peakWindowLabel');
  assert.ok(body.length > 0, 'the peak helper must exist');
  assert.match(
    body,
    /sufficient_data/,
    'the label must respect the engine own insufficient-data verdict'
  );
  assert.match(
    body,
    /Not enough history yet/,
    'insufficient history must be stated, not replaced with a time'
  );
  assert.match(body, /return undefined/, 'an absent forecast must yield no label at all');
});

test('the virtual token destination reads the real queue, not a placeholder', () => {
  // The 3D view must show where the student is actually headed, from their own
  // live ticket, and must draw nothing when they hold no token.
  const body = code(src);
  assert.match(body, /\/api\/queue\/user\/me/, 'the token must come from the real queue');
  assert.match(body, /myToken\.ticketNumber/, 'the token number must be shown');
  assert.match(
    body,
    /does not track your location/,
    'the origin picker must explain why there is no automatic route'
  );
  assert.ok(
    /\{myToken && \(/.test(src),
    'the token banner must be conditional, so no token means no marker'
  );
});

test('the seat count is read from the real endpoint, not a guessed one', () => {
  // Regression guard. The 3D panel asked for
  //   /api/services/<building_id>/seating?service_id=<id>
  // and read `body.total`. The route is keyed by service id and the counts live
  // under `seating`, so the request 404'd and no seat figure ever appeared on the
  // campus, while the library genuinely had seats free.
  const body = code(src);
  assert.match(
    body,
    /\/api\/services\/\$\{encodeURIComponent\(id\)\}\/seating/,
    'the seating route must be keyed by service id'
  );
  assert.ok(
    !/seating\?service_id=/.test(body),
    'the seating route takes the service id in the path, not a query parameter'
  );
  assert.match(
    body,
    /seating\?\.available_seats/,
    'the available count lives under seating.available_seats'
  );
  assert.ok(
    !/typeof body\.total !== 'number'/.test(body),
    'body.total is not the available-seat count'
  );
});

test('performance is measured from scene cost, not a throttled frame counter', () => {
  // A frame-rate reading is useless in an automated check: browsers throttle
  // requestAnimationFrame in a background tab, so the measurement reported 0 fps
  // for a scene that was running correctly. Draw calls and triangles are stable
  // facts, so those are what the app publishes and what the tests assert.
  const scene = readFileSync(join(process.cwd(), 'src/three/CampusScene.ts'), 'utf-8');
  assert.match(scene, /dataset\.drawCalls/, 'draw calls must be published');
  assert.match(scene, /dataset\.triangles/, 'triangle count must be published');
  assert.match(scene, /renderer\.info/, 'the figures must come from the renderer');
});