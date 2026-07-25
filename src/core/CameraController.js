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

      /**
       * Smoothed camera-collision distance. Kept as its own state so the
       * pull-in/push-out can be eased over time instead of snapping, which is
       * what made the view feel like it was jerkily zooming by itself.
       */
      this.collisionDistance = this.cfg.distance;

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
      // Reset the collision spring so a respawn starts from a clean distance
      // instead of easing out from wherever the previous frame left it.
      this.collisionDistance = this.distance;
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

    /** Camera position at a given orbit distance around the current target. */
    _positionAt(dist, out) {
      const cosP = Math.cos(this.pitch);
      const ox = Math.sin(this.yaw) * cosP;
      const oz = Math.cos(this.yaw) * cosP;
      const oy = Math.sin(this.pitch);
      out.set(
        this.target.x - ox * dist,
        this.target.y + oy * dist + this.cfg.height * 0.35,
        this.target.z - oz * dist
      );
      return out;
    }

    /** Back-compat helper: ideal position at the current smoothed distance. */
    _computeDesiredPosition(out) {
      return this._positionAt(this.distance, out);
    }

    /**
     * Largest orbit distance (up to `wanted`) that keeps the camera clear of the
     * mountain, sampled analytically along the target→camera ray.
     *
     * The hit point is found by *interpolating* where clearance crosses zero
     * rather than snapping to a sample index, so the result changes smoothly as
     * the player moves. That continuity is what removes the zoom judder.
     */
    _maxClearDistance(world, wanted) {
      if (!world || !world.surfaceHeightAt) return wanted;

      const pad = this.cfg.collisionPad;
      const minD = Math.max(0.6, this.cfg.minDistance * 0.45);

      // Clearance of the camera above the ground at orbit distance d.
      const clearanceAt = (d) => {
        this._positionAt(d, this._sample);
        const ground = world.surfaceHeightAt(this._sample.x, this._sample.z).y;
        return this._sample.y - (ground + pad);
      };

      // If even the closest allowed position is buried, just use it.
      let prevD = minD;
      let prevC = clearanceAt(prevD);
      if (prevC < 0) return minD;

      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const d = minD + ((wanted - minD) * i) / steps;
        const c = clearanceAt(d);
        if (c < 0) {
          // Linear interpolation of the zero crossing between prevD and d.
          const t = prevC / (prevC - c);
          return clamp(prevD + (d - prevD) * t, minD, wanted);
        }
        prevD = d;
        prevC = c;
      }
      return wanted;
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

      // Player-requested zoom (wheel / pinch).
      this.distance = approach(this.distance, this.targetDistance, 8, dt);

      // Collision distance, smoothed asymmetrically: snap inward quickly so the
      // camera never clips through a slope, but drift back out gently so the
      // view does not appear to zoom on its own every time terrain passes by.
      const clear = this._maxClearDistance(world, this.distance);
      const inward = clear < this.collisionDistance;
      const rateD = inward ? this.cfg.collisionInRate : this.cfg.collisionOutRate;
      this.collisionDistance = approach(this.collisionDistance, clear, rateD, dt);

      const useDist = Math.min(this.collisionDistance, this.distance);
      this._positionAt(useDist, this._tmp);

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
