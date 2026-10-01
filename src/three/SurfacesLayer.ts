/**
 * Ground-surface layers drawn from real OpenStreetMap geometry:
 * roads and paths, sports pitches, green space, water, parking and trees.
 *
 * Everything is drawn as a flat ribbon at a small height offset so it sits on
 * the satellite ground without z-fighting, and it deepens as the camera moves
 * closer - at full-campus zoom a 1 px line is invisible, and drawing 178 roads
 * as wide ribbons at that distance turns the map into mud.
 */

import * as THREE from 'three';
import { CAMPUS_GEOMETRY, type CampusArea } from '../lib/campusGeo.js';

/** Height offsets, in metres, chosen to avoid coplanar z-fighting. */
const OFFSET = {
  road: 0.35,
  footway: 0.5,
  path: 0.5,
  sports: 0.3,
  green: 0.22,
  water: 0.18,
  parking: 0.28,
  wood: 0.24
};

function ribbon(
  line: [number, number][],
  width: number,
  colour: number
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i];
    // Direction to the next point, used to offset the two edges.
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Normal is perpendicular to travel.
    const nx = -dy * width * 0.5;
    const ny = dx * width * 0.5;
    positions.push(x + nx, 0, y + ny, x - nx, 0, y - ny);
  }

  for (let i = 0; i < line.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(geo, mat);
}

function polygonMesh(
  ring: [number, number][],
  y: number,
  colour: number,
  opacity: number
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  return mesh;
}

/** Road width in metres, from the OSM highway class. */
function roadWidth(highway: string): number {
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
    case 'trunk':
      return 22;
    case 'primary':
      return 16;
    case 'secondary':
      return 13;
    case 'tertiary':
      return 10;
    case 'residential':
    case 'unclassified':
      return 8;
    case 'service':
      return 5;
    case 'footway':
    case 'path':
    case 'pedestrian':
    case 'steps':
    case 'track':
    case 'living_street':
      return 3.2;
    default:
      return 5;
  }
}

function roadColour(highway: string): number {
  if (['footway', 'path', 'pedestrian', 'steps', 'track'].includes(highway)) {
    return 0xe8e4d9;
  }
  if (['motorway', 'motorway_link', 'trunk', 'primary'].includes(highway)) return 0x8a8f96;
  if (['secondary', 'tertiary'].includes(highway)) return 0x9aa0a6;
  return 0x767b82;
}

export interface SurfaceLayer {
  group: THREE.Group;
  /** Deepens detail as the camera closes in; called every frame. */
  update: (cameraHeight: number) => void;
  dispose: () => void;
}

export function createSurfaces(): SurfaceLayer {
  const group = new THREE.Group();
  group.name = 'campus-surfaces';
  group.userData.layer = 'surfaces';

  // --- roads and paths
  const roadGroup = new THREE.Group();
  for (const road of CAMPUS_GEOMETRY.roads) {
    if (road.line.length < 2) continue;
    const isPath = ['footway', 'path', 'pedestrian', 'steps'].includes(road.highway);
    const mesh = ribbon(road.line, roadWidth(road.highway), roadColour(road.highway));
    mesh.position.y = isPath ? OFFSET.footway : OFFSET.road;
    mesh.userData = {
      layer: 'road',
      id: road.id,
      name: road.name,
      highway: road.highway,
      width: roadWidth(road.highway)
    };
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.62;
    roadGroup.add(mesh);
  }
  group.add(roadGroup);

  // --- sports pitches
  const sportsGroup = new THREE.Group();
  for (const pitch of CAMPUS_GEOMETRY.sports) {
    const mesh = polygonMesh(pitch.footprint, OFFSET.sports, 0x2f7d4f, 0.75);
    mesh.userData = { layer: 'sports', id: pitch.id, name: pitch.name, sport: pitch.sport };
    sportsGroup.add(mesh);
  }
  group.add(sportsGroup);

  // --- green space, water, parking, wood
  const areaGroup = new THREE.Group();
  const addAreas = (areas: CampusArea[], y: number, colour: number, opacity: number, layer: string) => {
    for (const area of areas) {
      const mesh = polygonMesh(area.footprint, y, colour, opacity);
      mesh.userData = { layer, id: area.id, name: area.name };
      areaGroup.add(mesh);
    }
  };
  addAreas(CAMPUS_GEOMETRY.green, OFFSET.green, 0x3f7a3a, 0.6, 'green');
  addAreas(CAMPUS_GEOMETRY.wood, OFFSET.wood, 0x2f5c2a, 0.7, 'wood');
  addAreas(CAMPUS_GEOMETRY.water, OFFSET.water, 0x2b5f8a, 0.7, 'water');
  addAreas(CAMPUS_GEOMETRY.parking, OFFSET.parking, 0x6b6f76, 0.6, 'parking');
  group.add(areaGroup);

  // --- trees, as a single instanced mesh so a dense campus stays cheap
  let trees: THREE.InstancedMesh | null = null;
  if (CAMPUS_GEOMETRY.trees.length > 0) {
    const treeGeo = new THREE.ConeGeometry(3.2, 9, 6);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x3d6b34, roughness: 0.95 });
    trees = new THREE.InstancedMesh(treeGeo, treeMat, CAMPUS_GEOMETRY.trees.length);
    const m = new THREE.Matrix4();
    CAMPUS_GEOMETRY.trees.forEach((t, i) => {
      m.makeTranslation(t.x, 4.5, t.y);
      trees!.setMatrixAt(i, m);
    });
    trees.instanceMatrix.needsUpdate = true;
    trees.userData = { layer: 'trees' };
    group.add(trees);
  }

  // Detail LOD: hide the thin stuff and the trees when zoomed all the way out,
  // and stop drawing residential buildings far from the campus core.
  const NEAR = 340;
  const FAR = 1100;

  function update(cameraHeight: number) {
    const near = cameraHeight < NEAR;
    const mid = cameraHeight < FAR;

    roadGroup.children.forEach(mesh => {
      const isThin = (mesh.userData.width ?? 9) <= 3.5;
      mesh.visible = mid || !isThin;
    });
    if (trees) trees.visible = near;
    sportsGroup.visible = true;
    areaGroup.visible = mid;
  }

  function dispose() {
    group.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else mat?.dispose();
      }
    });
  }

  return { group, update, dispose };
}
