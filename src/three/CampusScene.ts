/**
 * The 3D campus scene: wires every layer to one renderer, one camera, one
 * input model, and one dispose path.
 *
 * Layer order is terrain, then surfaces (roads, greens, sports), then buildings,
 * then the CampusFlow overlays, so the data always reads on top of the geometry.
 */

import * as THREE from 'three';
import { CAMPUS_GEOMETRY, geometryProvenance } from '../lib/campusGeo.js';
import { createGround, type GroundResult } from './SatelliteGround.js';
import { createBuildings, type BuildingsLayer } from './BuildingsLayer.js';
import { createSurfaces, type SurfaceLayer } from './SurfacesLayer.js';
import { createTrafficLayer, type TrafficLayer, type ServiceMarker } from './TrafficLayer.js';
import { createNavigationLayer, type NavigationLayer } from './NavigationLayer.js';
import { CameraController } from './CameraController.js';
import type { CampusBuilding } from '../lib/campusGeo.js';

export interface SceneCallbacks {
  onBuildingPicked?: (building: CampusBuilding | null) => void;
  onServicePicked?: (serviceId: string) => void;
  onCameraChange?: (state: { distance: number; height: number }) => void;
  onGroundStatus?: (status: {
    satelliteLoaded: boolean;
    tilesLoaded: number;
    tilesRequested: number;
    resolution_m_per_px: number;
  }) => void;
}

export interface CampusSceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  camera3d: CameraController;
  setMarkers: (markers: ServiceMarker[]) => void;
  selectService: (id: string | null) => void;
  selectBuilding: (id: string | null) => void;
  focusOn: (position: [number, number], distance?: number) => void;
  focusMarker: (serviceId: string) => void;
  resetView: () => void;
  topDownView: () => void;
  showRoute: NavigationLayer['showRoute'];
  dispose: () => void;
  provenance: ReturnType<typeof geometryProvenance>;
}

