/**
 * Camera controls for the campus scene.
 *
 * Presets rather than a free-floating gimbal: the goal is that a student never
 * has to fight the camera. Explore orbits within limits, focus flies to a point,
 * and reset always returns to the same whole-campus view.
 */

import * as THREE from 'three';

export type CameraMode = 'campus' | 'explore' | 'building' | 'service' | 'seat';

export interface CameraState {
  mode: CameraMode;
  distance: number;
  azimuth: number;
  polar: number;
  target: THREE.Vector3;
}

const LIMITS = {
  minDistance: 60,
  maxDistance: 2600,
  minPolar: 0.18,
  maxPolar: 1.32 // never go below the ground plane
};

export class CameraController {
  private azimuth = Math.PI * 0.25;
  private polar = 0.95;
  private distance = 1500;
  private readonly target = new THREE.Vector3(0, 0, 0);

  private desiredAzimuth = this.azimuth;
  private desiredPolar = this.polar;
  private desiredDistance = this.distance;
  private readonly desiredTarget = new THREE.Vector3(0, 0, 0);

  /** Eased toward the desired state every frame, so moves feel smooth. */
  private readonly damping = 0.12;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.apply(1);
  }

  state(): CameraState {
    return {
      mode: 'explore',
      distance: this.distance,
      azimuth: this.azimuth,
      polar: this.polar,
      target: this.target.clone()
    };
  }

  orbit(deltaX: number, deltaY: number) {
    this.desiredAzimuth -= deltaX * 0.005;
    this.desiredPolar = clamp(
      this.desiredPolar - deltaY * 0.005,
      LIMITS.minPolar,
      LIMITS.maxPolar
    );
  }

  pan(deltaX: number, deltaY: number) {
    // Pan in the camera's ground plane, scaled so the drag tracks the cursor.
    const scale = this.distance * 0.0016;
    const forward = new THREE.Vector3(Math.cos(this.azimuth), 0, Math.sin(this.azimuth));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    this.desiredTarget.addScaledVector(right, -deltaX * scale);
    this.desiredTarget.addScaledVector(forward, -deltaY * scale);
  }

  zoom(delta: number) {
    this.desiredDistance = clamp(
      this.desiredDistance * (1 + delta * 0.0015),
      LIMITS.minDistance,
      LIMITS.maxDistance
    );
  }

  /** Frames a point at a sensible distance for a building or a service. */
  focus(point: THREE.Vector3, distance = 220) {
    this.desiredTarget.set(point.x, 0, point.z);
    this.desiredDistance = clamp(distance, LIMITS.minDistance, LIMITS.maxDistance);
    this.desiredPolar = Math.min(this.desiredPolar, 1.05);
  }

  /** The whole-campus view. Always returns to the same framing. */
  reset(radius: number) {
    this.desiredTarget.set(0, 0, 0);
    this.desiredDistance = radius * 1.65;
    this.desiredPolar = 0.95;
    this.desiredAzimuth = Math.PI * 0.25;
  }

  /** Near-vertical top-down, for reading the plan. */
  topDown(radius: number) {
    this.desiredTarget.set(0, 0, 0);
    this.desiredDistance = radius * 1.8;
    this.desiredPolar = 0.28;
  }

  update() {
    this.azimuth += (this.desiredAzimuth - this.azimuth) * this.damping;
    this.polar += (this.desiredPolar - this.polar) * this.damping;
    this.distance += (this.desiredDistance - this.distance) * this.damping;
    this.target.lerp(this.desiredTarget, this.damping);
    this.apply();
  }

  private apply(_immediate = 0) {
    const sinP = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sinP * Math.cos(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + this.distance * sinP * Math.sin(this.azimuth)
    );
    this.camera.lookAt(this.target);
  }

  /** Camera height above ground, used by the detail LOD. */
  height(): number {
    return this.camera.position.y;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
