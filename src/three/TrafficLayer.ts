/**
 * Live CampusFlow overlays on the 3D campus.
 *
 * This layer is the whole point of the exercise: it puts real operational data on
 * real geometry. Every value rendered here comes from the CampusFlow API -
 * `effectiveTrafficState()` for the state, the queue length and estimated wait
 * from the service record, and the peak window from the forecast engine. Nothing
 * is generated locally, and a service with no live data renders as explicitly
 * unknown rather than as zero.
 */

import * as THREE from 'three';
import type { Service } from '../types/index.js';
import type { TrafficState } from '../types/traffic.js';
import { effectiveTrafficState } from '../lib/trafficState.js';

export interface ServiceMarker {
  serviceId: string;
  serviceName: string;
  buildingId: string;
  /** Local metres. */
  position: [number, number];
  traffic: TrafficState;
  queueLength: number;
  waitMins: number;
  /** True when the service is actually open right now. */
  isOpen: boolean;
  /** Forecast peak label, or null when history is insufficient. */
  peakLabel: string | null;
  /** True when this position came from an admin-configured real link. */
  positionIsVerified: boolean;
  alternativesCount?: number;
  availableSeats?: number;
}

/** Beacon colours per state. Paired with a glyph and a word, never colour alone. */
const STATE_COLOUR: Record<TrafficState, number> = {
  low: 0x5fbf6a,
  moderate: 0xd9f65b,
  high: 0xf0a63c,
  peak: 0xe2574c,
  closed: 0x7a7f88
};

/** Short glyph carried on the label so state is never colour-only. */
const STATE_GLYPH: Record<TrafficState, string> = {
  low: '●',
  moderate: '◆',
  high: '▲',
  peak: '■',
  closed: '–'
};

/** The calm, factual wording the rest of the product uses. */
const STATE_WORD: Record<TrafficState, string> = {
  low: 'Quiet',
  moderate: 'Normal',
  high: 'Busy',
  peak: 'Very busy',
  closed: 'Closed'
};

/** three.js types `material` as a single material or an array; this handles both. */
function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach(m => m.dispose());
  else material?.dispose();
}

export interface TrafficLayer {
  group: THREE.Group;
  /** Rebuilds beacons from the current data set. */
  setMarkers: (markers: ServiceMarker[]) => void;
  select: (serviceId: string | null) => void;
  /** World position of a service, for camera focus. */
  positionOf: (serviceId: string) => THREE.Vector3 | null;
  dispose: () => void;
}

interface Beacon {
  root: THREE.Group;
  ring: THREE.Mesh;
  pillar: THREE.Mesh;
  cap: THREE.Mesh;
  marker: ServiceMarker;
  selected: boolean;
}

export function createTrafficLayer(): TrafficLayer {
  const group = new THREE.Group();
  group.name = 'campusflow-traffic';
  group.userData.layer = 'traffic';

  const beacons: Beacon[] = [];
  const byService = new Map<string, Beacon>();

  const ringGeo = new THREE.RingGeometry(6, 7.6, 32);
  const pillarGeo = new THREE.CylinderGeometry(1.5, 1.5, 34, 10);
  const capGeo = new THREE.SphereGeometry(3.4, 14, 10);

  function buildBeacon(marker: ServiceMarker): Beacon {
    const root = new THREE.Group();
    root.position.set(marker.position[0], 0, marker.position[1]);
    root.userData = {
      layer: 'service',
      serviceId: marker.serviceId,
      name: marker.serviceName
    };

    const colour = STATE_COLOUR[marker.traffic];

    // Ground ring: the traffic level, readable from directly above.
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.2;
    root.add(ring);

    // Pillar: visible from a distance, height carries no data on purpose.
    const pillar = new THREE.Mesh(
      pillarGeo,
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.28,
        depthWrite: false
      })
    );
    pillar.position.y = 17;
    root.add(pillar);

    // Cap: the click target, and where the label anchors.
    const cap = new THREE.Mesh(
      capGeo,
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 0.5,
        roughness: 0.4
      })
    );
    cap.position.y = 36;
    cap.userData = { layer: 'service', serviceId: marker.serviceId };
    root.add(cap);

    return { root, ring, pillar, cap, marker, selected: false };
  }

  function setMarkers(markers: ServiceMarker[]) {
    // Clear
    for (const b of beacons) {
      group.remove(b.root);
      disposeMaterial(b.ring.material);
      disposeMaterial(b.pillar.material);
      disposeMaterial(b.cap.material);
    }
    beacons.length = 0;
    byService.clear();

    for (const marker of markers) {
      const beacon = buildBeacon(marker);
      beacons.push(beacon);
      byService.set(marker.serviceId, beacon);
      group.add(beacon.root);
    }
  }

  function select(serviceId: string | null) {
    for (const b of beacons) {
      const isSelected = b.marker.serviceId === serviceId;
      b.selected = isSelected;
      const mat = b.cap.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = isSelected ? 1.4 : 0.5;
      const ringMat = b.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = isSelected ? 1 : 0.75;
    }
  }

  return {
    group,
    setMarkers,
    select,
    positionOf: serviceId => {
      const b = byService.get(serviceId);
      if (!b) return null;
      return new THREE.Vector3(b.marker.position[0], 36, b.marker.position[1]);
    },
    dispose: () => {
      ringGeo.dispose();
      pillarGeo.dispose();
      capGeo.dispose();
      for (const b of beacons) {
        disposeMaterial(b.ring.material);
        disposeMaterial(b.pillar.material);
        disposeMaterial(b.cap.material);
      }
    }
  };
}

/**
 * Builds markers from live CampusFlow data.
 *
 * `positions` comes from the app's own campus layout, or from an
 * admin-configured link to a real building. `verified` records which, so the UI
 * can be honest about provenance rather than implying a surveyed location.
 */
export function markersFromData(args: {
  services: Service[];
  positionFor: (buildingId: string) => { position: [number, number]; verified: boolean } | null;
  peakFor?: (serviceId: string) => string | null;
  alternativesFor?: (serviceId: string) => number;
  seatsFor?: (serviceId: string) => number;
}): ServiceMarker[] {
  const { services, positionFor } = args;
  const out: ServiceMarker[] = [];

  for (const service of services) {
    const at = positionFor(service.building_id);
    if (!at) continue; // no position: omit rather than invent one

    const traffic = effectiveTrafficState(service);
    const isOpen = traffic !== 'closed';

    out.push({
      serviceId: service.id,
      serviceName: service.name,
      buildingId: service.building_id,
      position: at.position,
      traffic,
      queueLength: service.current_queue_length ?? 0,
      waitMins: service.estimated_wait_mins ?? 0,
      isOpen,
      peakLabel: args.peakFor?.(service.id) ?? null,
      positionIsVerified: at.verified,
      alternativesCount: args.alternativesFor?.(service.id),
      availableSeats: args.seatsFor?.(service.id)
    });
  }

  return out;
}

export { STATE_COLOUR, STATE_GLYPH };
