/**
 * CharacterRig.js — builds the hero child as ONE procedural SkinnedMesh.
 *
 * Everything is generated in JavaScript at runtime (no .glb, no external
 * assets, fully offline):
 *
 *   • A real Bone hierarchy: hips → spine → chest → neck → head, plus
 *     shoulder/arm/forearm/hand and thigh/shin/foot/toe chains.
 *   • One continuous lofted body surface (torso, neck, head, limbs) built from
 *     smoothly interpolated cross-section rings, so there are no seams and
 *     joints deform smoothly via blended skin weights.
 *   • Clothing, hair, boots, gloves, scarf and backpack built with
 *     LatheGeometry / TubeGeometry+CatmullRomCurve3 / ExtrudeGeometry /
 *     ShapeGeometry and merged into the same skinned mesh (rigidly weighted to
 *     their bone), keeping the whole character to a handful of draw calls.
 *   • Facial morph targets (happy, excited, curious, proud, celebrate) driven
 *     through morphAttributes / morphTargetInfluences.
 *   • MeshPhysicalMaterial set with procedurally generated normal / roughness /
 *     AO maps: sheen for cloth, clearcoat for boots and hair.
 *   • A THREE.LOD with a lower-resolution skinned mesh sharing the same
 *     skeleton for distance rendering.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const U = TFW.Utils;

  /** Material slot indices (also the geometry group order). */
  const MAT = { SKIN: 0, CLOTH: 1, LEATHER: 2, HAIR: 3 };

  /**
   * Bone table: [name, parentName, world rest position].
   * Rest pose is a relaxed A-pose: arms hanging at the sides, legs straight.
   * Total height ≈ 1.40 m with a slightly oversized head for readability.
   */
  const RIG = [
    ['hips', null, [0, 0.66, 0]],
    ['spine', 'hips', [0, 0.80, 0]],
    ['chest', 'spine', [0, 0.97, 0]],
    ['neck', 'chest', [0, 1.14, 0]],
    ['head', 'neck', [0, 1.20, 0]],

    ['shoulderL', 'chest', [-0.085, 1.05, 0]],
    ['armL', 'shoulderL', [-0.165, 1.015, 0]],
    ['forearmL', 'armL', [-0.168, 0.80, 0]],
    ['handL', 'forearmL', [-0.170, 0.605, 0]],

    ['shoulderR', 'chest', [0.085, 1.05, 0]],
    ['armR', 'shoulderR', [0.165, 1.015, 0]],
    ['forearmR', 'armR', [0.168, 0.80, 0]],
    ['handR', 'forearmR', [0.170, 0.605, 0]],

    ['thighL', 'hips', [-0.085, 0.635, 0]],
    ['shinL', 'thighL', [-0.088, 0.365, 0]],
    ['footL', 'shinL', [-0.090, 0.105, 0]],
    ['toeL', 'footL', [-0.090, 0.045, 0.095]],

    ['thighR', 'hips', [0.085, 0.635, 0]],
    ['shinR', 'thighR', [0.088, 0.365, 0]],
    ['footR', 'shinR', [0.090, 0.105, 0]],
    ['toeR', 'footR', [0.090, 0.045, 0.095]],
  ];

  // Head anatomy constants shared by the geometry and the morph targets.
  const HEAD = { cx: 0, cy: 1.275, cz: 0, r: 0.118 };

  /**
   * Accumulates vertices/triangles for a single merged, skinned geometry.
   * Triangles are bucketed per material so the final geometry gets one group
   * per material slot (a handful of draw calls for the whole character).
   */
  class MeshBuilder {
    constructor(boneIndex) {
      this.boneIndex = boneIndex;
      this.pos = [];
      this.uv = [];
      this.col = [];
      this.skinIndex = [];
      this.skinWeight = [];
      this.region = [];
      this.tris = [[], [], [], []];
      this._c = new THREE.Color();
    }

    /**
     * @param {number[]} p        [x, y, z] in character (bind) space
     * @param {number[]} uv       [u, v]
     * @param {THREE.Color} color vertex colour
     * @param {Array} weights     [[boneName, weight], ...] (max 4, auto-normalised)
     * @param {string} region     tag used by the morph-target generator
     */
    vert(p, uv, color, weights, region) {
      this.pos.push(p[0], p[1], p[2]);
      this.uv.push(uv[0], uv[1]);
      this.col.push(color.r, color.g, color.b);

      let total = 0;
      const n = Math.min(weights.length, 4);
      for (let i = 0; i < n; i++) total += weights[i][1];
      if (total <= 0) total = 1;
      for (let i = 0; i < 4; i++) {
        if (i < n) {
          const bi = this.boneIndex[weights[i][0]];
          if (bi === undefined) throw new Error('CharacterRig: unknown bone "' + weights[i][0] + '".');
          this.skinIndex.push(bi);
          this.skinWeight.push(weights[i][1] / total);
        } else {
          this.skinIndex.push(0);
          this.skinWeight.push(0);
        }
      }
      this.region.push(region || '');
      return this.pos.length / 3 - 1;
    }

    tri(a, b, c, mat) { this.tris[mat].push(a, b, c); }

    quad(a, b, c, d, mat) {
      this.tri(a, b, c, mat);
      this.tri(a, c, d, mat);
    }

    get vertexCount() { return this.pos.length / 3; }

    get triangleCount() {
      return this.tris.reduce((s, t) => s + t.length / 3, 0);
    }

    /**
     * Loft a tube/solid of revolution through a list of cross-section rings.
     * Rings with radius 0 collapse to a pole, which closes caps cleanly.
     * @param {Array} rings [{ y, cx, cz, rx, rz, w, color, v, region }]
     */
    loft(rings, segments, mat, opts) {
      const o = opts || {};
      const uScale = o.uScale === undefined ? 1 : o.uScale;
      const grid = [];

      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        const row = [];
        const degenerate = r.rx < 1e-5 && r.rz < 1e-5;
        if (degenerate) {
          // Single pole vertex reused across the row.
          const idx = this.vert([r.cx, r.y, r.cz], [0.5, r.v], r.color, r.w, r.region);
          for (let j = 0; j <= segments; j++) row.push(idx);
        } else {
          for (let j = 0; j <= segments; j++) {
            const t = j / segments;
            const a = t * Math.PI * 2;
            const x = r.cx + Math.cos(a) * r.rx;
            const z = r.cz + Math.sin(a) * r.rz;
            row.push(this.vert([x, r.y, z], [t * uScale, r.v], r.color, r.w, r.region));
          }
        }
        grid.push(row);
      }

      for (let i = 0; i < rings.length - 1; i++) {
        const a = grid[i];
        const b = grid[i + 1];
        for (let j = 0; j < segments; j++) {
          const v00 = a[j], v01 = a[j + 1], v10 = b[j], v11 = b[j + 1];
          // Skip fully degenerate quads at the poles.
          if (v00 === v01 && v10 === v11) continue;
          if (v00 === v01) this.tri(v00, v10, v11, mat);
          else if (v10 === v11) this.tri(v00, v01, v10, mat);
          else this.quad(v00, v01, v11, v10, mat);
        }
      }
      return grid;
    }

    /**
     * Merge an arbitrary generated geometry (lathe/tube/extrude/shape) into the
     * skinned mesh, rigidly weighted to one or more bones.
     */
    addGeometry(geo, matrix, weights, color, mat, region) {
      const posAttr = geo.attributes.position;
      if (!posAttr) throw new Error('CharacterRig: geometry has no position attribute.');
      const uvAttr = geo.attributes.uv;
      const v = new THREE.Vector3();
      const base = this.vertexCount;

      for (let i = 0; i < posAttr.count; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        if (matrix) v.applyMatrix4(matrix);
        const uv = uvAttr ? [uvAttr.getX(i), uvAttr.getY(i)] : [v.x * 4, v.y * 4];
        this.vert([v.x, v.y, v.z], uv, color, weights, region);
      }

      if (geo.index) {
        const idx = geo.index.array;
        for (let i = 0; i < idx.length; i += 3) {
          this.tri(base + idx[i], base + idx[i + 1], base + idx[i + 2], mat);
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          this.tri(base + i, base + i + 1, base + i + 2, mat);
        }
      }
      geo.dispose();
    }

    /** Assemble the final BufferGeometry with one group per material. */
    build() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(this.skinIndex), 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(this.skinWeight), 4));

      const indices = [];
      for (let m = 0; m < this.tris.length; m++) {
        const start = indices.length;
        const list = this.tris[m];
        for (let i = 0; i < list.length; i++) indices.push(list[i]);
        if (list.length) geo.addGroup(start, list.length, m);
      }
      const IndexArray = this.vertexCount > 65535 ? Uint32Array : Uint16Array;
      geo.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));
      geo.computeVertexNormals();
      return geo;
    }
  }

  TFW.CharacterRig = { MAT, RIG, HEAD, MeshBuilder };
})(window);

