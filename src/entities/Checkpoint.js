/**
 * Checkpoint.js — a friendly banner gate that lights up when reached.
 *
 * Grey and dim until claimed, then it glows gold, spins its ring faster and
 * bobs happily. The GameManager uses its position + radius to detect arrival
 * and to respawn the player after a fall.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  class Checkpoint {
    constructor(scene, assets, def, groundY) {
      this.scene = scene;
      this.def = def;
      this.id = def.id;
      this.name = def.name;
      this.objective = def.objective;
      this.claimed = false;
      this._time = Math.random() * 10;

      this.position = new THREE.Vector3(def.x, groundY, def.z);
      this.radius = 4.2;

      const p = TFW.Config.Palette;
      this.group = new THREE.Group();
      this.group.position.copy(this.position);

      const postMat = new THREE.MeshStandardMaterial({ color: p.wood, roughness: 0.8, metalness: 0.05, map: assets.get('wood') });
      const postGeo = new THREE.CylinderGeometry(0.22, 0.28, 5.2, 10);
      const left = new THREE.Mesh(postGeo, postMat);
      left.position.set(-2.4, 2.6, 0);
      left.castShadow = true;
      const right = left.clone();
      right.position.x = 2.4;
      this.group.add(left, right);

      const beamGeo = new THREE.BoxGeometry(5.6, 0.5, 0.5);
      const beam = new THREE.Mesh(beamGeo, postMat);
      beam.position.y = 5.1;
      beam.castShadow = true;
      this.group.add(beam);

      // Glowing ring in the middle of the gate.
      this.ringMat = new THREE.MeshStandardMaterial({
        color: p.checkpointOff,
        emissive: p.checkpointOff,
        emissiveIntensity: 0.4,
        roughness: 0.35,
        metalness: 0.2,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.16, 12, 32), this.ringMat);
      ring.position.set(0, 2.9, 0);
      this.ring = ring;
      this.group.add(ring);

      // Little tricolour flag on top.
      const flagMat = new THREE.MeshStandardMaterial({ map: assets.get('flag'), side: THREE.DoubleSide, roughness: 0.7 });
      this.topFlag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85), flagMat);
      this.topFlag.position.set(0.85, 5.7, 0);
      this.group.add(this.topFlag);

      // Soft point light (off until claimed).
      this.light = new THREE.PointLight(p.checkpointOn, 0, 12, 2);
      this.light.position.set(0, 3, 0);
      this.group.add(this.light);

      scene.add(this.group);
    }

    activate() {
      if (this.claimed) return;
      this.claimed = true;
      const p = TFW.Config.Palette;
      this.ringMat.color.set(p.checkpointOn);
      this.ringMat.emissive.set(p.checkpointOn);
      this.ringMat.emissiveIntensity = 1.1;
      this.light.intensity = 1.6;
    }

    update(dt) {
      this._time += dt;
      const spin = this.claimed ? 1.8 : 0.5;
      this.ring.rotation.z += dt * spin;
      const bob = this.claimed ? 0.18 : 0.06;
      this.ring.position.y = 2.9 + Math.sin(this._time * 2) * bob;
      this.topFlag.rotation.y = Math.sin(this._time * 2.5) * 0.35;
      if (this.claimed) {
        this.light.intensity = 1.3 + Math.sin(this._time * 4) * 0.3;
      }
    }

    dispose() {
      this.scene.remove(this.group);
    }
  }

  TFW.Checkpoint = Checkpoint;
})(window);
