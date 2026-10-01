/**
 * Walking-route overlay and building link markers.
 *
 * Routes are drawn only when the real path graph found a real connection. When
 * it did not, nothing is drawn and the caller is told why - a straight dashed
 * line between two points would be a fictional route presented as a real one.
 */

import * as THREE from 'three';
import { campusRouteGraph, type RouteResult } from '../lib/campusRoute.js';

const ROUTE_LIFT = 4.5;

export interface NavigationLayer {
  group: THREE.Group;
  /** Draws a measured route, or reports that no mapped path exists. */
  showRoute: (from: [number, number], to: [number, number]) => RouteResult;
  clear: () => void;
  /** Marks a building as admin-linked to a CampusFlow service. */
  setLinks: (links: Map<string, { serviceName: string; verified: boolean }>) => void;
  dispose: () => void;
}

export function createNavigationLayer(): NavigationLayer {
  const group = new THREE.Group();
  group.name = 'campusflow-navigation';
  group.userData.layer = 'navigation';

  const graph = campusRouteGraph();
  const disposables: Array<{ dispose: () => void }> = [];

  const linkGroup = new THREE.Group();
  group.add(linkGroup);

  function clear() {
    for (const child of [...group.children]) {
      if (child === linkGroup) continue;
      group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    disposables.length = 0;
  }

  function tube(points: [number, number][], radius: number, colour: number) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(p => new THREE.Vector3(p[0], ROUTE_LIFT, p[1]))
    );
    const geo = new THREE.TubeGeometry(curve, Math.max(24, points.length * 4), radius, 8, false);
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    disposables.push(geo, mat);
    return mesh;
  }

  function showRoute(from: [number, number], to: [number, number]): RouteResult {
    const result = graph.route(from, to);
    if (!result.ok) return result;

    clear();

    // A wide dark casing under a bright core keeps the route legible over imagery.
    tube(result.points, 7, 0x10130a);
    const core = tube(result.points, 3.2, 0xd9f65b);

    // Destination marker.
    const geo = new THREE.SphereGeometry(7, 16, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd9f65b,
      emissive: 0xd9f65b,
      emissiveIntensity: 0.7
    });
    const pin = new THREE.Mesh(geo, mat);
    pin.position.set(to[0], ROUTE_LIFT + 2, to[1]);
    group.add(pin);
    disposables.push(geo, mat);

    core.userData = { layer: 'route' };
    return result;
  }

  function setLinks(links: Map<string, { serviceName: string; verified: boolean }>) {
    for (const child of [...linkGroup.children]) {
      linkGroup.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }

    for (const [, info] of links) {
      // A verified link is a filled disc; an unverified one is a hollow ring.
      // Shape carries the meaning, so it survives a colour-blind reader.
      const geo = info.verified
        ? new THREE.CylinderGeometry(9, 9, 1.4, 24)
        : new THREE.RingGeometry(7, 9.5, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: info.verified ? 0xd9f65b : 0xffffff,
        transparent: true,
        opacity: info.verified ? 0.55 : 0.4,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 1.6;
      mesh.userData = { layer: 'link', serviceName: info.serviceName, verified: info.verified };
      linkGroup.add(mesh);
    }
  }

  function dispose() {
    clear();
    for (const d of disposables) d.dispose();
  }

  return { group, showRoute, clear, setLinks, dispose };
}
