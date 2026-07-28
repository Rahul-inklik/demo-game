/**
 * Bridge.js — the wooden "Chandani Gorge" crossing: a collapsing rope bridge.
 *
 * Walking onto the deck starts a short warning shake, then the planks give
 * way one by one, chasing the player forward across the span. There is no
 * special "you fell off the bridge" code path: once a plank starts to fall,
 * Bridge.contains() simply stops reporting a walkable surface for that
 * stretch, so Course.surfaceHeightAt() falls back to the raw (very deep)
 * chasm terrain underneath — the existing gravity/fall system in Player.js
 * and GameManager.onPlayerFall() takes over exactly as it does for any other
 * fall off the mountain (lose a life, respawn at the last checkpoint).
 *
 *   Player walks onto the bridge
 *     -> the deck shakes as a warning
 *     -> planks begin collapsing one by one, chasing the player forward
 *     -> reaches the far side in time -> nothing else happens, adventure continues
 *     -> falls through a gap -> normal fall handling kicks in (lose a life,
 *        respawn at the last checkpoint); reset() then restores every plank
 *        so the crossing is fair to attempt again.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp01, lerp } = TFW.Utils;

  class Bridge {
    constructor(scene, assets, config) {
      this.scene = scene;
      this.cfg = config.bridge || {};
      const p = config.Palette;

      // Span geometry — matches the gorge chasm carved into Terrain.js
      // (Config.chasms[0], from 84 to 108).
      this.z0 = 80; this.z1 = 112;
      this.y0 = 8.7; this.y1 = 12.8;
      this.cx = 3;
      this.halfW = 2.4;
      this.plankCount = 21;

      this.state = 'idle'; // idle | shaking | collapsing | collapsed
      this._time = 0;
      this._shakeT = 0;
      this._fallTimer = 0;
      this._nextFallIndex = 0;
      this._direction = 1;
      this._entryZ = this.z0;

      // Optional hooks the game wires up for audio/UI feedback.
      this.onShakeStart = null;
      this.onPlankFall = null;

      this.group = new THREE.Group();
      const woodMat = new THREE.MeshStandardMaterial({ color: p.wood, roughness: 0.85, map: assets.get('wood') });
      const darkWood = new THREE.MeshStandardMaterial({ color: p.woodDark, roughness: 0.85 });

      // Planks — kept as separate meshes (not merged) so each one can shake,
      // tip and drop independently. Each plank carries its own thin snow cap
      // (rather than one flat strip across the whole span) so the dusting
      // actually follows the bridge's slope and falls together with its plank
      // instead of floating above it as a flat sheet.
      const plankGeo = new THREE.BoxGeometry(this.halfW * 2 + 0.5, 0.18, 1.35);
      const snowCapGeo = new THREE.BoxGeometry(this.halfW * 2 + 0.2, 0.05, 1.2);
      const snowMat = new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.95 });
      this.planks = [];
      for (let i = 0; i < this.plankCount; i++) {
        const t = i / (this.plankCount - 1);
        const z = lerp(this.z0, this.z1, t);
        const basePos = new THREE.Vector3(this.cx, this.yAt(z) - 0.08 + Math.sin(t * Math.PI) * -0.25, z);
        const mesh = new THREE.Mesh(plankGeo, i % 2 ? darkWood : woodMat);
        mesh.position.copy(basePos);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        const snowCap = new THREE.Mesh(snowCapGeo, snowMat);
        snowCap.position.set(0, 0.115, 0); // sits just above the plank, in the plank's own local space
        mesh.add(snowCap);

        this.planks.push({ mesh, snowCap, z, basePos, falling: false, fallen: false, fallT: 0, fallDir: 1 });
      }

      // Rails: posts + rope. These stay standing even as the deck falls away
      // — it reads as "the deck gave way", not "the whole bridge vanished".
      const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 1.3, 8);
      const ropeMat = new THREE.MeshStandardMaterial({ color: 0xe9d9b8, roughness: 0.8 });
      const ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, this.z1 - this.z0, 6);
      [-1, 1].forEach((side) => {
        for (let i = 0; i < this.plankCount; i += 2) {
          const t = i / (this.plankCount - 1);
          const z = lerp(this.z0, this.z1, t);
          const post = new THREE.Mesh(postGeo, darkWood);
          post.position.set(this.cx + side * (this.halfW + 0.1), this.yAt(z) + 0.55, z);
          post.castShadow = true;
          this.group.add(post);
        }
        const rope = new THREE.Mesh(ropeGeo, ropeMat);
        const midZ = (this.z0 + this.z1) / 2;
        rope.position.set(this.cx + side * (this.halfW + 0.1), this.yAt(midZ) + 1.05, midZ);
        rope.rotation.x = Math.PI / 2 + Math.atan2(this.y1 - this.y0, this.z1 - this.z0);
        this.group.add(rope);
      });

      scene.add(this.group);
    }

    yAt(z) { return lerp(this.y0, this.y1, clamp01((z - this.z0) / (this.z1 - this.z0))); }

    _plankIndexAt(z) {
      const t = clamp01((z - this.z0) / (this.z1 - this.z0));
      return Math.round(t * (this.plankCount - 1));
    }

    /** Raw span bounds, ignoring plank state — used only to detect the player stepping on. */
    _inSpan(x, z) {
      return z >= this.z0 - 0.5 && z <= this.z1 + 0.5 && Math.abs(x - this.cx) <= this.halfW + 0.3;
    }

    /** Whether (x, z) is currently supported by an intact plank. */
    contains(x, z) {
      if (!this._inSpan(x, z)) return false;
      const pl = this.planks[this._plankIndexAt(z)];
      return !!pl && !pl.falling;
    }

    heightAt(x, z) { return this.yAt(z); }

    // ------------------------------------------------------------ sequence

    _startShake() {
      this.state = 'shaking';
      this._shakeT = 0;
      if (this.onShakeStart) this.onShakeStart();
    }

    _beginCollapse() {
      this.state = 'collapsing';
      this._fallTimer = 0;
      const entryIndex = this._plankIndexAt(this._entryZ);
      // Collapse away from the end the player entered from, chasing them
      // toward the far side.
      this._direction = entryIndex <= (this.plankCount - 1) / 2 ? 1 : -1;
      this._nextFallIndex = entryIndex;

      // Settle any planks that were only wobbling (never actually fell) back
      // to their resting pose before the collapse animation takes over.
      this.planks.forEach((pl) => {
        if (!pl.falling) {
          pl.mesh.rotation.set(0, 0, 0);
          pl.mesh.position.copy(pl.basePos);
        }
      });
    }

    _fallPlank(idx) {
      const pl = this.planks[idx];
      if (!pl || pl.falling || pl.fallen) return;
      pl.falling = true;
      pl.fallT = 0;
      pl.fallDir = Math.random() > 0.5 ? 1 : -1;
      if (this.onPlankFall) this.onPlankFall(pl.mesh.position);
    }

    update(dt, playerPos) {
      this._time += dt;
      const cfg = this.cfg;
      const shakeDuration = cfg.shakeDuration === undefined ? 1.1 : cfg.shakeDuration;
      const shakeAmp = cfg.shakeAmplitude === undefined ? 0.05 : cfg.shakeAmplitude;
      const fallInterval = cfg.plankFallInterval === undefined ? 0.22 : cfg.plankFallInterval;
      const fallDuration = cfg.plankFallDuration === undefined ? 0.9 : cfg.plankFallDuration;

      if (this.state === 'idle') {
        if (playerPos && this._inSpan(playerPos.x, playerPos.z)) {
          this._entryZ = playerPos.z;
          this._startShake();
        }
        return;
      }

      if (this.state === 'shaking') {
        this._shakeT += dt;
        for (let i = 0; i < this.planks.length; i++) {
          const pl = this.planks[i];
          const jitter = Math.sin(this._time * 30 + i * 1.7) * shakeAmp;
          pl.mesh.rotation.x = jitter;
          pl.mesh.position.y = pl.basePos.y + Math.sin(this._time * 37 + i) * shakeAmp * 0.4;
        }
        if (this._shakeT >= shakeDuration) {
          this._beginCollapse();
        }
        return;
      }

      // collapsing or collapsed: schedule new falls (if still collapsing) and
      // keep animating every plank that is mid-fall either way.
      if (this.state === 'collapsing') {
        this._fallTimer += dt;
        if (this._fallTimer >= fallInterval) {
          this._fallTimer = 0;
          if (this._nextFallIndex >= 0 && this._nextFallIndex < this.plankCount) {
            this._fallPlank(this._nextFallIndex);
            this._nextFallIndex += this._direction;
          } else {
            this.state = 'collapsed';
          }
        }
      }

      for (let i = 0; i < this.planks.length; i++) {
        const pl = this.planks[i];
        if (!pl.falling || pl.fallen) continue;
        pl.fallT += dt;
        const k = clamp01(pl.fallT / fallDuration);
        pl.mesh.rotation.x = pl.fallDir * k * (Math.PI * 0.55);
        pl.mesh.rotation.z = pl.fallDir * k * 0.35;
        pl.mesh.position.y = pl.basePos.y - k * k * 14;
        pl.mesh.position.x = pl.basePos.x + pl.fallDir * k * 1.6;
        if (k >= 1) {
          pl.fallen = true;
          pl.mesh.visible = false;
        }
      }
    }

    /** Restores every plank to its intact state — call on respawn/restart. */
    reset() {
      this.state = 'idle';
      this._shakeT = 0;
      this._fallTimer = 0;
      this.planks.forEach((pl) => {
        pl.falling = false;
        pl.fallen = false;
        pl.fallT = 0;
        pl.mesh.visible = true;
        pl.mesh.position.copy(pl.basePos);
        pl.mesh.rotation.set(0, 0, 0);
      });
    }

    dispose() {
      this.scene.remove(this.group);
    }
  }

  TFW.Bridge = Bridge;
})(window);
