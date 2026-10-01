import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createBuildings } from '../src/three/BuildingsLayer.js';
import { createSurfaces } from '../src/three/SurfacesLayer.js';
import { CAMPUS_GEOMETRY } from '../src/lib/campusGeo.js';

/**
 * Scene cost, measured from the real geometry builders.
 *
 * A frame-rate reading is not available here: browsers throttle
 * requestAnimationFrame in a background tab, so an automated check reports 0 fps
 * for a scene that is running perfectly. Draw calls and triangle counts are
 * stable properties of the data and the builders, and they are what decides
 * whether a phone can hold a frame rate, so those are what gets asserted.
 */

/** Triangles in a non-indexed or indexed buffer geometry. */
function triangles(geo: THREE.BufferGeometry): number {
  if (!geo) return 0;
  const index = geo.getIndex();
  if (index) return index.count / 3;
  const pos = geo.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

interface Cost {
  drawCalls: number;
  triangles: number;
}

function measure(group: THREE.Object3D): Cost {
  let drawCalls = 0;
  let tri = 0;
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    drawCalls += 1;
    if (mesh.isInstancedMesh) {
      tri += triangles(mesh.geometry) * (mesh.count ?? 1);
    } else {
      tri += triangles(mesh.geometry);
    }
  });
  return { drawCalls, triangles: tri };
}

test('the building layer draws every real footprint', () => {
  const layer = createBuildings();
  const cost = measure(layer.group);
  assert.equal(
    cost.drawCalls,
    CAMPUS_GEOMETRY.buildings.length,
    'every real building footprint must be represented'
  );
  assert.ok(cost.triangles > 0, 'the extruded footprints must actually produce geometry');
  layer.dispose();
});

test('building massing stays within a budget a phone can hold', () => {
  // Each footprint is a separate mesh so it can be picked and highlighted, which
  // is the cost of interactive selection. The budget below is what keeps that
  // affordable; if a future capture is much larger, this fails rather than
  // quietly shipping a scene that stutters.
  const layer = createBuildings();
  const cost = measure(layer.group);
  layer.dispose();

  assert.ok(
    cost.drawCalls <= 600,
    `${cost.drawCalls} draw calls for buildings is too many; merge or instance them`
  );
  assert.ok(
    cost.triangles <= 400_000,
    `${cost.triangles} triangles for buildings is too many for a mid-range phone`
  );
});

test('the surface layer is budgeted and detailed only when close', () => {
  const layer = createSurfaces();
  const cost = measure(layer.group);
  layer.dispose();

  assert.ok(cost.drawCalls > 0, 'roads and land use must be drawn');
  assert.ok(
    cost.drawCalls <= 400,
    `${cost.drawCalls} surface draw calls is too many`
  );
  assert.ok(
    cost.triangles <= 300_000,
    `${cost.triangles} surface triangles is too many for a mid-range phone`
  );
});

test('a full-campus view hides detail that cannot be seen', () => {
  // Level of detail is what makes zooming out to the whole campus legible. With
  // the camera high up, thin footpaths and trees must be switched off, because
  // a 1 px line across 1.8 km is invisible and hundreds of them turn the map to mud.
  const layer = createSurfaces();
  layer.update(4000); // far above the campus
  const roadMeshes: THREE.Mesh[] = [];
  layer.group.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.userData?.layer === 'road') roadMeshes.push(m);
  });
  assert.ok(roadMeshes.length > 0, 'there must be roads to toggle');

  const visibleFar = roadMeshes.filter(m => m.visible).length;
  layer.update(80); // close in
  const visibleNear = roadMeshes.filter(m => m.visible).length;

  assert.ok(
    visibleNear >= visibleFar,
    'zooming in must not hide more than zooming out'
  );
  assert.ok(
    visibleFar < roadMeshes.length,
    'the widest view must hide the thin footpaths and paths'
  );
  layer.dispose();
});

test('the campus is captured at a size that can be drawn at all', () => {
  // Guards the geometry source rather than the renderer: a capture several times
  // larger would need a different strategy entirely, and should fail here rather
  // than become a slow page in production.
  assert.ok(CAMPUS_GEOMETRY.buildings.length <= 2000, 'building count is beyond what this renderer is built for');
  assert.ok(CAMPUS_GEOMETRY.roads.length <= 2000, 'road count is beyond what this renderer is built for');
  assert.ok(
    CAMPUS_GEOMETRY.radius_m <= 2000,
    'a larger capture radius needs a tile budget revisit'
  );
});