/* ===================================================================== *
 *  Body, clothing and hair generation + skeleton assembly
 * ===================================================================== */
(function (global) {
  'use strict';

  const TFW = global.TFW;
  const U = TFW.Utils;
  const { MAT, RIG, HEAD, MeshBuilder } = TFW.CharacterRig;

  /** Blend helper: weights that fade between two bones. */
  const bw = (a, b, t) => (t <= 0 ? [[a, 1]] : t >= 1 ? [[b, 1]] : [[a, 1 - t], [b, t]]);

  const PALETTE = {
    skin: 0xd8a273,
    skinDark: 0xb9814f,
    lip: 0xb9605a,
    mouth: 0x63302c,
    hair: 0x140f0c,
    jacket: 0x2f74d0,
    jacketDark: 0x2159a3,
    shirt: 0xf5f8fd,
    pants: 0x2c3548,
    pantsDark: 0x222a3a,
    boot: 0x6b4426,
    bootDark: 0x33231a,
    glove: 0x3b5474,
    scarf: 0xe5484d,
    pack: 0x9c7d45,
    packDark: 0x6d5730,
    strap: 0x4b3b23,
    snow: 0xf4fbff,
  };

  class CharacterBuilder {
    constructor(assets, quality) {
      this.assets = assets;
      // Quality drives ring/segment density so the LOD levels share one code path.
      this.q = quality; // { seg, segLimb, ringScale, details }
      this.colors = {};
      Object.keys(PALETTE).forEach((k) => { this.colors[k] = new THREE.Color(PALETTE[k]); });
    }

    /** Build the merged skinned geometry for the configured quality. */
    build(boneIndex) {
      const b = new MeshBuilder(boneIndex);
      this._torso(b);
      this._head(b);
      this._arms(b);
      this._legs(b);
      if (this.q.details) {
        this._hair(b);
        this._face(b);
        this._scarf(b);
        this._backpack(b);
        this._jacketDetails(b);
      } else {
        this._hairSimple(b);
      }
      this.builder = b;
      return b.build();
    }

    // ------------------------------------------------------------- torso

    _torso(b) {
      const c = this.colors;
      const seg = this.q.seg;
      // [y, rx, rz, boneA, boneB, blend, color]
      const spec = [
        [0.575, 0.020, 0.016, 'hips', 'hips', 0, c.pantsDark],
        [0.600, 0.098, 0.074, 'hips', 'hips', 0, c.pants],
        [0.640, 0.118, 0.089, 'hips', 'hips', 0, c.pants],
        [0.680, 0.117, 0.088, 'hips', 'spine', 0.15, c.jacketDark],
        [0.730, 0.112, 0.085, 'hips', 'spine', 0.45, c.jacket],
        [0.790, 0.114, 0.086, 'spine', 'spine', 0, c.jacket],
        [0.850, 0.121, 0.091, 'spine', 'chest', 0.3, c.jacket],
        [0.910, 0.132, 0.097, 'spine', 'chest', 0.7, c.jacket],
        [0.965, 0.140, 0.101, 'chest', 'chest', 0, c.jacket],
        [1.010, 0.137, 0.099, 'chest', 'chest', 0, c.jacket],
        [1.048, 0.121, 0.092, 'chest', 'chest', 0, c.jacket],
        [1.080, 0.088, 0.075, 'chest', 'neck', 0.35, c.shirt],
        [1.115, 0.052, 0.048, 'neck', 'neck', 0, c.skin],
        [1.150, 0.049, 0.046, 'neck', 'head', 0.35, c.skin],
        [1.180, 0.056, 0.053, 'neck', 'head', 0.75, c.skin],
      ];
      const rings = spec.map((s, i) => ({
        y: s[0], cx: 0, cz: 0, rx: s[1], rz: s[2],
        w: bw(s[3], s[4], s[5]), color: s[6],
        v: i / (spec.length - 1) * 2, region: 'torso',
      }));
      // Everything below the jacket hem is trousers; above is cloth too, so the
      // whole torso sits in the CLOTH group except the neck (skin).
      b.loft(rings.slice(0, 12), seg, MAT.CLOTH, { uScale: 2 });
      b.loft(rings.slice(11), seg, MAT.SKIN, { uScale: 2 });
    }

    // ------------------------------------------------------------- head

    _head(b) {
      const c = this.colors;
      const seg = this.q.seg + 4;
      const steps = this.q.details ? 20 : 12;
      const rings = [];
      // Sphere-ish skull, slightly narrowed at the jaw and flatter at the back.
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;              // 0 = bottom of jaw, 1 = crown
        const a = (t - 0.5) * Math.PI;    // -pi/2 .. pi/2
        const prof = Math.cos(a);
        // Taper the lower half into a chin/jaw.
        const jaw = U.lerp(0.74, 1.0, U.smoothstep(U.clamp01(t / 0.45)));
        const rx = HEAD.r * prof * jaw;
        const rz = HEAD.r * prof * jaw * 0.97;
        const y = HEAD.cy + Math.sin(a) * HEAD.r * 1.06;
        rings.push({
          y, cx: HEAD.cx, cz: HEAD.cz + (1 - prof) * 0.004,
          rx, rz, w: [['head', 1]], color: c.skin,
          v: t * 1.5, region: 'head',
        });
      }
      b.loft(rings, seg, MAT.SKIN, { uScale: 2 });

      // Ears (small lathe discs weighted to the head).
      if (this.q.details) {
        [-1, 1].forEach((s) => {
          const pts = [];
          for (let i = 0; i <= 6; i++) {
            const t = i / 6;
            pts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.028 + 0.001, U.lerp(-0.032, 0.032, t)));
          }
          const geo = new THREE.LatheGeometry(pts, 10);
          const m = new THREE.Matrix4()
            .makeRotationZ(Math.PI / 2 * s)
            .setPosition(HEAD.cx + s * HEAD.r * 0.93, HEAD.cy - 0.012, HEAD.cz - 0.004);
          b.addGeometry(geo, m, [['head', 1]], c.skin, MAT.SKIN, 'ear');
        });
      }
    }

    // ------------------------------------------------------------- arms

    _arms(b) {
      const c = this.colors;
      const seg = this.q.segLimb;
      [-1, 1].forEach((side) => {
        const S = side < 0 ? 'L' : 'R';
        const x = side * 0.166;
        // [y, r, boneA, boneB, blend, color, mat]
        const spec = [
          [1.070, 0.052, 'chest', 'shoulder' + S, 0.5, c.jacket],
          [1.045, 0.062, 'shoulder' + S, 'shoulder' + S, 0, c.jacket],
          [1.010, 0.058, 'shoulder' + S, 'arm' + S, 0.6, c.jacket],
          [0.950, 0.052, 'arm' + S, 'arm' + S, 0, c.jacket],
          [0.880, 0.048, 'arm' + S, 'arm' + S, 0, c.jacket],
          [0.825, 0.046, 'arm' + S, 'forearm' + S, 0.4, c.jacket],
          [0.790, 0.045, 'arm' + S, 'forearm' + S, 0.8, c.jacket],
          [0.730, 0.043, 'forearm' + S, 'forearm' + S, 0, c.jacket],
          [0.670, 0.041, 'forearm' + S, 'forearm' + S, 0, c.jacketDark],
          [0.635, 0.044, 'forearm' + S, 'hand' + S, 0.5, c.glove],
        ];
        const rings = spec.map((s, i) => ({
          y: s[0], cx: x + (s[0] > 1.03 ? -side * 0.006 : 0), cz: 0,
          rx: s[1], rz: s[1] * 0.95, w: bw(s[2], s[3], s[4]), color: s[5],
          v: i / (spec.length - 1) * 1.6, region: 'arm',
        }));
        b.loft(rings, seg, MAT.CLOTH, { uScale: 1 });

        // Wool mitten glove: lathe profile weighted rigidly to the hand bone.
        const pts = [];
        const gsteps = this.q.details ? 12 : 7;
        for (let i = 0; i <= gsteps; i++) {
          const t = i / gsteps;
          // Rounded mitten: fat in the middle, closed at the tip.
          const r = Math.sin(t * Math.PI) * 0.052 + 0.012 * (1 - t);
          pts.push(new THREE.Vector2(Math.max(0.0008, r), U.lerp(0.0, -0.115, t)));
        }
        const glove = new THREE.LatheGeometry(pts, seg);
        const gm = new THREE.Matrix4().setPosition(x, 0.628, 0.004);
        b.addGeometry(glove, gm, [['hand' + S, 1]], c.glove, MAT.CLOTH, 'glove');

        // Thumb.
        if (this.q.details) {
          const thumb = new THREE.CapsuleGeometry(0.019, 0.032, 3, 8);
          const tm = new THREE.Matrix4()
            .makeRotationZ(side * 0.9)
            .setPosition(x + side * 0.044, 0.585, 0.012);
          b.addGeometry(thumb, tm, [['hand' + S, 1]], c.glove, MAT.CLOTH, 'glove');
        }
      });
    }

    // ------------------------------------------------------------- legs

    _legs(b) {
      const c = this.colors;
      const seg = this.q.segLimb;
      [-1, 1].forEach((side) => {
        const S = side < 0 ? 'L' : 'R';
        const x = side * 0.087;
        const spec = [
          [0.640, 0.072, 'hips', 'thigh' + S, 0.55, c.pants],
          [0.580, 0.070, 'thigh' + S, 'thigh' + S, 0, c.pants],
          [0.500, 0.066, 'thigh' + S, 'thigh' + S, 0, c.pants],
          [0.430, 0.062, 'thigh' + S, 'shin' + S, 0.35, c.pants],
          [0.390, 0.060, 'thigh' + S, 'shin' + S, 0.75, c.pants],
          [0.330, 0.057, 'shin' + S, 'shin' + S, 0, c.pants],
          [0.260, 0.054, 'shin' + S, 'shin' + S, 0, c.pants],
          [0.205, 0.056, 'shin' + S, 'shin' + S, 0, c.pantsDark],
          [0.185, 0.060, 'shin' + S, 'shin' + S, 0, c.pantsDark],
        ];
        const rings = spec.map((s, i) => ({
          y: s[0], cx: x, cz: 0, rx: s[1], rz: s[1] * 0.98,
          w: bw(s[2], s[3], s[4]), color: s[5],
          v: i / (spec.length - 1) * 1.8, region: 'leg',
        }));
        b.loft(rings, seg, MAT.CLOTH, { uScale: 1 });

        this._boot(b, S, x, seg);
      });
    }

    /** Leather hiking boot: lofted upper + extruded sole + snow dusting. */
    _boot(b, S, x, seg) {
      const c = this.colors;
      const spec = [
        [0.195, 0.062, 0.062, 0.000, c.bootDark],
        [0.160, 0.066, 0.070, 0.006, c.boot],
        [0.120, 0.068, 0.082, 0.016, c.boot],
        [0.085, 0.069, 0.092, 0.026, c.boot],
        [0.055, 0.068, 0.098, 0.034, c.boot],
        [0.038, 0.066, 0.100, 0.038, c.bootDark],
      ];
      const rings = spec.map((s, i) => ({
        y: s[0], cx: x, cz: s[3], rx: s[1], rz: s[2],
        w: [['foot' + S, 1]], color: s[4],
        v: i / (spec.length - 1), region: 'boot',
      }));
      b.loft(rings, seg, MAT.LEATHER, { uScale: 1 });

      // Sole: an extruded rounded shape, flat on the ground.
      const shape = new THREE.Shape();
      const w = 0.062, d = 0.105;
      shape.moveTo(-w, -d * 0.62);
      shape.quadraticCurveTo(-w * 1.05, d * 0.55, -w * 0.55, d);
      shape.quadraticCurveTo(0, d * 1.18, w * 0.55, d);
      shape.quadraticCurveTo(w * 1.05, d * 0.55, w, -d * 0.62);
      shape.quadraticCurveTo(0, -d * 0.95, -w, -d * 0.62);
      const sole = new THREE.ExtrudeGeometry(shape, { depth: 0.036, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 6 });
      const sm = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(x, 0.002, 0.028);
      b.addGeometry(sole, sm, [['foot' + S, 1]], c.bootDark, MAT.LEATHER, 'sole');

      // Snow packed around the sole.
      if (this.q.details) {
        const snowShape = new THREE.Shape();
        const sw = 0.068, sd = 0.112;
        snowShape.absellipse(0, 0, sw, sd, 0, Math.PI * 2, false, 0);
        const snow = new THREE.ExtrudeGeometry(snowShape, { depth: 0.016, bevelEnabled: false, curveSegments: 10 });
        const nm = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(x, 0.030, 0.028);
        b.addGeometry(snow, nm, [['foot' + S, 1]], c.snow, MAT.CLOTH, 'snow');
      }
    }

    // ------------------------------------------------------------- hair

    _hairSimple(b) {
      // Low-detail hair for the distant LOD: one lathe cap.
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const a = t * Math.PI * 0.52;
        pts.push(new THREE.Vector2(Math.sin(a) * HEAD.r * 1.07 + 0.0008, Math.cos(a) * HEAD.r * 1.1));
      }
      const geo = new THREE.LatheGeometry(pts, this.q.seg);
      const m = new THREE.Matrix4().setPosition(HEAD.cx, HEAD.cy + 0.005, HEAD.cz);
      b.addGeometry(geo, m, [['head', 1]], this.colors.hair, MAT.HAIR, 'hair');
    }

    _hair(b) {
      const c = this.colors;
      // 1) Volumetric scalp cap via LatheGeometry (clean topology, smooth).
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const a = t * Math.PI * 0.56;
        pts.push(new THREE.Vector2(Math.sin(a) * HEAD.r * 1.075 + 0.0008, Math.cos(a) * HEAD.r * 1.12));
      }
      const cap = new THREE.LatheGeometry(pts, this.q.seg + 4);
      b.addGeometry(cap, new THREE.Matrix4().setPosition(HEAD.cx, HEAD.cy + 0.004, HEAD.cz),
        [['head', 1]], c.hair, MAT.HAIR, 'hair');

      // 2) Nape coverage at the back of the head.
      const nape = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        nape.push(new THREE.Vector2(Math.sin(t * Math.PI * 0.5) * HEAD.r * 0.98 + 0.001, U.lerp(0.02, -0.075, t)));
      }
      const napeGeo = new THREE.LatheGeometry(nape, this.q.seg, Math.PI * 0.55, Math.PI * 0.9);
      b.addGeometry(napeGeo, new THREE.Matrix4().setPosition(HEAD.cx, HEAD.cy, HEAD.cz - 0.006),
        [['head', 1]], c.hair, MAT.HAIR, 'hair');

      // 3) Layered strand clumps: swept tubes along Catmull-Rom curves. These
      //    give the silhouette real separation instead of a helmet shape.
      const strand = (a0, tilt, len, thick, lift) => {
        const p = [];
        const steps = 4;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const rad = HEAD.r * U.lerp(0.62, 1.16, t);
          const y = HEAD.cy + HEAD.r * (lift - t * t * len);
          p.push(new THREE.Vector3(
            HEAD.cx + Math.cos(a0) * rad * Math.cos(tilt * t),
            y,
            HEAD.cz + Math.sin(a0) * rad * Math.cos(tilt * t) + Math.sin(tilt * t) * 0.012
          ));
        }
        const curve = new THREE.CatmullRomCurve3(p);
        const geo = new THREE.TubeGeometry(curve, 5, thick, 5, false);
        b.addGeometry(geo, null, [['head', 1]], c.hair, MAT.HAIR, 'hair');
      };

      const clumps = 14;
      for (let i = 0; i < clumps; i++) {
        const a = (i / clumps) * Math.PI * 2;
        strand(a, 0.35 + (i % 3) * 0.12, 0.95 + (i % 4) * 0.14, 0.019 + (i % 3) * 0.004, 0.92);
      }
      // Front fringe: shorter, angled tufts forming a natural hairline.
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.30;
        strand(a, 0.85, 0.62, 0.016, 0.88);
      }
      // Cheeky cowlick.
      const cl = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.028, HEAD.cy + HEAD.r * 1.02, -0.01),
        new THREE.Vector3(0.05, HEAD.cy + HEAD.r * 1.24, -0.02),
        new THREE.Vector3(0.026, HEAD.cy + HEAD.r * 1.42, -0.055),
      ]);
      b.addGeometry(new THREE.TubeGeometry(cl, 6, 0.016, 5, false), null, [['head', 1]], c.hair, MAT.HAIR, 'hair');
    }

    // ------------------------------------------------------------- face

    _face(b) {
      const c = this.colors;
      const R = HEAD.r;

      // Nose: a small rounded wedge on the face surface.
      const nose = new THREE.SphereGeometry(0.021, 10, 8);
      const nm = new THREE.Matrix4().makeScale(1, 0.92, 1.25).setPosition(0, HEAD.cy - 0.018, R * 0.95);
      b.addGeometry(nose, nm, [['head', 1]], c.skin, MAT.SKIN, 'nose');

      // Eyebrows: ShapeGeometry arcs so they read clearly at gameplay distance.
      [-1, 1].forEach((s) => {
        const shape = new THREE.Shape();
        shape.moveTo(-0.030, 0);
        shape.quadraticCurveTo(0, 0.014, 0.030, 0.004);
        shape.lineTo(0.030, -0.006);
        shape.quadraticCurveTo(0, 0.002, -0.030, -0.008);
        shape.lineTo(-0.030, 0);
        const geo = new THREE.ShapeGeometry(shape, 6);
        const m = new THREE.Matrix4()
          .makeRotationZ(-s * 0.12)
          .setPosition(s * 0.049, HEAD.cy + 0.049, R * 0.90);
        b.addGeometry(geo, m, [['head', 1]], c.hair, MAT.HAIR, 'brow' + (s < 0 ? 'L' : 'R'));
      });

      // Mouth: a shallow lens on the surface (morph targets animate it).
      const mouthShape = new THREE.Shape();
      mouthShape.moveTo(-0.034, 0);
      mouthShape.quadraticCurveTo(0, -0.020, 0.034, 0);
      mouthShape.quadraticCurveTo(0, 0.008, -0.034, 0);
      const mouthGeo = new THREE.ShapeGeometry(mouthShape, 8);
      const mm = new THREE.Matrix4().setPosition(0, HEAD.cy - 0.056, R * 0.895);
      b.addGeometry(mouthGeo, mm, [['head', 1]], c.mouth, MAT.SKIN, 'mouth');

      // Lower lip highlight.
      const lip = new THREE.CapsuleGeometry(0.007, 0.042, 3, 6);
      const lm = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, HEAD.cy - 0.070, R * 0.90);
      b.addGeometry(lip, lm, [['head', 1]], c.lip, MAT.SKIN, 'mouth');

      // Cheeks: soft raised volume that the smile morph pushes up.
      [-1, 1].forEach((s) => {
        const cheek = new THREE.SphereGeometry(0.030, 10, 8);
        const m = new THREE.Matrix4().makeScale(1, 0.8, 0.55)
          .setPosition(s * 0.062, HEAD.cy - 0.030, R * 0.80);
        b.addGeometry(cheek, m, [['head', 1]], c.skin, MAT.SKIN, 'cheek' + (s < 0 ? 'L' : 'R'));
      });
    }

    // ------------------------------------------------------------- scarf

    _scarf(b) {
      const c = this.colors;
      // Wrapped scarf: a closed tube swept around the neck.
      const pts = [];
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push(new THREE.Vector3(
          Math.cos(a) * 0.062,
          1.098 + Math.sin(a * 2) * 0.008,
          Math.sin(a) * 0.058
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const geo = new THREE.TubeGeometry(curve, 34, 0.026, 8, true);
      b.addGeometry(geo, null, [['neck', 0.55], ['chest', 0.45]], c.scarf, MAT.CLOTH, 'scarf');

      // Trailing tail down the back, weighted to the chest so it swings.
      const tail = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.045, 1.095, -0.045),
        new THREE.Vector3(0.062, 1.020, -0.072),
        new THREE.Vector3(0.052, 0.945, -0.062),
        new THREE.Vector3(0.058, 0.885, -0.040),
      ]);
      const tailGeo = new THREE.TubeGeometry(tail, 12, 0.021, 6, false);
      b.addGeometry(tailGeo, null, [['chest', 0.75], ['spine', 0.25]], c.scarf, MAT.CLOTH, 'scarf');
    }

    // ------------------------------------------------------------- backpack

    _backpack(b) {
      const c = this.colors;
      // Rounded canvas pack via ExtrudeGeometry with a bevel.
      const shape = new THREE.Shape();
      const w = 0.078, h = 0.105, r = 0.028;
      shape.moveTo(-w + r, -h);
      shape.lineTo(w - r, -h);
      shape.quadraticCurveTo(w, -h, w, -h + r);
      shape.lineTo(w, h - r);
      shape.quadraticCurveTo(w, h, w - r, h);
      shape.lineTo(-w + r, h);
      shape.quadraticCurveTo(-w, h, -w, h - r);
      shape.lineTo(-w, -h + r);
      shape.quadraticCurveTo(-w, -h, -w + r, -h);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.072, bevelEnabled: true, bevelSize: 0.010,
        bevelThickness: 0.010, bevelSegments: 2, curveSegments: 5,
      });
      const m = new THREE.Matrix4().setPosition(0, 0.905, -0.166);
      b.addGeometry(geo, m, [['chest', 1]], c.pack, MAT.CLOTH, 'pack');

      // Top flap.
      const flap = new THREE.ExtrudeGeometry(shape, { depth: 0.020, bevelEnabled: false, curveSegments: 4 });
      const fm = new THREE.Matrix4().makeScale(1.03, 0.34, 1).setPosition(0, 0.985, -0.170);
      b.addGeometry(flap, fm, [['chest', 1]], c.packDark, MAT.CLOTH, 'pack');

      // Shoulder straps: tubes curving over the shoulders onto the chest.
      [-1, 1].forEach((s) => {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(s * 0.055, 0.975, -0.120),
          new THREE.Vector3(s * 0.072, 1.055, -0.055),
          new THREE.Vector3(s * 0.070, 1.058, 0.045),
          new THREE.Vector3(s * 0.058, 0.960, 0.095),
          new THREE.Vector3(s * 0.048, 0.880, 0.082),
        ]);
        const strapGeo = new THREE.TubeGeometry(curve, 16, 0.014, 5, false);
        b.addGeometry(strapGeo, null, [['chest', 1]], c.strap, MAT.CLOTH, 'strap');
      });
    }

    // ------------------------------------------------------------- jacket

    _jacketDetails(b) {
      const c = this.colors;
      // Front zip: a thin tube down the jacket centre.
      const zip = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.070, 0.076),
        new THREE.Vector3(0, 1.000, 0.100),
        new THREE.Vector3(0, 0.910, 0.098),
        new THREE.Vector3(0, 0.800, 0.088),
        new THREE.Vector3(0, 0.700, 0.082),
      ]);
      b.addGeometry(new THREE.TubeGeometry(zip, 14, 0.008, 5, false), null,
        [['chest', 0.6], ['spine', 0.4]], c.jacketDark, MAT.CLOTH, 'zip');

      // Collar: a partial lathe ring standing up around the neck.
      const cpts = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        cpts.push(new THREE.Vector2(0.070 + t * 0.020, U.lerp(0, 0.052, t)));
      }
      const collar = new THREE.LatheGeometry(cpts, this.q.seg);
      b.addGeometry(collar, new THREE.Matrix4().setPosition(0, 1.062, 0),
        [['chest', 0.5], ['neck', 0.5]], c.jacketDark, MAT.CLOTH, 'collar');

      // Chest pockets.
      [-1, 1].forEach((s) => {
        const shape = new THREE.Shape();
        shape.moveTo(-0.026, -0.022);
        shape.lineTo(0.026, -0.022);
        shape.lineTo(0.026, 0.022);
        shape.lineTo(-0.026, 0.022);
        shape.lineTo(-0.026, -0.022);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
        const m = new THREE.Matrix4().setPosition(s * 0.062, 0.815, 0.080);
        b.addGeometry(geo, m, [['spine', 1]], c.jacketDark, MAT.CLOTH, 'pocket');
      });
    }
  }

  TFW.CharacterRig.CharacterBuilder = CharacterBuilder;
  TFW.CharacterRig.PALETTE = PALETTE;
})(window);

