/**
 * Signboard.js — an interactable wooden board carrying an educational fact.
 *
 * When the player is within range the GameManager shows an "Interact (E)"
 * prompt; pressing E opens the sign popup with the board's title and text.
 *
 * A floating golden star hovers above every board as a "worth reading =
 * worth score" marker (see Config.gameplay.signScore / Config.signStar).
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  /** Flat 5-point star outline, extruded into a thin 3D coin-like shape. */
  function starGeometry(outerR, innerR, depth) {
    const shape = new THREE.Shape();
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      // Start pointing straight up.
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: depth * 0.28,
      bevelSize: depth * 0.22, bevelSegments: 2, curveSegments: 1,
    });
  }

  class Signboard {
    constructor(scene, assets, def, groundY) {
      this.scene = scene;
      this.def = def;
      this.id = def.id;
      this.title = def.title;
      this.text = def.text;
      this.read = false;
      this._time = Math.random() * 10;

      this.position = new THREE.Vector3(def.x, groundY, def.z);

      const p = TFW.Config.Palette;
      this.group = new THREE.Group();
      this.group.position.copy(this.position);
      // Face roughly back down the trail so the player reads it while climbing.
      this.group.rotation.y = def.rotationY || 0;

      const woodMat = new THREE.MeshStandardMaterial({ color: p.wood, roughness: 0.8, map: assets.get('wood') });

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 8), woodMat);
      post.position.y = 1.3;
      post.castShadow = true;
      this.group.add(post);

      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.16), woodMat);
      frame.position.y = 2.6;
      frame.castShadow = true;
      this.group.add(frame);

      const labelTex = TFW.AssetLoader.labelTexture(def.title, 'Press E to read');
      const boardMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.6 });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), boardMat);
      board.position.set(0, 2.6, 0.09);
      this.group.add(board);
      this.boardTex = labelTex;

      // Gentle glow badge so it reads as "important".
      const badgeMat = new THREE.MeshStandardMaterial({
        color: p.checkpointOn, emissive: p.checkpointOn, emissiveIntensity: 0.6, roughness: 0.4,
      });
      this.badge = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), badgeMat);
      this.badge.position.set(0, 3.55, 0.1);
      this.group.add(this.badge);

      this._buildStar(assets);

      scene.add(this.group);
    }

    /**
     * Floating golden star above the board — the "this earns you +score"
     * marker described in Config.gameplay.signScore. Sits above the frame's
     * top edge (frame is 1.5 tall centred at y=2.6, so the top is at y=3.35).
     */
    _buildStar(assets) {
      const cfg = TFW.Config.signStar;
      const p = TFW.Config.Palette;
      this._starBaseY = 2.6 + 1.5 / 2 + cfg.height;

      this.star = new THREE.Group();
      this.star.position.set(0, this._starBaseY, 0.1);
      this.group.add(this.star);

      this._starMat = new THREE.MeshStandardMaterial({
        color: p.coinGold, emissive: p.coinGold, emissiveIntensity: cfg.glowMin,
        roughness: 0.28, metalness: 0.55,
      });
      const geo = starGeometry(cfg.outerRadius, cfg.innerRadius, cfg.depth);
      const starMesh = new THREE.Mesh(geo, this._starMat);
      starMesh.position.z = -cfg.depth / 2;
      starMesh.castShadow = true;
      this.star.add(starMesh);

      // Soft additive halo behind the star so the glow reads even in daylight.
      const haloMat = new THREE.SpriteMaterial({
        map: assets.get('glow'), color: p.coinGold, transparent: true,
        opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this._haloMat = haloMat;
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(cfg.outerRadius * cfg.haloScale);
      this.star.add(halo);

      this._starLight = new THREE.PointLight(p.coinGold, cfg.lightIntensity, cfg.lightDistance, 2);
      this.star.add(this._starLight);
    }

    getInteractLabel() { return this.read ? 'Read again' : 'Read the sign'; }

    markRead() { this.read = true; }

    update(dt) {
      this._time += dt;
      this.badge.position.y = 3.55 + Math.sin(this._time * 2.4) * 0.08;
      this.badge.material.emissiveIntensity = 0.5 + Math.sin(this._time * 3) * 0.25;

      const cfg = TFW.Config.signStar;
      this.star.position.y = this._starBaseY + Math.sin(this._time * cfg.bobSpeed) * cfg.bobAmplitude;
      this.star.rotation.y += dt * cfg.spinSpeed;
      const glow = cfg.glowMin + (Math.sin(this._time * cfg.glowSpeed) * 0.5 + 0.5) * (cfg.glowMax - cfg.glowMin);
      this._starMat.emissiveIntensity = glow;
      this._haloMat.opacity = 0.55 + (glow - cfg.glowMin) / (cfg.glowMax - cfg.glowMin) * 0.35;
      this._starLight.intensity = cfg.lightIntensity * (glow / cfg.glowMax);
    }

    dispose() {
      this.scene.remove(this.group);
      this.boardTex.dispose();
      this._starMat.dispose();
      this._haloMat.dispose();
      this.star.children[0].geometry.dispose();
    }
  }

  TFW.Signboard = Signboard;
})(window);
