/**
 * Signboard.js — an interactable wooden board carrying an educational fact.
 *
 * When the player is within range the GameManager shows an "Interact (E)"
 * prompt; pressing E opens the sign popup with the board's title and text.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

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

      scene.add(this.group);
    }

    getInteractLabel() { return this.read ? 'Read again' : 'Read the sign'; }

    markRead() { this.read = true; }

    update(dt) {
      this._time += dt;
      this.badge.position.y = 3.55 + Math.sin(this._time * 2.4) * 0.08;
      this.badge.material.emissiveIntensity = 0.5 + Math.sin(this._time * 3) * 0.25;
    }

    dispose() {
      this.scene.remove(this.group);
      this.boardTex.dispose();
    }
  }

  TFW.Signboard = Signboard;
})(window);