/* ===================================================================== *
 *  Morph targets, materials, skeleton + LOD assembly
 * ===================================================================== */
(function (global) {
  'use strict';

  const TFW = global.TFW;
  const U = TFW.Utils;
  const CR = TFW.CharacterRig;
  const { MAT, RIG, HEAD, CharacterBuilder } = CR;

  /** Facial morph target order. Index 0..N-1 maps to morphTargetInfluences. */
  const MORPHS = ['happy', 'excited', 'curious', 'proud', 'celebrate'];

  /** Smooth falloff mask around a point. */
  function mask(x, y, z, px, py, pz, radius) {
    const d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py) + (z - pz) * (z - pz));
    return U.smoothstep(U.clamp01(1 - d / radius));
  }

  const FACE_REGIONS = new Set(['head', 'mouth', 'cheekL', 'cheekR', 'browL', 'browR', 'nose']);

  /**
   * Build facial morph-target deltas analytically from the base positions and
   * the per-vertex region tags produced by the builder.
   */
  function buildMorphTargets(geometry, builder) {
    const base = geometry.attributes.position.array;
    const regions = builder.region;
    const count = base.length / 3;
    const R = HEAD.r;

    // Anatomy anchors on the face.
    const MOUTH = { x: 0, y: HEAD.cy - 0.058, z: R * 0.90 };
    const JAW_Y = HEAD.cy - 0.030;
    const targets = {};
    MORPHS.forEach((n) => { targets[n] = new Float32Array(base.length); });

    for (let i = 0; i < count; i++) {
      const region = regions[i];
      if (!FACE_REGIONS.has(region)) continue;

      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const z = base[i * 3 + 2];

      // Only the front of the face should move.
      const front = U.smoothstep(U.clamp01((z - R * 0.20) / (R * 0.55)));
      if (front <= 0.001 && region === 'head') continue;

      const isBrow = region === 'browL' || region === 'browR';
      const isMouth = region === 'mouth';
      const isCheek = region === 'cheekL' || region === 'cheekR';

      // Masks.
      const mMouth = isMouth ? 1 : mask(x, y, z, MOUTH.x, MOUTH.y, MOUTH.z, 0.075) * front;
      const mJaw = (isMouth ? 1 : front) * U.smoothstep(U.clamp01((JAW_Y - y) / 0.075));
      const mCheek = isCheek ? 1 : mask(x, y, z, Math.sign(x || 1) * 0.060, HEAD.cy - 0.028, R * 0.80, 0.058) * front;
      const mBrow = isBrow ? 1 : mask(x, y, z, Math.sign(x || 1) * 0.049, HEAD.cy + 0.049, R * 0.88, 0.050) * front;
      // Mouth "cornerness": 0 in the middle, 1 at the corners.
      const corner = U.clamp01(Math.abs(x) / 0.034) * mMouth;

      const set = (name, dx, dy, dz) => {
        const t = targets[name];
        t[i * 3] += dx;
        t[i * 3 + 1] += dy;
        t[i * 3 + 2] += dz;
      };

      // ---- happy: warm closed-mouth smile, cheeks lift, brows ease up
      set('happy',
        0,
        corner * 0.014 + mCheek * 0.007 + mBrow * 0.005,
        mCheek * 0.004);

      // ---- excited: jaw drops, brows up high, cheeks lift
      set('excited',
        0,
        -mJaw * 0.020 + mBrow * 0.013 + corner * 0.010 + mCheek * 0.005,
        mJaw * 0.004 + mBrow * 0.002);

      // ---- curious: one brow up (left), slight asymmetric mouth
      set('curious',
        0,
        (region === 'browL' ? 0.016 : region === 'browR' ? 0.003 : mBrow * (x < 0 ? 0.013 : 0.002))
          + corner * (x < 0 ? 0.006 : 0.001),
        0);

      // ---- proud: chin lifts a little, calm confident smile, brows settle
      set('proud',
        0,
        corner * 0.010 + mCheek * 0.005 - mBrow * 0.004,
        mJaw * 0.006);

      // ---- celebrate: big open grin, brows high, cheeks squashed up
      set('celebrate',
        corner * Math.sign(x || 1) * 0.006,
        -mJaw * 0.028 + corner * 0.018 + mBrow * 0.015 + mCheek * 0.010,
        mJaw * 0.005);
    }

    geometry.morphAttributes.position = MORPHS.map(
      (n) => new THREE.BufferAttribute(targets[n], 3)
    );
    geometry.morphTargetsRelative = true;
    return MORPHS.slice();
  }

  /** Stylised PBR material set with procedural detail maps. */
  function buildMaterials(assets) {
    const skin = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.52,
      metalness: 0.0,
      normalMap: assets.get('skinNormal'),
      roughnessMap: assets.get('skinRough'),
      // A hint of sheen reads as the soft light wrap of young skin.
      sheen: 0.35,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0xffd3ba),
      clearcoat: 0.06,
      clearcoatRoughness: 0.7,
      envMapIntensity: 0.65,
    });
    skin.normalScale = new THREE.Vector2(0.35, 0.35);

    const cloth = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.0,
      normalMap: assets.get('clothNormal'),
      roughnessMap: assets.get('clothRough'),
      aoMap: assets.get('clothAO'),
      aoMapIntensity: 0.7,
      sheen: 0.75,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0xcfe4ff),
      envMapIntensity: 0.5,
    });
    cloth.normalScale = new THREE.Vector2(0.75, 0.75);

    const leather = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.02,
      normalMap: assets.get('leatherNormal'),
      clearcoat: 0.55,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.8,
    });
    leather.normalScale = new THREE.Vector2(0.9, 0.9);

    const hair = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.05,
      normalMap: assets.get('hairNormal'),
      clearcoat: 0.85,
      clearcoatRoughness: 0.28,
      sheen: 0.4,
      sheenColor: new THREE.Color(0x6d5a86),
      envMapIntensity: 1.0,
    });
    hair.normalScale = new THREE.Vector2(1.0, 0.5);

    const list = [];
    list[MAT.SKIN] = skin;
    list[MAT.CLOTH] = cloth;
    list[MAT.LEATHER] = leather;
    list[MAT.HAIR] = hair;
    return list;
  }

  /**
   * Create the full character: bones, skinned mesh(es), morph targets, LOD.
   * @returns {object} {
   *   group, lod, mesh, skeleton, bones, boneList, materials,
   *   morphNames, morphIndex, triangleCount, eyes, dispose()
   * }
   */
  function createCharacter(assets) {
    if (!assets) throw new Error('CharacterRig: an AssetLoader is required.');

    // ---- bones ----------------------------------------------------------
    const bones = {};
    const boneList = [];
    const boneIndex = {};
    RIG.forEach((def, i) => {
      const [name, parent, wp] = def;
      const bone = new THREE.Bone();
      bone.name = name;
      if (parent) {
        const p = bones[parent];
        if (!p) throw new Error('CharacterRig: bone "' + name + '" references missing parent "' + parent + '".');
        const pw = p.userData.world;
        bone.position.set(wp[0] - pw[0], wp[1] - pw[1], wp[2] - pw[2]);
        p.add(bone);
      } else {
        bone.position.set(wp[0], wp[1], wp[2]);
      }
      bone.userData.world = wp;
      bones[name] = bone;
      boneIndex[name] = i;
      boneList.push(bone);
    });
    const rootBone = boneList[0];

    // ---- geometry (two LOD levels sharing one skeleton) ------------------
    const hiBuilder = new CharacterBuilder(assets, { seg: 20, segLimb: 14, details: true });
    const hiGeo = hiBuilder.build(boneIndex);
    const morphNames = buildMorphTargets(hiGeo, hiBuilder.builder);

    const loBuilder = new CharacterBuilder(assets, { seg: 10, segLimb: 7, details: false });
    const loGeo = loBuilder.build(boneIndex);

    const materials = buildMaterials(assets);

    const mesh = new THREE.SkinnedMesh(hiGeo, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // The character is always close to the camera; skip culling so animated
    // poses that exceed the bind-pose bounds never pop out of view.
    mesh.frustumCulled = false;
    if (mesh.updateMorphTargets) mesh.updateMorphTargets();

    const loMesh = new THREE.SkinnedMesh(loGeo, materials);
    loMesh.castShadow = true;
    loMesh.frustumCulled = false;

    // ---- group + bind ---------------------------------------------------
    // The bone hierarchy lives on the group (a sibling of the LOD) so bone
    // world matrices keep updating no matter which LOD level is visible.
    const group = new THREE.Group();
    group.add(rootBone);
    group.updateMatrixWorld(true);

    const skeleton = new THREE.Skeleton(boneList);
    mesh.bind(skeleton, new THREE.Matrix4());
    loMesh.bind(skeleton, new THREE.Matrix4());

    const lod = new THREE.LOD();
    lod.autoUpdate = true; // the renderer switches levels by camera distance
    lod.addLevel(mesh, 0);
    lod.addLevel(loMesh, 16);
    group.add(lod);

    // ---- eyes (small props on the head bone: real rotation for blinking) --
    const eyes = buildEyes(bones.head);

    const morphIndex = {};
    morphNames.forEach((n, i) => { morphIndex[n] = i; });

    const triangleCount = hiBuilder.builder.triangleCount + eyes.triangleCount;

    return {
      group, lod, mesh, loMesh, skeleton, bones, boneList, materials,
      morphNames, morphIndex, eyes,
      triangleCount,
      vertexCount: hiBuilder.builder.vertexCount,
      dispose() {
        hiGeo.dispose();
        loGeo.dispose();
        materials.forEach((m) => m.dispose());
        eyes.dispose();
      },
    };
  }

  /**
   * Eyeballs + eyelids, parented to the head bone. Kept off the skinned mesh so
   * blinking can use a true rotation (crisper than a linear morph).
   */
  function buildEyes(headBone) {
    const R = HEAD.r;
    const group = new THREE.Group();
    headBone.add(group);

    const scleraMat = new THREE.MeshPhysicalMaterial({
      color: 0xfdfdff, roughness: 0.18, clearcoat: 0.9, clearcoatRoughness: 0.1, metalness: 0,
    });
    const irisMat = new THREE.MeshPhysicalMaterial({
      color: 0x5b3316, roughness: 0.22, clearcoat: 1.0, clearcoatRoughness: 0.08,
      emissive: 0x2a1607, emissiveIntensity: 0.18,
    });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0d0906, roughness: 0.25 });
    const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lidMat = new THREE.MeshPhysicalMaterial({
      color: TFW.CharacterRig.PALETTE.skin, roughness: 0.5, sheen: 0.3,
    });

    // Head bone sits at (0, 1.20, 0); eye offsets are relative to it.
    const dy = HEAD.cy - 1.20 + 0.028;
    const lids = [];
    [-1, 1].forEach((s) => {
      const eye = new THREE.Group();
      eye.position.set(s * 0.050, dy, R * 0.80);
      eye.rotation.y = -s * 0.16;

      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.030, 16, 12), scleraMat);
      sclera.scale.set(1, 1.06, 0.72);
      eye.add(sclera);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 14, 10), irisMat);
      iris.position.z = 0.019;
      iris.scale.set(1, 1, 0.55);
      eye.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0080, 10, 8), pupilMat);
      pupil.position.z = 0.026;
      eye.add(pupil);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), hiMat);
      glint.position.set(0.008, 0.010, 0.028);
      eye.add(glint);

      // Upper eyelid: a skin-toned dome that rotates down to close the eye.
      const lidPivot = new THREE.Group();
      const lid = new THREE.Mesh(
        new THREE.SphereGeometry(0.0335, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
        lidMat
      );
      lid.scale.set(1, 1.05, 0.78);
      lidPivot.add(lid);
      eye.add(lidPivot);
      lids.push(lidPivot);

      group.add(eye);
    });

    return {
      group,
      lidL: lids[0],
      lidR: lids[1],
      // Rough triangle tally for the reported budget.
      triangleCount: 2 * (16 * 12 * 2 + 14 * 10 * 2 + 10 * 8 * 2 + 8 * 6 * 2 + 16 * 8 * 2),
      dispose() {
        [scleraMat, irisMat, pupilMat, hiMat, lidMat].forEach((m) => m.dispose());
        group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        if (group.parent) group.parent.remove(group);
      },
    };
  }

  CR.MORPHS = MORPHS;
  CR.createCharacter = createCharacter;
})(window);
