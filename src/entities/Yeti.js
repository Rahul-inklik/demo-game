/**
 * Yeti.js — Bholu, the big friendly Himalayan Yeti guide.
 *
 * A gentle, toy-like giant built from soft primitives. He never attacks; he
 * greets the player, hosts the history quiz and cheers at the summit. Supports
 * idle, wave, talk, point and celebrate animation states.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { damp, dampAngle, clamp } = TFW.Utils;

  class Yeti {
    constructor(scene, assets, config, position) {
      this.scene = scene;
      this.cfg = config;
      this.state = 'idle';
      this._time = Math.random() * 10;
      this.position = position.clone();
      this.faceYaw = Math.PI; // face back down the trail toward the player

      this.group = new THREE.Group();
      this.group.position.copy(this.position);
      this.group.rotation.y = this.faceYaw;

      this._build(config);
      scene.add(this.group);

      this._tmp = new THREE.Vector3();
    }

    _build(config) {
      const p = config.Palette;
      const fur = new THREE.MeshStandardMaterial({ color: p.yetiFur, roughness: 0.95, metalness: 0 });
      const furShade = new THREE.MeshStandardMaterial({ color: p.yetiFurShade, roughness: 0.95 });
      const skin = new THREE.MeshStandardMaterial({ color: p.yetiSkin, roughness: 0.7 });

      const SCALE = 1.9; // big, friendly giant
      this.root = new THREE.Group();
      this.root.scale.setScalar(SCALE);
      this.group.add(this.root);

      // Legs.
      const legGeo = new THREE.CapsuleGeometry(0.42, 0.6, 4, 10);
      this.legL = new THREE.Mesh(legGeo, fur);
      this.legL.position.set(-0.5, 0.7, 0);
      this.legR = this.legL.clone();
      this.legR.position.x = 0.5;
      [this.legL, this.legR].forEach((l) => { l.castShadow = true; this.root.add(l); });
      const footGeo = new THREE.BoxGeometry(0.6, 0.3, 0.85);
      [-0.5, 0.5].forEach((x) => {
        const foot = new THREE.Mesh(footGeo, furShade);
        foot.position.set(x, 0.2, 0.2);
        foot.castShadow = true;
        this.root.add(foot);
      });

      // Body.
      this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 1.0, 8, 16), fur);
      this.body.position.y = 2.05;
      this.body.scale.set(1, 1, 0.9);
      this.body.castShadow = true;
      this.root.add(this.body);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 14), furShade);
      belly.position.set(0, 1.9, 0.42);
      belly.scale.set(1, 1.15, 0.7);
      this.root.add(belly);

      // Head.
      this.head = new THREE.Group();
      this.head.position.y = 3.3;
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.78, 20, 16), fur);
      skull.castShadow = true;
      this.head.add(skull);
      const faceMat = skin;
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.6, 18, 14), faceMat);
      face.position.set(0, -0.05, 0.42);
      face.scale.set(1, 0.9, 0.7);
      this.head.add(face);
      // Eyes.
      const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
      const pupilMat = new THREE.MeshStandardMaterial({ color: 0x22252e, roughness: 0.3 });
      [-0.24, 0.24].forEach((dx) => {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), eyeWhiteMat);
        w.position.set(dx, 0.2, 0.72);
        w.scale.set(1, 1.2, 0.6);
        this.head.add(w);
        const pu = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), pupilMat);
        pu.position.set(dx, 0.2, 0.83);
        this.head.add(pu);
      });
      // Friendly smile.
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.6 }));
      smile.position.set(0, -0.18, 0.78);
      smile.rotation.z = Math.PI;
      this.mouth = smile;
      this.head.add(smile);
      // Horns (soft, blunt, friendly).
      const hornMat = furShade;
      [-0.4, 0.4].forEach((dx) => {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), hornMat);
        horn.position.set(dx, 0.72, 0.1);
        horn.rotation.z = dx > 0 ? -0.4 : 0.4;
        this.head.add(horn);
      });
      this.root.add(this.head);

      // Arms (shoulder-pivoted).
      this.armL = this._arm(fur, furShade, -1.15);
      this.armR = this._arm(fur, furShade, 1.15);
      this.root.add(this.armL.pivot, this.armR.pivot);
    }

    _arm(furMat, handMat, x) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 2.6, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.1, 6, 12), furMat);
      arm.position.y = -0.7;
      arm.castShadow = true;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), handMat);
      hand.position.y = -1.35;
      hand.castShadow = true;
      pivot.add(hand);
      return { pivot, hand };
    }

    setState(state) {
      if (this.state === state) return;
      this.state = state;
      this._stateT = 0;
    }

    /**
     * Step out directly in front of the player for a face-to-face greeting.
     * Places the Yeti a few metres ahead of the boy (in the direction he is
     * facing), snapped to the ground, and turns to look him in the eye.
     * @returns {THREE.Vector3} the Yeti's new world position (for VFX).
     */
    appearInFrontOf(playerPos, playerYaw, course) {
      const dist = 5.0;
      const fx = Math.sin(playerYaw);
      const fz = Math.cos(playerYaw);
      let nx = playerPos.x + fx * dist;
      let nz = playerPos.z + fz * dist;
      const ny = course.surfaceHeightAt(nx, nz).y;
      this.position.set(nx, ny, nz);
      this.group.position.copy(this.position);
      // Face the player immediately (and keep facing during the chat).
      this._faceTarget = Math.atan2(playerPos.x - nx, playerPos.z - nz);
      this.group.rotation.y = this._faceTarget;
      return this.position.clone();
    }

    /** Face a world point (used to look at the player while talking). */
    lookAt(pos) {
      const dx = pos.x - this.position.x;
      const dz = pos.z - this.position.z;
      this._faceTarget = Math.atan2(dx, dz);
    }

    update(dt, playerPos) {
      this._time += dt;
      this._stateT = (this._stateT || 0) + dt;
      const t = this._time;

      if (playerPos) this.lookAt(playerPos);
      if (this._faceTarget !== undefined) {
        this.group.rotation.y = dampAngle(this.group.rotation.y, this._faceTarget, 4, dt);
      }

      // Base idle breathing on the body/head.
      const breathe = Math.sin(t * 1.8) * 0.05;
      this.body.scale.y = 1 + breathe;
      this.head.position.y = 3.3 + breathe * 0.5;
      this.body.rotation.z = Math.sin(t * 0.9) * 0.03;

      switch (this.state) {
        case 'wave': this._animWave(dt, t); break;
        case 'talk': this._animTalk(dt, t); break;
        case 'point': this._animPoint(dt, t); break;
        case 'celebrate': this._animCelebrate(dt, t); break;
        default: this._animIdle(dt, t); break;
      }
    }

    _relaxArm(arm, dt, restX) {
      arm.pivot.rotation.x = damp(arm.pivot.rotation.x, restX || 0.15, 0.002, dt);
      arm.pivot.rotation.z = damp(arm.pivot.rotation.z, 0, 0.002, dt);
    }

    _animIdle(dt, t) {
      this._relaxArm(this.armL, dt, 0.15 + Math.sin(t * 1.5) * 0.06);
      this._relaxArm(this.armR, dt, 0.15 + Math.cos(t * 1.5) * 0.06);
      this.head.rotation.y = Math.sin(t * 0.6) * 0.15;
      this.head.rotation.x = 0;
    }

    _animWave(dt, t) {
      this._relaxArm(this.armL, dt, 0.15);
      // Right arm up, hand waving.
      this.armR.pivot.rotation.x = damp(this.armR.pivot.rotation.x, -2.4, 0.001, dt);
      this.armR.pivot.rotation.z = damp(this.armR.pivot.rotation.z, -0.5 + Math.sin(t * 9) * 0.5, 0.0005, dt);
      this.head.rotation.y = damp(this.head.rotation.y, 0, 0.01, dt);
      this.head.rotation.x = Math.sin(t * 3) * 0.05;
    }

    _animTalk(dt, t) {
      this._relaxArm(this.armL, dt, 0.3 + Math.sin(t * 2.5) * 0.15);
      this._relaxArm(this.armR, dt, 0.3 + Math.cos(t * 2.2) * 0.12);
      // Head bob + mouth "speaking" scale.
      this.head.rotation.x = Math.sin(t * 7) * 0.08 - 0.03;
      this.head.rotation.y = Math.sin(t * 1.5) * 0.08;
      const m = 0.8 + Math.abs(Math.sin(t * 9)) * 0.9;
      this.mouth.scale.set(1, m, 1);
    }

    _animPoint(dt, t) {
      this._relaxArm(this.armL, dt, 0.15);
      // Right arm points forward/up toward the summit.
      this.armR.pivot.rotation.x = damp(this.armR.pivot.rotation.x, -1.4, 0.001, dt);
      this.armR.pivot.rotation.z = damp(this.armR.pivot.rotation.z, 0, 0.002, dt);
      this.head.rotation.x = damp(this.head.rotation.x, -0.15, 0.01, dt);
    }

    _animCelebrate(dt, t) {
      // Both arms up, joyful hops.
      this.armL.pivot.rotation.x = damp(this.armL.pivot.rotation.x, -2.6 + Math.sin(t * 8) * 0.3, 0.001, dt);
      this.armR.pivot.rotation.x = damp(this.armR.pivot.rotation.x, -2.6 + Math.cos(t * 8) * 0.3, 0.001, dt);
      this.armL.pivot.rotation.z = damp(this.armL.pivot.rotation.z, 0.6, 0.002, dt);
      this.armR.pivot.rotation.z = damp(this.armR.pivot.rotation.z, -0.6, 0.002, dt);
      const hop = Math.abs(Math.sin(t * 6)) * 0.35;
      this.root.position.y = hop;
      this.head.rotation.x = Math.sin(t * 6) * 0.1;
      const m = 1.4;
      this.mouth.scale.set(1, m, 1);
    }

    dispose() {
      this.scene.remove(this.group);
    }
  }

  TFW.Yeti = Yeti;
})(window);
