/**
 * CameraController.js — smooth, damped third-person orbit camera.
 *
 * Features: mouse-orbit (yaw/pitch), wheel zoom, spring-damped follow,
 * camera collision (pulls in when a mountain wall is behind the player) and a
 * scripted cinematic mode for the summit ending.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp, damp, approach } = TFW.Utils;

  class CameraController {
    constructor(camera, config) {
      this.camera = camera;
      this.cfg = config.camera;

      this.yaw = 0;
      this.pitch = this.cfg.startPitch;
      this.distance = this.cfg.distance;
      this.targetDistance = this.cfg.distance;

      this.target = new THREE.Vector3();       // smoothed look-at point
      this.desiredTarget = new THREE.Vector3(); // where the player head is
      this.currentPos = new THREE.Vector3(0, 5, -20);

      this.cinematic = null;
      this.shake = new THREE.Vector3();

      this._dir = new THREE.Vector3();
      this._tmp = new THREE.Vector3();
      this._sample = new THREE.Vector3();
    }

    /** Snap immediately behind the player (used on spawn / respawn). */
    snapTo(targetPos, yaw) {
      this.yaw = yaw !== undefined ? yaw : this.yaw;
      this.pitch = this.cfg.startPitch;
      this.desiredTarget.copy(targetPos);
      this.target.copy(targetPos);
      this._computeDesiredPosition(this._tmp);
      this.currentPos.copy(this._tmp);
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.target);
    }

    applyLook(look) {
      if (this.cinematic) return;
      this.yaw -= look.x;
      this.pitch = clamp(this.pitch + look.y, this.cfg.minPitch, this.cfg.maxPitch);
    }

    applyZoom(zoom) {
      if (!zoom || this.cinematic) return;
      this.targetDistance = clamp(this.targetDistance + zoom, this.cfg.minDistance, this.cfg.maxDistance);
    }

    /** Ideal camera position from yaw/pitch/distance around the current target. */
    _computeDesiredPosition(out) {
      const cosP = Math.cos(this.pitch);
      const ox = Math.sin(this.yaw) * cosP;
      const oz = Math.cos(this.yaw) * cosP;
      const oy = Math.sin(this.pitch);
      out.set(
        this.target.x - ox * this.distance,
        this.target.y + oy * this.distance + this.cfg.height * 0.35,
        this.target.z - oz * this.distance
      );
      return out;
    }

    /**
     * Keep the camera out of the mountain by sampling the walkable surface
     * analytically along the target→camera ray (cheap, no mesh raycasting).
     */
    _resolveCollision(desired, world) {
      if (!world || !world.surfaceHeightAt) return desired;
      this._dir.copy(desired).sub(this.target);
      const dist = this._dir.length();
      if (dist < 0.001) return desired;
      this._dir.multiplyScalar(1 / dist);

      const pad = this.cfg.collisionPad;
      const steps = 8;
      let allowed = dist;
      for (let i = 1; i <= steps; i++) {
        const d = (dist * i) / steps;
        this._sample.copy(this.target).addScaledVector(this._dir, d);
        const ground = world.surfaceHeightAt(this._sample.x, this._sample.z).y;
        if (this._sample.y < ground + pad) {
          allowed = Math.max(this.cfg.minDistance * 0.4, d - (dist / steps));
          break;
        }
      }
      if (allowed < dist) desired.copy(this.target).addScaledVector(this._dir, allowed);

      // Final safety: never let the camera sink below the surface.
      const gy = world.surfaceHeightAt(desired.x, desired.z).y;
      if (desired.y < gy + pad * 0.6) desired.y = gy + pad * 0.6;
      return desired;
    }

    update(dt, headPos, world, shakeOffset) {
      if (this.cinematic) {
        this._updateCinematic(dt);
        return;
      }

      this.desiredTarget.copy(headPos);
      this.target.x = damp(this.target.x, this.desiredTarget.x, 0.001, dt);
      this.target.y = damp(this.target.y, this.desiredTarget.y, 0.0008, dt);
      this.target.z = damp(this.target.z, this.desiredTarget.z, 0.001, dt);

      this.distance = approach(this.distance, this.targetDistance, 8, dt);

      this._computeDesiredPosition(this._tmp);
      this._resolveCollision(this._tmp, world);

      const rate = this.cfg.followRate;
      this.currentPos.x = approach(this.currentPos.x, this._tmp.x, rate, dt);
      this.currentPos.y = approach(this.currentPos.y, this._tmp.y, rate, dt);
      this.currentPos.z = approach(this.currentPos.z, this._tmp.z, rate, dt);

      this.camera.position.copy(this.currentPos);
      if (shakeOffset) this.camera.position.add(shakeOffset);
      this.camera.lookAt(this.target);
    }

    // ---------------------------------------------------------- cinematic

    /**
     * Begin the summit ending: slow orbit around the flag while rising.
     * @param {THREE.Vector3} center  Point to orbit (flag pole top area).
     */
    startCinematic(center) {
      this.cinematic = {
        center: center.clone(),
        angle: this.yaw,
        radius: 15,
        height: 7,
        elapsed: 0,
      };
    }

    stopCinematic() { this.cinematic = null; }

    _updateCinematic(dt) {
      const c = this.cinematic;
      c.elapsed += dt;
      c.angle += dt * 0.32;
      c.radius = 15 + Math.sin(c.elapsed * 0.35) * 3;
      const h = c.height + Math.sin(c.elapsed * 0.5) * 1.5 + Math.min(6, c.elapsed * 0.7);

      this._tmp.set(
        c.center.x + Math.sin(c.angle) * c.radius,
        c.center.y + h,
        c.center.z + Math.cos(c.angle) * c.radius
      );
      this.currentPos.x = approach(this.currentPos.x, this._tmp.x, 3, dt);
      this.currentPos.y = approach(this.currentPos.y, this._tmp.y, 3, dt);
      this.currentPos.z = approach(this.currentPos.z, this._tmp.z, 3, dt);

      this.target.x = approach(this.target.x, c.center.x, 3, dt);
      this.target.y = approach(this.target.y, c.center.y, 3, dt);
      this.target.z = approach(this.target.z, c.center.z, 3, dt);

      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.target);
    }
  }

  TFW.CameraController = CameraController;
})(window);
