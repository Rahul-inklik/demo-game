/**
 * Effects.js — pooled particle systems, snow footprints, fireworks and camera shake.
 *
 * Two GPU point-clouds are reused for every effect (one additive for sparks and
 * fireworks, one alpha-blended for snow puffs and smoke), so hundreds of
 * particles cost only two draw calls and never allocate during play.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp, randRange } = TFW.Utils;

  const VERT = `
    attribute float aSize;
    attribute float aAlpha;
    attribute vec3 aColor;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vAlpha = aAlpha;
      vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (320.0 / max(0.001, -mv.z));
      gl_Position = projectionMatrix * mv;
    }`;

  const FRAG = `
    uniform sampler2D uMap;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      if (tex.a * vAlpha < 0.01) discard;
      gl_FragColor = vec4(vColor, tex.a * vAlpha);
    }`;

  /** A fixed-size particle cloud with a free list. */
  class ParticlePool {
    constructor(capacity, texture, additive) {
      this.capacity = capacity;
      this.live = [];
      this.free = [];
      this.particles = new Array(capacity);

      this.positions = new Float32Array(capacity * 3);
      this.colors = new Float32Array(capacity * 3);
      this.sizes = new Float32Array(capacity);
      this.alphas = new Float32Array(capacity);

      for (let i = 0; i < capacity; i++) {
        this.particles[i] = {
          index: i,
          active: false,
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          color: new THREE.Color(),
          life: 0, maxLife: 1,
          size0: 1, size1: 0,
          alpha0: 1, alpha1: 0,
          gravity: 0, drag: 0.9, spin: 0,
        };
        this.free.push(i);
        this.positions[i * 3 + 1] = -9999;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 60, 150), 1200);

      this.material = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: texture } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });

      this.points = new THREE.Points(geo, this.material);
      this.points.frustumCulled = false;
      this.points.renderOrder = 6;
      this.geometry = geo;
    }

    spawn(cfg) {
      let index;
      if (this.free.length) {
        index = this.free.pop();
      } else {
        // Recycle the oldest live particle rather than dropping the effect.
        index = this.live.shift();
        if (index === undefined) return null;
      }
      const p = this.particles[index];
      p.active = true;
      p.pos.copy(cfg.position);
      p.vel.copy(cfg.velocity);
      p.color.set(cfg.color);
      p.life = 0;
      p.maxLife = cfg.life;
      p.size0 = cfg.size0;
      p.size1 = cfg.size1 !== undefined ? cfg.size1 : cfg.size0 * 0.2;
      p.alpha0 = cfg.alpha0 !== undefined ? cfg.alpha0 : 1;
      p.alpha1 = cfg.alpha1 !== undefined ? cfg.alpha1 : 0;
      p.gravity = cfg.gravity || 0;
      p.drag = cfg.drag !== undefined ? cfg.drag : 0.86;
      this.live.push(index);
      return p;
    }

    update(dt) {
      const pos = this.positions;
      const col = this.colors;
      const size = this.sizes;
      const alpha = this.alphas;
      for (let i = this.live.length - 1; i >= 0; i--) {
        const index = this.live[i];
        const p = this.particles[index];
        p.life += dt;
        const t = p.life / p.maxLife;
        if (t >= 1) {
          p.active = false;
          alpha[index] = 0;
          size[index] = 0;
          pos[index * 3 + 1] = -9999;
          this.live.splice(i, 1);
          this.free.push(index);
          continue;
        }
        p.vel.y -= p.gravity * dt;
        const damp = Math.pow(p.drag, dt * 60);
        p.vel.multiplyScalar(damp);
        p.pos.addScaledVector(p.vel, dt);

        pos[index * 3] = p.pos.x;
        pos[index * 3 + 1] = p.pos.y;
        pos[index * 3 + 2] = p.pos.z;
        col[index * 3] = p.color.r;
        col[index * 3 + 1] = p.color.g;
        col[index * 3 + 2] = p.color.b;
        size[index] = p.size0 + (p.size1 - p.size0) * t;
        alpha[index] = p.alpha0 + (p.alpha1 - p.alpha0) * t;
      }
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }

    clear() {
      for (let i = this.live.length - 1; i >= 0; i--) {
        const index = this.live[i];
        this.particles[index].active = false;
        this.alphas[index] = 0;
        this.sizes[index] = 0;
        this.positions[index * 3 + 1] = -9999;
        this.free.push(index);
      }
      this.live.length = 0;
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
    }

    dispose() {
      this.geometry.dispose();
      this.material.dispose();
    }
  }

  class Effects {
    constructor(scene, assets) {
      this.scene = scene;
      this.assets = assets;

      const particleTex = assets.get('particle');
      this.sparks = new ParticlePool(900, particleTex, true);
      this.puffs = new ParticlePool(700, particleTex, false);
      scene.add(this.sparks.points, this.puffs.points);

      this.footprints = this._createFootprints(assets.get('footprint'), 30);
      this.footprints.forEach((f) => scene.add(f.mesh));
      this.footprintIndex = 0;

      this.shakeAmount = 0;
      this.shakeTime = 0;
      this.shakeOffset = new THREE.Vector3();
      this.fireworkTimers = [];
      this._tmp = new THREE.Vector3();
    }

    _createFootprints(texture, count) {
      const geo = new THREE.PlaneGeometry(0.55, 0.8);
      const list = [];
      for (let i = 0; i < count; i++) {
        const mat = new THREE.MeshBasicMaterial({
          map: texture, transparent: true, opacity: 0, depthWrite: false,
          color: 0xbcdcf7,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = -9999;
        mesh.renderOrder = 2;
        list.push({ mesh, life: 0, maxLife: 7 });
      }
      return list;
    }

    // ------------------------------------------------------------ effect API

    /** Generic radial burst. */
    burst(position, opts) {
      const o = opts || {};
      const count = o.count || 14;
      const pool = o.additive === false ? this.puffs : this.sparks;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const up = randRange(o.upMin !== undefined ? o.upMin : 0.4, o.upMax !== undefined ? o.upMax : 1);
        const speed = randRange(o.speedMin || 1.5, o.speedMax || 5);
        this._tmp.set(Math.cos(a) * speed, up * speed, Math.sin(a) * speed);
        pool.spawn({
          position,
          velocity: this._tmp,
          color: o.color || TFW.Config.Palette.sparkle,
          life: randRange(o.lifeMin || 0.5, o.lifeMax || 1.1),
          size0: randRange(o.size0 || 0.5, (o.size0 || 0.5) * 1.7),
          size1: o.size1 !== undefined ? o.size1 : 0.05,
          gravity: o.gravity !== undefined ? o.gravity : 6,
          drag: o.drag !== undefined ? o.drag : 0.9,
          alpha0: o.alpha0 !== undefined ? o.alpha0 : 1,
        });
      }
    }

    /** Snow kicked up while running. */
    runDust(position, speed01) {
      const count = 1 + Math.floor(speed01 * 2);
      for (let i = 0; i < count; i++) {
        this._tmp.set(randRange(-0.7, 0.7), randRange(0.4, 1.6), randRange(-0.7, 0.7));
        this.puffs.spawn({
          position, velocity: this._tmp,
          color: 0xffffff,
          life: randRange(0.35, 0.7),
          size0: randRange(0.35, 0.7), size1: 0.9,
          alpha0: 0.55, alpha1: 0,
          gravity: 1.6, drag: 0.82,
        });
      }
    }

    footstepPuff(position) {
      for (let i = 0; i < 4; i++) {
        this._tmp.set(randRange(-1, 1), randRange(0.3, 1.1), randRange(-1, 1));
        this.puffs.spawn({
          position, velocity: this._tmp,
          color: 0xf4fbff,
          life: randRange(0.3, 0.6),
          size0: randRange(0.28, 0.5), size1: 0.8,
          alpha0: 0.6, alpha1: 0,
          gravity: 1.2, drag: 0.8,
        });
      }
    }

    footprint(position, yaw) {
      const fp = this.footprints[this.footprintIndex];
      this.footprintIndex = (this.footprintIndex + 1) % this.footprints.length;
      fp.mesh.position.set(position.x, position.y + 0.035, position.z);
      fp.mesh.rotation.z = -yaw;
      fp.mesh.material.opacity = 0.62;
      fp.life = 0;
    }

    jumpPuff(position) {
      this.burst(position, {
        additive: false, count: 12, color: 0xffffff,
        speedMin: 1.4, speedMax: 3.4, upMin: 0.1, upMax: 0.7,
        lifeMin: 0.35, lifeMax: 0.7, size0: 0.5, size1: 1.0,
        gravity: 2.2, alpha0: 0.7,
      });
      this.burst(position, { count: 8, color: 0xdcf3ff, speedMin: 2, speedMax: 5, size0: 0.3, lifeMin: 0.3, lifeMax: 0.6 });
    }

    landPuff(position, strength) {
      const s = clamp(strength, 0.2, 1.6);
      this.burst(position, {
        additive: false, count: Math.floor(10 + s * 16), color: 0xffffff,
        speedMin: 1.8, speedMax: 3 + s * 5, upMin: 0.05, upMax: 0.4,
        lifeMin: 0.4, lifeMax: 0.85, size0: 0.5 + s * 0.3, size1: 1.3,
        gravity: 2.4, alpha0: 0.8,
      });
      if (s > 0.9) this.shake(0.16 * s);
    }

    checkpointBurst(position) {
      const p = TFW.Config.Palette;
      this.burst(position, {
        count: 46, color: p.checkpointOn,
        speedMin: 3, speedMax: 9, upMin: 0.5, upMax: 1.5,
        lifeMin: 0.7, lifeMax: 1.5, size0: 0.55, gravity: 5,
      });
      this.burst(position, { count: 18, color: p.saffron, speedMin: 2, speedMax: 6, size0: 0.7, lifeMin: 0.6, lifeMax: 1.2 });
      this.burst(position, { count: 18, color: p.green, speedMin: 2, speedMax: 6, size0: 0.7, lifeMin: 0.6, lifeMax: 1.2 });
      this.shake(0.1);
    }

    sparkleRing(position, radius, color) {
      const count = 26;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        this._tmp.set(Math.cos(a) * 1.2, randRange(0.6, 2.2), Math.sin(a) * 1.2);
        const pos = new THREE.Vector3(
          position.x + Math.cos(a) * radius,
          position.y + randRange(0, 0.8),
          position.z + Math.sin(a) * radius
        );
        this.sparks.spawn({
          position: pos, velocity: this._tmp,
          color: color || TFW.Config.Palette.sparkle,
          life: randRange(0.6, 1.3), size0: 0.5, size1: 0.05,
          gravity: 1.5, drag: 0.93,
        });
      }
    }

    quizSuccess(position) {
      this.burst(position, {
        count: 60, color: 0xfff2a8, speedMin: 3, speedMax: 10,
        upMin: 0.7, upMax: 1.8, lifeMin: 0.8, lifeMax: 1.6, size0: 0.6, gravity: 5,
      });
      this.sparkleRing(position, 2.4, TFW.Config.Palette.green);
      this.shake(0.12);
    }

    quizFail(position) {
      this.burst(position, {
        additive: false, count: 24, color: 0x9ab4d6,
        speedMin: 1.2, speedMax: 3.6, upMin: -0.2, upMax: 0.4,
        lifeMin: 0.5, lifeMax: 1.0, size0: 0.5, size1: 0.9, gravity: 5, alpha0: 0.7,
      });
      this.shake(0.22);
    }

    respawnSwirl(position) {
      const count = 34;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const r = 1.6;
        const pos = new THREE.Vector3(position.x + Math.cos(a) * r, position.y + randRange(0, 2.4), position.z + Math.sin(a) * r);
        this._tmp.set(-Math.sin(a) * 3.2, randRange(1.2, 3.4), Math.cos(a) * 3.2);
        this.sparks.spawn({
          position: pos, velocity: this._tmp,
          color: 0xbfe6ff, life: randRange(0.5, 1.0),
          size0: 0.45, size1: 0.05, gravity: -1.5, drag: 0.9,
        });
      }
    }

    /** Flag planting: a bright tricolour eruption around the pole. */
    flagPlant(position) {
      const p = TFW.Config.Palette;
      [p.saffron, 0xffffff, p.green].forEach((color, i) => {
        this.burst(position, {
          count: 40, color,
          speedMin: 3, speedMax: 11, upMin: 0.6 + i * 0.2, upMax: 2.2,
          lifeMin: 0.9, lifeMax: 1.8, size0: 0.7, gravity: 6,
        });
      });
      this.sparkleRing(position, 3.2, p.checkpointOn);
      this.shake(0.3);
    }

    /** Fireworks shell: rising trail then a coloured burst. */
    firework(position, color) {
      const rise = 6 + Math.random() * 8;
      const start = position.clone();
      const shell = this.sparks.spawn({
        position: start,
        velocity: new THREE.Vector3(randRange(-1, 1), rise, randRange(-1, 1)),
        color: 0xfff6cf, life: 0.85, size0: 0.7, size1: 0.4, gravity: 3.4, drag: 0.99,
      });
      const burstPos = start.clone().add(new THREE.Vector3(0, rise * 0.7, 0));
      const timer = global.setTimeout(() => {
        const c = color || TFW.Config.Palette.saffron;
        for (let i = 0; i < 70; i++) {
          const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
          const speed = randRange(5, 13);
          this.sparks.spawn({
            position: burstPos, velocity: dir.multiplyScalar(speed),
            color: c, life: randRange(0.9, 1.8), size0: randRange(0.4, 0.8), size1: 0.02,
            gravity: 4.2, drag: 0.93,
          });
        }
      }, 780);
      this.fireworkTimers.push(timer);
      return shell;
    }

    /** Confetti-like celebration around a point. */
    celebrate(position) {
      const p = TFW.Config.Palette;
      const colors = [p.saffron, 0xffffff, p.green, p.checkpointOn, 0x8fdcf8];
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = randRange(0, 6);
        const pos = new THREE.Vector3(position.x + Math.cos(a) * r, position.y + randRange(4, 12), position.z + Math.sin(a) * r);
        this.puffs.spawn({
          position: pos,
          velocity: new THREE.Vector3(randRange(-1.5, 1.5), randRange(-1, 1), randRange(-1.5, 1.5)),
          color: colors[i % colors.length],
          life: randRange(2.2, 4.2), size0: randRange(0.3, 0.6), size1: 0.25,
          alpha0: 0.95, alpha1: 0, gravity: 1.6, drag: 0.985,
        });
      }
    }

    // ------------------------------------------------------------ shake

    shake(amount) {
      this.shakeAmount = Math.max(this.shakeAmount, amount);
    }

    getShakeOffset() { return this.shakeOffset; }

    // ------------------------------------------------------------ frame

    update(dt) {
      this.sparks.update(dt);
      this.puffs.update(dt);

      for (let i = 0; i < this.footprints.length; i++) {
        const fp = this.footprints[i];
        if (fp.mesh.material.opacity <= 0.001) continue;
        fp.life += dt;
        const t = fp.life / fp.maxLife;
        fp.mesh.material.opacity = Math.max(0, 0.62 * (1 - t));
        if (t >= 1) fp.mesh.position.y = -9999;
      }

      this.shakeTime += dt * 34;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.5);
      const a = this.shakeAmount;
      this.shakeOffset.set(
        Math.sin(this.shakeTime * 1.7) * a,
        Math.cos(this.shakeTime * 2.3) * a,
        Math.sin(this.shakeTime * 1.1 + 1.3) * a * 0.6
      );
    }

    reset() {
      this.sparks.clear();
      this.puffs.clear();
      this.footprints.forEach((f) => { f.mesh.material.opacity = 0; f.mesh.position.y = -9999; });
      this.fireworkTimers.forEach((t) => global.clearTimeout(t));
      this.fireworkTimers.length = 0;
      this.shakeAmount = 0;
      this.shakeOffset.set(0, 0, 0);
    }

    dispose() {
      this.reset();
      this.sparks.dispose();
      this.puffs.dispose();
      this.footprints.forEach((f) => { f.mesh.geometry.dispose(); f.mesh.material.dispose(); });
    }
  }

  TFW.ParticlePool = ParticlePool;
  TFW.Effects = Effects;
})(window);
