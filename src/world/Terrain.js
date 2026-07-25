/**
 * Terrain.js — the procedural snow mountain.
 *
 * The climb runs along +Z. The shape is fully analytic so the game can sample
 * the exact ground height anywhere (`heightAt`) without raycasting:
 *   - `spine`      gives the base elevation along the climb,
 *   - `trailCurve` bends the walkable path left/right,
 *   - `corridor`   sets how wide the flat walkable band is,
 *   - `pads`       flatten key landings, and
 *   - `chasms`     carve deep gaps that bridges/ice platforms cross.
 * A single high-resolution mesh is built from the same function so what you see
 * is exactly what you walk on.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { sampleCurve, fbm, lerp, clamp01, pulse, smoothstep } = TFW.Utils;

  class Terrain {
    constructor(scene, assets, config) {
      this.scene = scene;
      this.cfg = config;

      // World extents (X is across the mountain, Z is the climb axis).
      this.minX = -180;
      this.maxX = 180;
      this.minZ = -160;
      this.maxZ = 470;
      this.segX = 220;
      this.segZ = 320;

      this.mesh = this._build(assets);
      scene.add(this.mesh);
    }

    /** Base (trail-floor) elevation along the climb, ignoring walls/noise. */
    baseElevationAt(z) {
      return sampleCurve(this.cfg.spine, z);
    }

    trailCenterX(z) {
      return sampleCurve(this.cfg.trailCurve, z);
    }

    corridorHalfWidth(z) {
      return sampleCurve(this.cfg.corridor, z);
    }

    /** Signed distance from the trail centre (positive = outside walkable band edge). */
    trailEdgeDistance(x, z) {
      const half = this.corridorHalfWidth(z);
      return Math.abs(x - this.trailCenterX(z)) - half;
    }

    isOnTrail(x, z, margin) {
      return this.trailEdgeDistance(x, z) <= (margin || 0);
    }

    /**
     * The authoritative ground height at (x, z). Bridges and ice platforms are
     * added on top by Course; this is the raw snow surface.
     */
    heightAt(x, z) {
      const base = this.baseElevationAt(z);
      const centerX = this.trailCenterX(z);
      const half = this.corridorHalfWidth(z);
      const dx = Math.abs(x - centerX);

      let h;
      if (dx <= half) {
        // Gentle rolling snow inside the walkable band.
        h = base + fbm(x * 0.05, z * 0.045, 3) * 1.15;
      } else {
        // Rising valley walls that visually funnel the player up the trail.
        const over = dx - half;
        const ramp = smoothstep(clamp01(over / 26));
        const wall = ramp * (14 + over * 0.9) + over * 0.4;
        const ridge = fbm(x * 0.03, z * 0.028, 4) * (6 + ramp * 22);
        h = base + wall + ridge;
      }

      // Carve chasms straight across the trail (before pads, so that the
      // forced-flat landing pads below always win and stay solid).
      const chasms = this.cfg.chasms;
      for (let i = 0; i < chasms.length; i++) {
        const c = chasms[i];
        if (z > c.from - c.feather && z < c.to + c.feather && dx < half + 6) {
          const across = smoothstep(clamp01((half + 6 - dx) / 6));
          const along = pulse(z, c.from - c.feather, c.to + c.feather, c.feather);
          h -= c.depth * along * across;
        }
      }

      // Forced-flat pads (landings, bridge heads, plateaus) applied last so a
      // pad is always safe, level ground even where it borders a chasm.
      const pads = this.cfg.pads;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        const influence = this._padInfluence(p, x, z);
        if (influence > 0) h = lerp(h, p.y, influence);
      }

      return h;
    }

    _padInfluence(pad, x, z) {
      const halfW = pad.w * 0.5;
      const halfD = pad.d * 0.5;
      const f = pad.feather || 4;
      const inX = smoothstep(clamp01((halfW + f - Math.abs(x - pad.x)) / f));
      const inZ = smoothstep(clamp01((halfD + f - Math.abs(z - pad.z)) / f));
      return Math.min(inX, inZ);
    }

    /** Approximate surface normal via finite differences (for slope-aware logic). */
    normalAt(x, z, out) {
      const e = 1.2;
      const hL = this.heightAt(x - e, z);
      const hR = this.heightAt(x + e, z);
      const hD = this.heightAt(x, z - e);
      const hU = this.heightAt(x, z + e);
      out.set(hL - hR, 2 * e, hD - hU).normalize();
      return out;
    }

    // ---------------------------------------------------------------- mesh

    _build(assets) {
      const geo = new THREE.PlaneGeometry(
        this.maxX - this.minX,
        this.maxZ - this.minZ,
        this.segX,
        this.segZ
      );
      geo.rotateX(-Math.PI / 2);

      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const offsetX = (this.minX + this.maxX) / 2;
      const offsetZ = (this.minZ + this.maxZ) / 2;

      const snow = new THREE.Color(this.cfg.Palette.snowLight);
      const shade = new THREE.Color(this.cfg.Palette.snowShade);
      const rock = new THREE.Color(this.cfg.Palette.rockLight);
      const ice = new THREE.Color(this.cfg.Palette.ice);
      const tmp = new THREE.Color();
      const nrm = new THREE.Vector3();

      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + offsetX;
        const z = pos.getZ(i) + offsetZ;
        const h = this.heightAt(x, z);
        pos.setX(i, x);
        pos.setZ(i, z);
        pos.setY(i, h);

        // Vertex colouring: snow on gentle ground, rock on steep walls,
        // a faint icy tint down inside the chasms.
        this.normalAt(x, z, nrm);
        const steep = clamp01((0.82 - nrm.y) / 0.5);
        const edge = this.trailEdgeDistance(x, z);
        const base = this.baseElevationAt(z);
        const depthBelow = clamp01((base - h) / 30);

        tmp.copy(snow).lerp(shade, clamp01(edge / 40) * 0.6);
        tmp.lerp(rock, steep * 0.85);
        tmp.lerp(ice, depthBelow * 0.5);
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      const snowTex = assets.get('snow');
      snowTex.repeat.set(48, 84);

      const mat = new THREE.MeshStandardMaterial({
        map: snowTex,
        vertexColors: true,
        roughness: 0.94,
        metalness: 0.0,
        envMapIntensity: 0.35,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'terrain';
      return mesh;
    }

    dispose() {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
  }

  TFW.Terrain = Terrain;
})(window);