export function createCampusScene(
  canvas: HTMLCanvasElement,
  callbacks: SceneCallbacks = {}
): CampusSceneHandle {
  const radius = CAMPUS_GEOMETRY.radius_m;

  // --- renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: window.devicePixelRatio < 2,
    powerPreference: 'high-performance'
  });
  // Cap the pixel ratio: a 3x phone screen is the most common cause of a janky 3D map.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x11141a, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x11141a, radius * 2.1, radius * 3.6);

  const camera = new THREE.PerspectiveCamera(48, 1, 1, radius * 6);
  const camera3d = new CameraController(camera);
  camera3d.reset(radius);

  // --- lighting: enough to read massing, cheap enough for mobile
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f26, 1.05));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.25);
  sun.position.set(radius * 0.7, radius * 1.1, radius * 0.45);
  scene.add(sun);

  // --- layers
  const ground: GroundResult = createGround();
  scene.add(ground.mesh);

  const surfaces: SurfaceLayer = createSurfaces();
  scene.add(surfaces.group);

  const buildings: BuildingsLayer = createBuildings();
  scene.add(buildings.group);

  const traffic: TrafficLayer = createTrafficLayer();
  scene.add(traffic.group);

  const navigation: NavigationLayer = createNavigationLayer();
  scene.add(navigation.group);

  /**
   * Performance statistics, published on the canvas as data attributes.
   *
   * A frame-rate reading is useless here: browsers throttle requestAnimationFrame
   * in a background tab, so an automated check reports 0 fps on a scene that is
   * running perfectly. Draw calls, triangles and geometries are stable facts
   * about the scene, and they are what actually determine whether it will hold a
   * frame rate on a phone.
   */
  const publishStats = () => {
    const info = renderer.info;
    canvas.dataset.drawCalls = String(info.render.calls);
    canvas.dataset.triangles = String(info.render.triangles);
    canvas.dataset.geometries = String(info.memory.geometries);
    canvas.dataset.textures = String(info.memory.textures);
    canvas.dataset.programs = String(info.programs?.length ?? 0);
  };

  // Ground status is reported once imagery has settled.
  const groundTimer = window.setInterval(() => {
    if (ground.satelliteLoaded || ground.tilesLoaded > 0) {
      clearInterval(groundTimer);
      callbacks.onGroundStatus?.({
        satelliteLoaded: ground.satelliteLoaded,
        tilesLoaded: ground.tilesLoaded,
        tilesRequested: ground.tilesRequested,
        resolution_m_per_px: ground.resolution_m_per_px
      });
    }
  }, 400);

  // --- pointer interaction
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerDown: { x: number; y: number; t: number } | null = null;
  let dragging = false;
  let draggedDistance = 0;

  /** 0 = one finger / left drag orbits, 1 = middle or two-finger pans. */
  let dragMode: 'orbit' | 'pan' = 'orbit';
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

  function toNdc(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pick(event: PointerEvent) {
    toNdc(event);
    raycaster.setFromCamera(ndc, camera);

    // CampusFlow service caps win over buildings: they are the useful target.
    const capHits = raycaster.intersectObjects(
      traffic.group.children.map(c => c.children[2]).filter(Boolean) as THREE.Object3D[],
      true
    );
    if (capHits.length > 0) {
      const id = capHits[0].object.userData.serviceId;
      if (id) {
        callbacks.onServicePicked?.(id);
        return;
      }
    }

    const hits = raycaster.intersectObjects(buildings.pickable, false);
    if (hits.length > 0) {
      const id = hits[0].object.userData.id as string;
      const data = CAMPUS_GEOMETRY.buildings.find(b => b.id === id);
      buildings.select(id);
      if (data) callbacks.onBuildingPicked?.(data);
    }
  }

  function onPointerDown(event: PointerEvent) {
    canvas.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      dragMode = 'pan';
      return;
    }

    pointerDown = { x: event.clientX, y: event.clientY, t: performance.now() };
    draggedDistance = 0;
    dragging = false;
    dragMode = event.button === 1 || event.shiftKey ? 'pan' : 'orbit';
  }

  function onPointerMove(event: PointerEvent) {
    const prev = activePointers.get(event.pointerId);
    if (!prev) return;
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) camera3d.zoom((pinchDistance - d) * 2.2);
      pinchDistance = d;
      return;
    }

    if (pointerDown) {
      draggedDistance += Math.abs(dx) + Math.abs(dy);
      if (draggedDistance > 6) dragging = true;
      if (dragMode === 'pan') camera3d.pan(dx, dy);
      else camera3d.orbit(dx, dy);
    }
  }

  function onPointerUp(event: PointerEvent) {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinchDistance = 0;

    // A short, still pointer press is a tap, not a drag.
    if (
      pointerDown &&
      !dragging &&
      performance.now() - pointerDown.t < 400 &&
      draggedDistance < 8
    ) {
      pick(event);
    }
    pointerDown = null;
    dragging = false;
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    camera3d.zoom(event.deltaY);
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  // --- keyboard, so the scene is operable without a pointer
  function onKeyDown(event: KeyboardEvent) {
    const step = 40;
    switch (event.key) {
      case 'ArrowLeft': camera3d.orbit(-step, 0); break;
      case 'ArrowRight': camera3d.orbit(step, 0); break;
      case 'ArrowUp': camera3d.orbit(0, -step); break;
      case 'ArrowDown': camera3d.orbit(0, step); break;
      case '+': case '=': camera3d.zoom(-260); break;
      case '-': case '_': camera3d.zoom(260); break;
      case '0': camera3d.reset(radius); break;
      case 'Escape': callbacks.onBuildingPicked?.(null); break;
      default: return;
    }
    event.preventDefault();
  }
  canvas.addEventListener('keydown', onKeyDown);
  canvas.tabIndex = 0;

  // --- render loop
  let frame = 0;
  let running = true;
  let lastCameraReport = 0;

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  resize();

  function tick() {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    camera3d.update();
    surfaces.update(camera3d.height());

    publishStats();

    // Report camera movement at a low rate; it drives label visibility.
    const now = performance.now();
    if (now - lastCameraReport > 180) {
      lastCameraReport = now;
      callbacks.onCameraChange?.({ distance: camera3d.state().distance, height: camera3d.height() });
    }

    renderer.render(scene, camera);
  }
  tick();

  function dispose() {
    running = false;
    cancelAnimationFrame(frame);
    clearInterval(groundTimer);
    observer.disconnect();

    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('keydown', onKeyDown);

    ground.dispose();
    surfaces.dispose();
    buildings.dispose();
    traffic.dispose();
    navigation.dispose();

    scene.clear();
    renderer.dispose();
  }

  return {
    scene,
    camera,
    renderer,
    camera3d,
    provenance: geometryProvenance(),
    setMarkers: markers => traffic.setMarkers(markers),
    selectService: id => traffic.select(id),
    selectBuilding: id => buildings.select(id),
    focusOn: (position, distance) =>
      camera3d.focus(new THREE.Vector3(position[0], 0, position[1]), distance),
    focusMarker: serviceId => {
      const p = traffic.positionOf(serviceId);
      if (p) camera3d.focus(new THREE.Vector3(p.x, 0, p.z), 200);
    },
    resetView: () => camera3d.reset(radius),
    topDownView: () => camera3d.topDown(radius),
    showRoute: navigation.showRoute,
    dispose
  };
}
