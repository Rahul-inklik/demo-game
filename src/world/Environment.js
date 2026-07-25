/**
 * Environment.js — sky, lighting, fog, falling snow and drifting clouds.
 *
 * Builds a stylised HDR-style gradient sky dome, a warm key sun with dynamic
 * shadows, a soft hemisphere/ambient fill, exponential fog, a player-following
 * snow field and slow parallax clouds so the world always feels alive.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { randRange } = TFW.Utils;

  const SKY_VERT = `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

  const SKY_FRAG = `
    varying vec3 vDir;
    uniform vec3 uTop;
    uniform vec3 uMid;
    uniform vec3 uLow;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    void main() {
      float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.5, h));
      col = mix(col, uTop, smoothstep(0.45, 1.0, h));
      float sun = pow(clamp(dot(normalize(vDir), normalize(uSunDir)), 0.0, 1.0), 90.0);
      float halo = pow(clamp(dot(normalize(vDir), normalize(uSunDir)), 0.0, 1.0), 6.0);
      col += uSunColor * sun * 1.4;
      col += uSunColor * halo * 0.25;
      gl_FragColor = vec4(col, 1.0);
    }`;

  class Environment {
    constructor(scene, assets, config, renderer) {
      this.scene = scene;
      this.cfg = config;
      this.assets = assets;
      this.renderer = renderer;

      this.sunDir = new THREE.Vector3(-0.55, 0.7, 0.45).normalize();

      this._buildSky();
      this._buildLights();
      this._buildFog();
      this._buildEnvironmentMap();
      this._buildClouds();
      this._buildSnow();

      this._time = 0;
    }

    _buildSky() {
      const p = this.cfg.Palette;
      const geo = new THREE.SphereGeometry(700, 32, 24);
      this.skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(p.skyTop) },
          uMid: { value: new THREE.Color(p.skyMid) },
          uLow: { value: new THREE.Color(p.skyLow) },
          uSunDir: { value: this.sunDir.clone() },
          uSunColor: { value: new THREE.Color(p.sunWarm) },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
      });
      this.sky = new THREE.Mesh(geo, this.skyMat);
      this.sky.frustumCulled = false;
      this.sky.renderOrder = -1;
      this.scene.add(this.sky);

      // Warm sun disc glow sprite.
      const glowMat = new THREE.SpriteMaterial({
        map: this.assets.get('glow'),
        color: p.sunWarm,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.sunSprite = new THREE.Sprite(glowMat);
      this.sunSprite.scale.set(150, 150, 1);
      this.sunSprite.position.copy(this.sunDir).multiplyScalar(520);
      this.scene.add(this.sunSprite);
    }

    _buildLights() {
      const p = this.cfg.Palette;
      const r = this.cfg.render;

      this.hemi = new THREE.HemisphereLight(p.skyMid, p.snowShade, 0.9);
      this.scene.add(this.hemi);

      this.ambient = new THREE.AmbientLight(0xffffff, 0.35);
      this.scene.add(this.ambient);

      this.sun = new THREE.DirectionalLight(p.sunWarm, 2.1);
      this.sun.position.copy(this.sunDir).multiplyScalar(120);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(r.shadowMapSize, r.shadowMapSize);
      const cam = this.sun.shadow.camera;
      cam.near = 10;
      cam.far = 420;
      cam.left = -120;
      cam.right = 120;
      cam.top = 120;
      cam.bottom = -120;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.6;
      this.scene.add(this.sun);
      this.scene.add(this.sun.target);

      // Cool bounce fill from the snow.
      this.fill = new THREE.DirectionalLight(p.ice, 0.35);
      this.fill.position.set(60, 30, -80);
      this.scene.add(this.fill);
    }

    _buildFog() {
      const p = this.cfg.Palette;
      this.scene.fog = new THREE.Fog(p.fog, this.cfg.render.fogNear, this.cfg.render.fogFar);
      this.scene.background = new THREE.Color(p.skyMid);
    }

    /** Generate a soft gradient environment map so materials pick up sky tones. */
    _buildEnvironmentMap() {
      try {
        const size = 128;
        const canvas = global.document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const p = this.cfg.Palette;
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, '#' + new THREE.Color(p.skyTop).getHexString());
        g.addColorStop(0.55, '#' + new THREE.Color(p.skyMid).getHexString());
        g.addColorStop(1, '#' + new THREE.Color(p.snowLight).getHexString());
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);

        const tex = new THREE.CanvasTexture(canvas);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;

        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envRT = pmrem.fromEquirectangular(tex);
        this.scene.environment = this.envRT.texture;
        tex.dispose();
        pmrem.dispose();
      } catch (e) {
        // Environment map is a visual nicety; if PMREM is unavailable the game
        // still renders correctly with direct lighting only.
        this.scene.environment = null;
      }
    }

    _buildClouds() {
      this.clouds = new THREE.Group();
      const mapTex = this.assets.get('cloud');
      for (let i = 0; i < 14; i++) {
        const mat = new THREE.SpriteMaterial({
          map: mapTex,
          transparent: true,
          depthWrite: false,
          opacity: randRange(0.5, 0.9),
        });
        const s = new THREE.Sprite(mat);
        const scale = randRange(60, 140);
        s.scale.set(scale, scale * 0.5, 1);
        s.position.set(randRange(-300, 300), randRange(70, 160), randRange(-100, 460));
        s.userData.speed = randRange(1.5, 4.5);
        s.userData.baseX = s.position.x;
        this.clouds.add(s);
      }
      this.scene.add(this.clouds);
    }

    _buildSnow() {
      const count = 1400;
      this.snowCount = count;
      this.snowBox = { w: 120, h: 70, d: 120 };
      const positions = new Float32Array(count * 3);
      this.snowVel = new Float32Array(count * 3);
      this.snowPhase = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        positions[i * 3] = randRange(-this.snowBox.w / 2, this.snowBox.w / 2);
        positions[i * 3 + 1] = randRange(0, this.snowBox.h);
        positions[i * 3 + 2] = randRange(-this.snowBox.d / 2, this.snowBox.d / 2);
        this.snowVel[i * 3] = randRange(-0.4, 0.4);
        this.snowVel[i * 3 + 1] = randRange(-3.2, -1.8);
        this.snowVel[i * 3 + 2] = randRange(-0.4, 0.4);
        this.snowPhase[i] = randRange(0, Math.PI * 2);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2000);

      const mat = new THREE.PointsMaterial({
        map: this.assets.get('particle'),
        color: 0xffffff,
        size: 0.9,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: true,
      });

      this.snow = new THREE.Points(geo, mat);
      this.snow.frustumCulled = false;
      this.snow.renderOrder = 4;
      this.snowPositions = positions;
      this.scene.add(this.snow);
      this._snowCenter = new THREE.Vector3();
    }

    /** Wind/altitude hook: 0 at base, 1 at summit. */
    setAltitude(t01) {
      // Snow gets a touch heavier and skies a touch cooler higher up.
      this.snow.material.opacity = 0.75 + t01 * 0.2;
    }

    update(dt, focusPos) {
      this._time += dt;

      // Sky + sun follow the camera so the dome never clips.
      if (focusPos) {
        this.sky.position.set(focusPos.x, 0, focusPos.z);
        this.sunSprite.position.copy(this.sunDir).multiplyScalar(520).add(new THREE.Vector3(focusPos.x, 0, focusPos.z));
        // Keep the shadow frustum centred on the action.
        this.sun.position.copy(this.sunDir).multiplyScalar(120).add(focusPos);
        this.sun.target.position.set(focusPos.x, focusPos.y - 4, focusPos.z);
        this.sun.target.updateMatrixWorld();
      }

      // Drift clouds.
      this.clouds.children.forEach((c) => {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 340) c.position.x = -340;
      });

      // Snow field: fall + gentle sway, wrapping inside a box around the player.
      const box = this.snowBox;
      const cx = focusPos ? focusPos.x : 0;
      const cy = focusPos ? focusPos.y : 0;
      const cz = focusPos ? focusPos.z : 0;
      const pos = this.snowPositions;
      const top = cy + box.h * 0.7;
      const bottom = cy - box.h * 0.3;
      for (let i = 0; i < this.snowCount; i++) {
        const ix = i * 3;
        this.snowPhase[i] += dt * 2;
        pos[ix] += (this.snowVel[ix] + Math.sin(this.snowPhase[i]) * 0.4) * dt;
        pos[ix + 1] += this.snowVel[ix + 1] * dt;
        pos[ix + 2] += (this.snowVel[ix + 2] + Math.cos(this.snowPhase[i] * 0.8) * 0.4) * dt;

        if (pos[ix + 1] < bottom) pos[ix + 1] = top;
        // Wrap horizontally relative to the focus point.
        if (pos[ix] < cx - box.w / 2) pos[ix] += box.w;
        else if (pos[ix] > cx + box.w / 2) pos[ix] -= box.w;
        if (pos[ix + 2] < cz - box.d / 2) pos[ix + 2] += box.d;
        else if (pos[ix + 2] > cz + box.d / 2) pos[ix + 2] -= box.d;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }

    dispose() {
      [this.sky, this.sunSprite, this.snow, this.clouds, this.hemi, this.ambient, this.sun, this.sun.target, this.fill]
        .forEach((o) => { if (o) this.scene.remove(o); });
      this.skyMat.dispose();
      this.snow.geometry.dispose();
      this.snow.material.dispose();
      if (this.envRT) this.envRT.dispose();
    }
  }

  TFW.Environment = Environment;
})(window);
