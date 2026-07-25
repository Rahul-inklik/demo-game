/**
 * Course.js — assembles the whole playable level on top of the Terrain.
 *
 * Owns the terrain, the walkable platforms (wooden bridge + floating ice
 * platforms that cross the two chasms) and all decoration (pine forests, snow
 * rocks, base camp, summit shrine). It also builds the checkpoints and
 * signboards and exposes the combined walkable surface via `surfaceHeightAt`.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp01, lerp, randRange, makeRandom, smoothstep } = TFW.Utils;

  class Course {
    constructor(scene, assets, config) {
      this.scene = scene;
      this.assets = assets;
      this.cfg = config;
      this.rng = makeRandom(1337);

      this.platforms = [];        // { contains(x,z), heightAt(x,z) }
      this.collisionMeshes = [];  // for camera collision raycasts
      this.trees = [];            // swaying pines
      this.props = [];            // misc animated props (fire, prayer flags)
      this.summitFlags = [];      // decorative prayer flags at the top
      this.birds = [];            // gliding birds in the sky
      this.twinklers = [];        // ice crystals that shimmer

      // Population budgets come from the device tier (see DeviceProfile).
      this.q = config.quality || {};
      this.decor = this.q.decorScale === undefined ? 1 : this.q.decorScale;

      this.terrain = new TFW.Terrain(scene, assets, config);
      this.collisionMeshes.push(this.terrain.mesh);

      this._sharedGeo = {};
      this._sharedMat = {};

      this._buildDistantPeaks();
      this._buildBridge();
      this._buildIcePlatforms();
      this._buildBaseCamp();
      this._buildForest();
      this._buildRocks();
      this._buildTrailDecor();
      this._buildSummit();
      this._buildBirds();

      this.checkpoints = this._buildCheckpoints();
      this.signboards = this._buildSignboards();

      this._time = 0;
    }

    // --------------------------------------------------------- surface query

    baseElevationAt(z) { return this.terrain.baseElevationAt(z); }

    /** Highest walkable surface at (x, z): terrain, or a platform above it. */
    surfaceHeightAt(x, z) {
      let y = this.terrain.heightAt(x, z);
      let type = 'snow';
      for (let i = 0; i < this.platforms.length; i++) {
        const pf = this.platforms[i];
        if (pf.contains(x, z)) {
          const py = pf.heightAt(x, z);
          if (py > y) { y = py; type = pf.type; }
        }
      }
      return { y, type };
    }

    // --------------------------------------------------------- bridge

    _buildBridge() {
      const p = this.cfg.Palette;
      const chasm = this.cfg.chasms[0]; // 84 → 108
      const z0 = 80, z1 = 112;
      const y0 = 8.7, y1 = 12.8;
      const cx = 3;
      const halfW = 2.4;

      const yAt = (z) => lerp(y0, y1, clamp01((z - z0) / (z1 - z0)));

      const group = new THREE.Group();
      const woodMat = new THREE.MeshStandardMaterial({ color: p.wood, roughness: 0.85, map: this.assets.get('wood') });
      const darkWood = new THREE.MeshStandardMaterial({ color: p.woodDark, roughness: 0.85 });

      // Planks.
      const plankGeo = new THREE.BoxGeometry(halfW * 2 + 0.5, 0.18, 1.35);
      const planks = 21;
      for (let i = 0; i < planks; i++) {
        const t = i / (planks - 1);
        const z = lerp(z0, z1, t);
        const plank = new THREE.Mesh(plankGeo, i % 2 ? darkWood : woodMat);
        plank.position.set(cx, yAt(z) - 0.08 + Math.sin(t * Math.PI) * -0.25, z);
        plank.castShadow = true;
        plank.receiveShadow = true;
        group.add(plank);
      }

      // Snow dusting over the deck.
      const snowStripGeo = new THREE.BoxGeometry(halfW * 2 + 0.2, 0.06, z1 - z0);
      const snowStrip = new THREE.Mesh(snowStripGeo, new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.95 }));
      snowStrip.position.set(cx, yAt((z0 + z1) / 2) + 0.02 - 0.12, (z0 + z1) / 2);
      group.add(snowStrip);

      // Rails: posts + rope.
      const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 1.3, 8);
      const ropeMat = new THREE.MeshStandardMaterial({ color: 0xe9d9b8, roughness: 0.8 });
      const ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, z1 - z0, 6);
      [-1, 1].forEach((side) => {
        for (let i = 0; i < planks; i += 2) {
          const t = i / (planks - 1);
          const z = lerp(z0, z1, t);
          const post = new THREE.Mesh(postGeo, darkWood);
          post.position.set(cx + side * (halfW + 0.1), yAt(z) + 0.55, z);
          post.castShadow = true;
          group.add(post);
        }
        const rope = new THREE.Mesh(ropeGeo, ropeMat);
        rope.rotation.x = Math.PI / 2;
        const midZ = (z0 + z1) / 2;
        rope.position.set(cx + side * (halfW + 0.1), yAt(midZ) + 1.05, midZ);
        // tilt rope to follow the slope
        rope.rotation.x = Math.PI / 2 + Math.atan2(y1 - y0, z1 - z0);
        group.add(rope);
      });

      this.scene.add(group);
      this.collisionMeshes.push(group);

      this.platforms.push({
        type: 'wood',
        contains: (x, z) => z >= z0 - 0.5 && z <= z1 + 0.5 && Math.abs(x - cx) <= halfW + 0.3,
        heightAt: (x, z) => yAt(z),
      });

      // A little frozen river glinting at the bottom of the gorge.
      const iceMat = new THREE.MeshStandardMaterial({
        map: this.assets.get('ice'), color: 0xdff6ff, roughness: 0.2, metalness: 0.3,
        transparent: true, opacity: 0.92,
      });
      const river = new THREE.Mesh(new THREE.PlaneGeometry(38, chasm.to - chasm.from + 14), iceMat);
      river.rotation.x = -Math.PI / 2;
      river.position.set(cx, this.terrain.baseElevationAt((chasm.from + chasm.to) / 2) - chasm.depth + 1.5, (chasm.from + chasm.to) / 2);
      this.scene.add(river);
    }

    // --------------------------------------------------------- ice platforms

    _buildIcePlatforms() {
      const p = this.cfg.Palette;
      const specs = [
        { z: 247, y: 66.2, r: 3.3 },
        { z: 254, y: 68.1, r: 3.2 },
        { z: 261, y: 70.0, r: 3.4 },
        { z: 268, y: 71.9, r: 3.2 },
        { z: 275, y: 73.8, r: 3.3 },
        { z: 281, y: 75.4, r: 3.6 },
      ];
      const iceMat = new THREE.MeshStandardMaterial({
        map: this.assets.get('ice'), color: 0xffffff, roughness: 0.28, metalness: 0.25,
        transparent: true, opacity: 0.95, envMapIntensity: 0.8,
      });
      const capMat = new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.95 });

      specs.forEach((s) => {
        const cx = this.terrain.trailCenterX(s.z);
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r * 0.7, 2.6, 6), iceMat);
        body.position.set(cx, s.y - 1.3, s.z);
        body.castShadow = true;
        body.receiveShadow = true;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(s.r + 0.08, s.r + 0.02, 0.4, 6), capMat);
        cap.position.set(cx, s.y - 0.1, s.z);
        g.add(body, cap);
        this.scene.add(g);
        this.collisionMeshes.push(body);

        this.platforms.push({
          type: 'ice',
          contains: (x, z) => ((x - cx) * (x - cx) + (z - s.z) * (z - s.z)) <= (s.r + 0.2) * (s.r + 0.2),
          heightAt: () => s.y,
        });
      });
    }

    // --------------------------------------------------------- base camp

    _buildBaseCamp() {
      const p = this.cfg.Palette;
      const tents = [
        { x: -12, z: -20, color: p.tent, rot: 0.3 },
        { x: 13, z: -22, color: p.tentAlt, rot: -0.4 },
        { x: -16, z: -6, color: p.tentAlt, rot: 0.8 },
      ];
      tents.forEach((t) => this._makeTent(t.x, t.z, t.color, t.rot));

      // Campfire with a warm flickering light.
      const fx = 2, fz = -24;
      const fy = this.surfaceHeightAt(fx, fz).y;
      const stoneMat = new THREE.MeshStandardMaterial({ color: p.rockDark, roughness: 0.9 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32), stoneMat);
        s.position.set(fx + Math.cos(a) * 0.9, fy + 0.15, fz + Math.sin(a) * 0.9);
        this.scene.add(s);
      }
      const logMat = new THREE.MeshStandardMaterial({ color: p.woodDark, roughness: 0.9 });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), logMat);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (i / 3) * Math.PI;
        log.position.set(fx, fy + 0.2, fz);
        this.scene.add(log);
      }
      const flameMat = new THREE.MeshStandardMaterial({ color: p.fire, emissive: p.fire, emissiveIntensity: 1.4, roughness: 0.5 });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 8), flameMat);
      flame.position.set(fx, fy + 0.75, fz);
      this.scene.add(flame);
      const fire = new THREE.PointLight(p.fire, 2.2, 16, 2);
      fire.position.set(fx, fy + 1.2, fz);
      this.scene.add(fire);
      this.props.push({ kind: 'fire', flame, light: fire, x: fx, y: fy, z: fz });

      // Welcome arch banner at the very start.
      const startY = this.surfaceHeightAt(0, -30).y;
      const bannerMat = new THREE.MeshStandardMaterial({ color: p.saffron, roughness: 0.7, side: THREE.DoubleSide });
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), bannerMat);
      banner.position.set(0, startY + 5.2, -30);
      this.scene.add(banner);
      const woodMat = new THREE.MeshStandardMaterial({ color: p.wood, roughness: 0.85, map: this.assets.get('wood') });
      [-4.6, 4.6].forEach((dx) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 6, 8), woodMat);
        post.position.set(dx, startY + 3, -30);
        post.castShadow = true;
        this.scene.add(post);
      });
    }

    _makeTent(x, z, color, rot) {
      const y = this.surfaceHeightAt(x, z).y;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.6, 4), mat);
      body.rotation.y = Math.PI / 4;
      body.position.y = 1.3;
      body.castShadow = true;
      g.add(body);
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.9 });
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), doorMat);
      door.position.set(0, 0.7, 1.45);
      g.add(door);
      g.position.set(x, y, z);
      g.rotation.y = rot;
      this.scene.add(g);
    }

    // --------------------------------------------------------- forest

    _getPineParts() {
      if (this._sharedGeo.pineTrunk) return;
      const p = this.cfg.Palette;
      this._sharedGeo.pineTrunk = new THREE.CylinderGeometry(0.28, 0.4, 2.2, 7);
      this._sharedGeo.pineCone = new THREE.ConeGeometry(1, 1, 8);
      this._sharedGeo.pineSnow = new THREE.ConeGeometry(0.62, 0.5, 8);
      this._sharedMat.trunk = new THREE.MeshStandardMaterial({ color: p.woodDark, roughness: 0.9 });
      this._sharedMat.pineDark = new THREE.MeshStandardMaterial({ color: p.pineDark, roughness: 0.85 });
      this._sharedMat.pineMid = new THREE.MeshStandardMaterial({ color: p.pineMid, roughness: 0.85 });
      this._sharedMat.pineLight = new THREE.MeshStandardMaterial({ color: p.pineLight, roughness: 0.85 });
      this._sharedMat.pineSnow = new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.95 });
    }

    _makePine(x, y, z, scale) {
      this._getPineParts();
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(this._sharedGeo.pineTrunk, this._sharedMat.trunk);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      g.add(trunk);

      const tiers = 3;
      const greens = [this._sharedMat.pineDark, this._sharedMat.pineMid, this._sharedMat.pineLight];
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const cone = new THREE.Mesh(this._sharedGeo.pineCone, greens[i]);
        const r = 2.1 - i * 0.5;
        const h = 2.4 - i * 0.4;
        cone.scale.set(r, h, r);
        cone.position.y = 2.2 + i * 1.5;
        cone.castShadow = true;
        g.add(cone);
        // snow cap on each tier
        const snow = new THREE.Mesh(this._sharedGeo.pineSnow, this._sharedMat.pineSnow);
        snow.scale.set(r * 0.95, h * 0.5, r * 0.95);
        snow.position.y = 2.2 + i * 1.5 + h * 0.42;
        g.add(snow);
      }
      g.position.set(x, y, z);
      g.scale.setScalar(scale);
      g.rotation.y = this.rng() * Math.PI * 2;
      this.scene.add(g);
      this.trees.push({ group: g, phase: this.rng() * Math.PI * 2, amp: randRange(0.015, 0.04) / scale, baseRot: g.rotation.x });
    }

    _buildForest() {
      // Dense band of pines flanking the trail through the lower/mid mountain.
      const target = this.q.trees || 200;
      let placed = 0;
      let attempts = 0;
      while (placed < target && attempts < target * 20) {
        attempts++;
        const z = randRange(-150, 210);
        const centerX = this.terrain.trailCenterX(z);
        const half = this.terrain.corridorHalfWidth(z);
        const side = this.rng() > 0.5 ? 1 : -1;
        const off = randRange(3, 34);
        const x = centerX + side * (half + off);
        const surf = this.surfaceHeightAt(x, z);
        const base = this.terrain.baseElevationAt(z);
        // Skip chasms and over-steep faces.
        if (surf.y < base - 6) continue;
        if (surf.y > base + 40) continue;
        this._makePine(x, surf.y - 0.2, z, randRange(0.7, 1.5));
        placed++;
      }
    }

    // --------------------------------------------------------- rocks

    _buildRocks() {
      const p = this.cfg.Palette;
      const rockMat = new THREE.MeshStandardMaterial({ map: this.assets.get('rock'), color: p.rockLight, roughness: 0.92 });
      const snowMat = new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.95 });
      const geo = new THREE.DodecahedronGeometry(1, 0);

      const target = this.q.rocks || 85;
      let placed = 0;
      let attempts = 0;
      while (placed < target && attempts < target * 24) {
        attempts++;
        const z = randRange(-140, 330);
        const centerX = this.terrain.trailCenterX(z);
        const half = this.terrain.corridorHalfWidth(z);
        const side = this.rng() > 0.5 ? 1 : -1;
        const off = randRange(1, 26);
        const x = centerX + side * (half + off);
        const surf = this.surfaceHeightAt(x, z);
        const base = this.terrain.baseElevationAt(z);
        if (surf.y < base - 6) continue;

        const s = randRange(0.9, 3.4);
        const rock = new THREE.Mesh(geo, rockMat);
        rock.scale.set(s * randRange(0.8, 1.3), s * randRange(0.7, 1.1), s * randRange(0.8, 1.3));
        rock.rotation.set(this.rng() * Math.PI, this.rng() * Math.PI, this.rng() * Math.PI);
        rock.position.set(x, surf.y + s * 0.3, z);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.scene.add(rock);
        if (s > 1.8) this.collisionMeshes.push(rock);

        // Snow cap on top.
        const cap = new THREE.Mesh(geo, snowMat);
        cap.scale.set(s * 0.9, s * 0.4, s * 0.9);
        cap.position.set(x, surf.y + s * 0.75, z);
        cap.rotation.copy(rock.rotation);
        this.scene.add(cap);
        placed++;
      }
    }

    // --------------------------------------------------------- distant peaks

    /** A majestic ring of far-off Himalayan peaks for depth and scale. */
    _buildDistantPeaks() {
      const p = this.cfg.Palette;
      const rockMat = new THREE.MeshStandardMaterial({ color: p.rockDark, roughness: 0.95, fog: true });
      const snowMat = new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.9, fog: true });
      const peakGeo = new THREE.ConeGeometry(1, 1, 6);

      const group = new THREE.Group();
      const cx = 0, cz = 150; // roughly the middle of the climb

      const rings = [
        { count: 14, rMin: 230, rMax: 300, hMin: 70, hMax: 150, base: -8 },
        { count: 10, rMin: 320, rMax: 400, hMin: 110, hMax: 210, base: -20 },
      ];
      const peakScale = this.q.distantPeaks === undefined ? 1 : this.q.distantPeaks;
      rings.forEach((ring) => {
        const total = Math.max(5, Math.round(ring.count * peakScale));
        for (let i = 0; i < total; i++) {
          const a = (i / total) * Math.PI * 2 + this.rng() * 0.3;
          const rad = randRange(ring.rMin, ring.rMax);
          const x = cx + Math.cos(a) * rad;
          const z = cz + Math.sin(a) * rad;
          const h = randRange(ring.hMin, ring.hMax);
          const w = h * randRange(0.55, 0.85);

          const peak = new THREE.Mesh(peakGeo, rockMat);
          peak.scale.set(w, h, w);
          peak.position.set(x, ring.base + h / 2, z);
          peak.rotation.y = this.rng() * Math.PI;
          group.add(peak);

          // Snow cap.
          const cap = new THREE.Mesh(peakGeo, snowMat);
          const ch = h * randRange(0.32, 0.5);
          cap.scale.set(w * 0.72, ch, w * 0.72);
          cap.position.set(x, ring.base + h - ch / 2, z);
          cap.rotation.y = peak.rotation.y;
          group.add(cap);
        }
      });

      // A grand massif rising behind the summit.
      const massif = new THREE.Mesh(peakGeo, rockMat);
      massif.scale.set(220, 260, 180);
      massif.position.set(-30, 40, 470);
      group.add(massif);
      const massifCap = new THREE.Mesh(peakGeo, snowMat);
      massifCap.scale.set(150, 110, 130);
      massifCap.position.set(-30, 40 + 130 - 55, 470);
      group.add(massifCap);

      group.traverse((m) => { if (m.isMesh || m.geometry) { m.castShadow = false; m.receiveShadow = false; } });
      this.scene.add(group);
    }

    // --------------------------------------------------------- trail decor

    /** Cairns, snow mounds, ice crystals, frozen bushes and rope fences. */
    _buildTrailDecor() {
      const p = this.cfg.Palette;
      const stoneMat = new THREE.MeshStandardMaterial({ color: p.rockDark, roughness: 0.9 });
      const stoneLight = new THREE.MeshStandardMaterial({ color: p.rockLight, roughness: 0.92 });
      const snowMat = new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.95 });
      const crystalMat = new THREE.MeshStandardMaterial({
        color: p.ice, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85,
        emissive: p.iceDeep, emissiveIntensity: 0.35,
      });
      const bushMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ea, roughness: 0.85 });
      const woodMat = new THREE.MeshStandardMaterial({ color: p.woodDark, roughness: 0.85 });
      const ropeMat = new THREE.MeshStandardMaterial({ color: 0xe9d9b8, roughness: 0.8 });

      const spot = (zMin, zMax, offMin, offMax) => {
        for (let tries = 0; tries < 12; tries++) {
          const z = randRange(zMin, zMax);
          const centerX = this.terrain.trailCenterX(z);
          const half = this.terrain.corridorHalfWidth(z);
          const side = this.rng() > 0.5 ? 1 : -1;
          const x = centerX + side * (half + randRange(offMin, offMax));
          const surf = this.surfaceHeightAt(x, z);
          if (surf.y < this.terrain.baseElevationAt(z) - 6) continue; // skip chasms
          return { x, y: surf.y, z, side };
        }
        return null;
      };

      // Decoration counts scale with the device tier (keep at least a few so
      // the trail still reads the same on a phone).
      const n = (full) => Math.max(2, Math.round(full * this.decor));

      // Cairns (stacked-stone trail markers) along the whole climb.
      for (let i = 0; i < n(12); i++) {
        const s = spot(-120, 300, 1.5, 6);
        if (!s) continue;
        const cairn = new THREE.Group();
        let y = 0;
        const layers = 3 + Math.floor(this.rng() * 3);
        for (let k = 0; k < layers; k++) {
          const r = 0.4 - k * 0.05;
          const hgt = 0.18 + this.rng() * 0.08;
          const stone = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, hgt, 8), k % 2 ? stoneLight : stoneMat);
          stone.position.y = y + hgt / 2;
          stone.rotation.y = this.rng() * Math.PI;
          stone.castShadow = true;
          cairn.add(stone);
          y += hgt;
        }
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), snowMat);
        cap.scale.set(1, 0.5, 1);
        cap.position.y = y;
        cairn.add(cap);
        cairn.position.set(s.x, s.y, s.z);
        this.scene.add(cairn);
      }

      // Rounded snow mounds.
      for (let i = 0; i < n(44); i++) {
        const s = spot(-130, 320, 0, 20);
        if (!s) continue;
        const r = randRange(0.8, 2.6);
        const mound = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), snowMat);
        mound.scale.set(1, randRange(0.4, 0.6), 1);
        mound.position.set(s.x, s.y + r * 0.1, s.z);
        mound.receiveShadow = true;
        this.scene.add(mound);
      }

      // Frozen bushes.
      for (let i = 0; i < n(34); i++) {
        const s = spot(-140, 210, 1, 22);
        if (!s) continue;
        const bush = new THREE.Group();
        const blobs = 3 + Math.floor(this.rng() * 3);
        for (let k = 0; k < blobs; k++) {
          const r = randRange(0.2, 0.45);
          const b = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 7), bushMat);
          b.position.set(randRange(-0.3, 0.3), r * 0.6, randRange(-0.3, 0.3));
          bush.add(b);
          const snow = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 8, 6), snowMat);
          snow.position.set(b.position.x, r, b.position.z);
          bush.add(snow);
        }
        bush.position.set(s.x, s.y, s.z);
        this.scene.add(bush);
      }

      // Sparkling ice crystals, denser near the ice field.
      for (let i = 0; i < n(34); i++) {
        const nearIce = this.rng() > 0.5;
        const s = nearIce ? spot(210, 300, 0, 16) : spot(60, 320, 1, 22);
        if (!s) continue;
        const cmat = crystalMat.clone(); // own material so each cluster twinkles independently
        const cluster = new THREE.Group();
        const shards = 2 + Math.floor(this.rng() * 3);
        for (let k = 0; k < shards; k++) {
          const hgt = randRange(0.5, 1.5);
          const shard = new THREE.Mesh(new THREE.ConeGeometry(hgt * 0.22, hgt, 5), cmat);
          shard.position.set(randRange(-0.3, 0.3), hgt / 2, randRange(-0.3, 0.3));
          shard.rotation.set(randRange(-0.2, 0.2), this.rng() * Math.PI, randRange(-0.2, 0.2));
          cluster.add(shard);
        }
        cluster.position.set(s.x, s.y, s.z);
        this.scene.add(cluster);
        this.twinklers.push({ mat: cmat, phase: this.rng() * Math.PI * 2 });
      }

      // Rope safety fences along the exposed high ridge.
      for (let i = 0; i < n(9); i++) {
        const s = spot(150, 300, 0.5, 3);
        if (!s) continue;
        const fence = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 6), woodMat);
          post.position.set(k * 0.9, 0.5, 0);
          post.castShadow = true;
          fence.add(post);
        }
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), ropeMat);
        rope.rotation.z = Math.PI / 2;
        rope.position.set(0.9, 0.7, 0);
        fence.add(rope);
        fence.position.set(s.x, s.y, s.z);
        fence.rotation.y = this.rng() * Math.PI;
        this.scene.add(fence);
      }
    }

    // --------------------------------------------------------- birds

    _buildBirds() {
      const birdMat = new THREE.MeshStandardMaterial({ color: 0x394452, roughness: 0.8 });
      const wingGeo = new THREE.BoxGeometry(1.2, 0.06, 0.4);
      const birdCount = this.q.birds === undefined ? 6 : this.q.birds;
      for (let i = 0; i < birdCount; i++) {
        const bird = new THREE.Group();
        const wingL = new THREE.Mesh(wingGeo, birdMat);
        wingL.position.x = -0.6;
        const wingR = new THREE.Mesh(wingGeo, birdMat);
        wingR.position.x = 0.6;
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), birdMat);
        body.scale.set(1, 0.7, 1.8);
        bird.add(wingL, wingR, body);

        const s = randRange(1.2, 2.2);
        bird.scale.setScalar(s);
        bird.position.set(randRange(-120, 120), randRange(40, 80), randRange(-60, 340));
        this.scene.add(bird);
        this.birds.push({
          group: bird, wingL, wingR,
          speed: randRange(6, 12) * (this.rng() > 0.5 ? 1 : -1),
          radius: randRange(40, 100), cx: bird.position.x, cz: bird.position.z,
          angle: this.rng() * Math.PI * 2, flap: this.rng() * Math.PI * 2, bobY: bird.position.y,
        });
      }
    }

    // --------------------------------------------------------- summit

    _buildSummit() {
      const p = this.cfg.Palette;
      const pole = this.cfg.summit.flagPole;
      const gy = this.surfaceHeightAt(pole.x, pole.z).y;
      this.summitGroundY = gy;

      // Stone base for the flag pole.
      const stoneMat = new THREE.MeshStandardMaterial({ color: p.rockDark, roughness: 0.9 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.2, 1.0, 10), stoneMat);
      base.position.set(pole.x, gy + 0.5, pole.z);
      base.castShadow = true;
      base.receiveShadow = true;
      this.scene.add(base);

      const ringMat = new THREE.MeshStandardMaterial({ color: p.snowLight, roughness: 0.95 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.25, 10, 24), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(pole.x, gy + 0.15, pole.z);
      this.scene.add(ring);

      // Bare flag pole (the child plants the flag here at the end).
      const poleMat = new THREE.MeshStandardMaterial({ color: 0xe4ebf4, roughness: 0.35, metalness: 0.55 });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, this.cfg.summit.poleHeight, 12), poleMat);
      mast.position.set(pole.x, gy + 1 + this.cfg.summit.poleHeight / 2, pole.z);
      mast.castShadow = true;
      this.scene.add(mast);
      this.summitMast = mast;
      this.summitPoleTop = new THREE.Vector3(pole.x, gy + 1 + this.cfg.summit.poleHeight, pole.z);
      this.summitFlagAnchor = new THREE.Vector3(pole.x, gy + 1, pole.z);

      // Decorative prayer-flag lines radiating from the summit.
      const flagColors = [p.saffron, 0xffffff, p.green, p.tentAlt, p.checkpointOn];
      for (let line = 0; line < 4; line++) {
        const a = (line / 4) * Math.PI * 2 + 0.4;
        const endX = pole.x + Math.cos(a) * 16;
        const endZ = pole.z + Math.sin(a) * 16;
        const endY = this.surfaceHeightAt(endX, endZ).y + randRange(1, 3);
        const anchorMat = new THREE.MeshStandardMaterial({ color: p.woodDark, roughness: 0.9 });
        const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3, 6), anchorMat);
        anchor.position.set(endX, endY, endZ);
        this.scene.add(anchor);
        const count = 10;
        for (let i = 1; i < count; i++) {
          const t = i / count;
          const fx = lerp(pole.x, endX, t);
          const fz = lerp(pole.z, endZ, t);
          const droop = Math.sin(t * Math.PI) * 1.2;
          const fy = lerp(this.summitPoleTop.y - 0.5, endY + 1.5, t) - droop;
          const mat = new THREE.MeshStandardMaterial({ color: flagColors[i % flagColors.length], side: THREE.DoubleSide, roughness: 0.8 });
          const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), mat);
          flag.position.set(fx, fy, fz);
          flag.rotation.y = a + Math.PI / 2;
          this.scene.add(flag);
          this.summitFlags.push({ mesh: flag, phase: this.rng() * Math.PI * 2 });
        }
      }
    }

    // --------------------------------------------------------- entities

    _buildCheckpoints() {
      return this.cfg.checkpoints.map((def) => {
        const gy = this.surfaceHeightAt(def.x, def.z).y;
        return new TFW.Checkpoint(this.scene, this.assets, def, gy);
      });
    }

    _buildSignboards() {
      return this.cfg.signboards.map((def) => {
        const gy = this.surfaceHeightAt(def.x, def.z).y;
        return new TFW.Signboard(this.scene, this.assets, def, gy);
      });
    }

    // --------------------------------------------------------- update

    update(dt, windStrength) {
      this._time += dt;
      const wind = windStrength || 1;

      // Sway the pines.
      for (let i = 0; i < this.trees.length; i++) {
        const tr = this.trees[i];
        const s = Math.sin(this._time * 1.4 + tr.phase);
        tr.group.rotation.x = s * tr.amp * wind;
        tr.group.rotation.z = Math.cos(this._time * 1.1 + tr.phase) * tr.amp * 0.7 * wind;
      }

      // Flicker the campfire.
      for (let i = 0; i < this.props.length; i++) {
        const pr = this.props[i];
        if (pr.kind === 'fire') {
          const f = 0.75 + Math.sin(this._time * 13 + 1) * 0.15 + Math.sin(this._time * 27) * 0.1;
          pr.light.intensity = 1.8 + f;
          pr.flame.scale.set(0.9 + f * 0.15, 0.85 + Math.sin(this._time * 18) * 0.2, 0.9 + f * 0.15);
          pr.flame.rotation.y += dt * 3;
        }
      }

      // Ripple the prayer flags.
      for (let i = 0; i < this.summitFlags.length; i++) {
        const sf = this.summitFlags[i];
        sf.mesh.rotation.z = Math.sin(this._time * 3 + sf.phase) * 0.3 * wind;
      }

      // Glide the birds in slow circles with flapping wings.
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i];
        b.angle += (b.speed / b.radius) * dt;
        b.group.position.x = b.cx + Math.cos(b.angle) * b.radius;
        b.group.position.z = b.cz + Math.sin(b.angle) * b.radius;
        b.group.position.y = b.bobY + Math.sin(this._time * 0.6 + b.flap) * 3;
        b.group.rotation.y = -b.angle + (b.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
        b.flap += dt * 9;
        const f = Math.sin(b.flap) * 0.6;
        b.wingL.rotation.z = f;
        b.wingR.rotation.z = -f;
      }

      // Shimmer the ice crystals.
      for (let i = 0; i < this.twinklers.length; i++) {
        const t = this.twinklers[i];
        t.mat.emissiveIntensity = 0.25 + (Math.sin(this._time * 3 + t.phase) * 0.5 + 0.5) * 0.6;
      }

      this.checkpoints.forEach((c) => c.update(dt));
      this.signboards.forEach((s) => s.update(dt));
    }

    dispose() {
      this.checkpoints.forEach((c) => c.dispose());
      this.signboards.forEach((s) => s.dispose());
      this.terrain.dispose();
    }
  }

  TFW.Course = Course;
})(window);
