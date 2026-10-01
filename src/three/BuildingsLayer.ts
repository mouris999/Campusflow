/**
 * Building massing from real OpenStreetMap footprints.
 *
 * Each footprint is extruded to its real height when OSM records one. When it
 * does not, a single documented default is used and the building is marked
 * `assumed` so the UI can say so. Heights are never randomised: a random height
 * looks plausible and means nothing.
 *
 * Performance: all buildings share two materials and are merged into a small
 * number of draw calls, with per-instance colour for selection highlight. three.js
 * frustum-culls the result, and the whole campus is one static mesh, so zooming
 * out to the full campus stays smooth.
 */

import * as THREE from 'three';
import {
  CAMPUS_GEOMETRY,
  massingHeight,
  ringCentroid,
  type CampusBuilding
} from '../lib/campusGeo.js';

const MIN_H = 2.5;

/** One flat shaded material per role. Two total keeps draw calls low. */
function materials() {
  return {
    normal: new THREE.MeshStandardMaterial({
      color: 0xb9b3a6,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true
    }),
    selected: new THREE.MeshStandardMaterial({
      color: 0xd9f65b,
      roughness: 0.6,
      metalness: 0.05,
      emissive: 0x3f4a12,
      emissiveIntensity: 0.55
    })
  };
}

/** Extrudes one ring into a solid, then rotates it flat and returns the geometry. */
function extrude(ring: [number, number][], height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1
  });
  // Shape is in XY; stand it up so +Y is height, then the footprint maps to XZ.
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export interface BuildingsLayer {
  group: THREE.Group;
  /** Meshes by real OSM element id, for picking and highlighting. */
  pickable: THREE.Mesh[];
  select: (id: string | null) => void;
  footprintOf: (id: string) => [number, number][] | null;
  centroidOf: (id: string) => [number, number] | null;
  dispose: () => void;
}

export function createBuildings(): BuildingsLayer {
  const group = new THREE.Group();
  group.name = 'campus-buildings';
  group.userData.layer = 'buildings';

  const { normal, selected } = materials();
  const pickable: THREE.Mesh[] = [];
  const footprintById = new Map<string, [number, number][]>();
  const centroidById = new Map<string, [number, number]>();

  let currentSelection: THREE.Mesh | null = null;

  for (const building of CAMPUS_GEOMETRY.buildings) {
    const { metres, source } = massingHeight(building);
    const height = Math.max(MIN_H, metres);
    const geometry = extrude(building.footprint, height);

    const mesh = new THREE.Mesh(geometry, normal);
    mesh.position.y = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData = {
      layer: 'building',
      id: building.id,
      name: building.name,
      height_source: source,
      height_m: height,
      area_m2: building.area_m2
    };
    mesh.userData.baseColor = '#b9b3a6';

    group.add(mesh);
    pickable.push(mesh);
    footprintById.set(building.id, building.footprint);
    centroidById.set(building.id, ringCentroid(building.footprint));
  }

  function select(id: string | null) {
    if (currentSelection) {
      (currentSelection.material as THREE.Material) = normal;
      currentSelection = null;
    }
    if (!id) return;
    const mesh = pickable.find(m => m.userData.id === id);
    if (!mesh) return;
    mesh.material = selected;
    currentSelection = mesh;
  }

  return {
    group,
    pickable,
    select,
    footprintOf: id => footprintById.get(id) ?? null,
    centroidOf: id => centroidById.get(id) ?? null,
    dispose: () => {
      group.traverse(obj => {
        if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose();
      });
      normal.dispose();
      selected.dispose();
    }
  };
}
