/**
 * Ground plane textured with real satellite imagery.
 *
 * Tiles come from Esri World Imagery, which needs no API key but does require
 * visible attribution (see SATELLITE_ATTRIBUTION). Tiles are fetched once,
 * composited on a canvas, and reused; failures degrade to a neutral ground
 * surface with a clear note, never to a blank or misleading scene.
 */

import * as THREE from 'three';
import { CAMPUS_GEOMETRY, campusTileRange, metresPerPixel } from '../lib/campusGeo.js';

const TILE_SIZE = 256;
/**
 * Requested imagery zoom, before the budget is applied.
 *
 * The effective zoom steps down until the tile count fits the budget, so this is
 * an upper bound rather than a promise. z=18 would need 210 tiles and a 52 MB
 * compositing canvas for this campus, which fails on a low-memory phone.
 */
const REQUESTED_ZOOM = 18;
/** Hard ceiling on tile requests, to keep the ground fast on mobile data. */
const MAX_TILES = 64;
const TILE_URL = (x: number, y: number, z: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

export interface GroundResult {
  mesh: THREE.Mesh;
  texture: THREE.Texture | null;
  /** True when real imagery is displayed. False when the fallback is shown. */
  satelliteLoaded: boolean;
  tilesRequested: number;
  tilesLoaded: number;
  resolution_m_per_px: number;
  dispose: () => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile failed'));
    img.src = url;
  });
}

/**
 * Builds the campus ground.
 *
 * The plane is sized in real metres so the 3D scene and the route distances are
 * on the same scale, and the imagery is aligned to true north.
 */
export function createGround(): GroundResult {
  const size = CAMPUS_GEOMETRY.radius_m * 2;
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);

  const fallbackMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b3026,
    roughness: 1,
    metalness: 0
  });
  const mesh = new THREE.Mesh(geometry, fallbackMaterial);
  mesh.name = 'campus-ground';
  mesh.receiveShadow = false;
  mesh.userData.layer = 'terrain';

  const range = campusTileRange(REQUESTED_ZOOM, MAX_TILES);
  const ZOOM = range.z;
  const cols = range.maxX - range.minX + 1;
  const rows = range.maxY - range.minY + 1;

  let texture: THREE.Texture | null = null;
  let loaded = 0;

  const state: GroundResult = {
    mesh,
    texture: null,
    satelliteLoaded: false,
    tilesRequested: cols * rows,
    tilesLoaded: 0,
    resolution_m_per_px: metresPerPixel(ZOOM),
    dispose: () => {
      geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      if (state.texture) state.texture.dispose();
    }
  };

  // Compose the tiles onto one canvas so the ground is a single texture.
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE_SIZE;
  canvas.height = rows * TILE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return state;

  // Neutral base so a partial load never shows as missing terrain.
  ctx.fillStyle = '#2b3026';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const jobs: Promise<void>[] = [];
  for (let ty = range.minY; ty <= range.maxY; ty++) {
    for (let tx = range.minX; tx <= range.maxX; tx++) {
      const px = (tx - range.minX) * TILE_SIZE;
      const py = (ty - range.minY) * TILE_SIZE;
      jobs.push(
        loadImage(TILE_URL(tx, ty, ZOOM))
          .then(img => {
            ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
            loaded += 1;
          })
          .catch(() => {
            /* one missing tile must not break the ground */
          })
      );
    }
  }

  void Promise.all(jobs).then(() => {
    const allLoaded = loaded === cols * rows;
    if (loaded === 0) return; // keep the neutral fallback

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;

    // The canvas is north-up; the plane is centred and spans [-r, r] in x and z.
    // Canvas +y is south, so no flip is needed on the plane itself, but the
    // texture origin is top-left while UVs run bottom-up.
    tex.flipY = true;

    mesh.material = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.95,
      metalness: 0
    });

    state.texture = tex;
    state.satelliteLoaded = allLoaded;
    state.tilesLoaded = loaded;
  });

  return state;
}
