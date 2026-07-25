/**
 * Flag.js — the Indian National Flag with a procedurally waving cloth.
 *
 * The cloth is a segmented plane whose vertices are displaced every frame by
 * layered sine waves (stronger toward the free edge), giving a soft, toy-like
 * flutter. Used both for the flag the child carries and the large flag planted
 * at the summit.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  class Flag {
    /**
     * @param {AssetLoader} assets
     * @param {object} opts { poleHeight, clothWidth, clothHeight, withPole }
     */
    constructor(assets, opts) {
      const o = opts || {};
      this.group = new THREE.Group();
      this.poleHeight = o.poleHeight || 3.2;
      this.clothWidth = o.clothWidth || 2.4;
      this.clothHeight = o.clothHeight || 1.6;
      this.windStrength = 1;
      this._time = 0;

      const p = TFW.Config.Palette;

      if (o.withPole !== false) {
        const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, this.poleHeight, 12);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ef, roughness: 0.4, metalness: 0.5 });
        this.pole = new THREE.Mesh(poleGeo, poleMat);
        this.pole.position.y = this.poleHeight / 2;
        this.pole.castShadow = true;
        this.group.add(this.pole);

        const knobGeo = new THREE.SphereGeometry(0.13, 12, 10);
        const knobMat = new THREE.MeshStandardMaterial({ color: p.saffron, roughness: 0.3, metalness: 0.4, emissive: p.saffron, emissiveIntensity: 0.2 });
        const knob = new THREE.Mesh(knobGeo, knobMat);
        knob.position.y = this.poleHeight + 0.05;
        this.group.add(knob);
      }

      const segX = 24;
      const segY = 14;
      const clothGeo = new THREE.PlaneGeometry(this.clothWidth, this.clothHeight, segX, segY);
      this.clothGeo = clothGeo;
      this.baseCloth = clothGeo.attributes.position.array.slice();

      const clothTex = assets.get('flag');
      const clothMat = new THREE.MeshStandardMaterial({
        map: clothTex,
        side: THREE.DoubleSide,
        roughness: 0.72,
        metalness: 0.0,
        emissiveIntensity: 0.05,
      });
      this.cloth = new THREE.Mesh(clothGeo, clothMat);
      this.cloth.castShadow = true;
      // Anchor the cloth's left edge to the pole top, extending to +X.
      this.cloth.position.set(this.clothWidth / 2 + 0.06, this.poleHeight - this.clothHeight / 2 - 0.15, 0);
      this.group.add(this.cloth);
    }

    setWind(strength) { this.windStrength = strength; }

    update(dt) {
      this._time += dt;
      const pos = this.clothGeo.attributes.position;
      const base = this.baseCloth;
      const w = this.clothWidth;
      const t = this._time;
      const amp = 0.16 * this.windStrength;
      for (let i = 0; i < pos.count; i++) {
        const bx = base[i * 3];
        const by = base[i * 3 + 1];
        // 0 at the pole edge, 1 at the free edge → wave grows outward.
        const edge = (bx + w / 2) / w;
        const wave =
          Math.sin(bx * 3.0 - t * 6) * amp * edge +
          Math.sin(bx * 5.5 + by * 2.0 - t * 9) * amp * 0.5 * edge +
          Math.cos(by * 3.5 + t * 4) * amp * 0.25 * edge;
        pos.setZ(i, base[i * 3 + 2] + wave);
        pos.setY(i, by + Math.sin(bx * 2.0 - t * 5) * 0.04 * edge);
      }
      pos.needsUpdate = true;
      this.clothGeo.computeVertexNormals();
    }

    dispose() {
      this.clothGeo.dispose();
      this.cloth.material.dispose();
      if (this.pole) { this.pole.geometry.dispose(); this.pole.material.dispose(); }
    }
  }

  TFW.Flag = Flag;
})(window);
