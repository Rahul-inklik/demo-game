/**
 * AssetLoader.js — builds every texture procedurally on a 2D canvas.
 *
 * The game ships with zero external image files: all artwork (tricolour cloth,
 * Ashoka Chakra, wood grain, snow, rock, ice, clouds, sparkles) is generated
 * here so the project is 100% original and works offline.
 *
 * Loading is reported step by step so the UI can show real progress, and any
 * failure throws a descriptive error (no silent fallbacks).
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  class AssetLoader {
    constructor() {
      this.textures = new Map();
      this.steps = [
        ['particle', 'Shaping snowflakes', (l) => l._particle()],
        ['glow', 'Lighting the sun', (l) => l._glow()],
        ['flag', 'Stitching the Tiranga', (l) => l._flag()],
        ['snow', 'Spreading fresh snow', (l) => l._snow()],
        ['rock', 'Carving mountain rock', (l) => l._rock()],
        ['wood', 'Building wooden bridges', (l) => l._wood()],
        ['ice', 'Freezing the river', (l) => l._ice()],
        ['cloud', 'Painting clouds', (l) => l._cloud()],
        ['footprint', 'Pressing footprints', (l) => l._footprint()],
        ['skinNormal', 'Softening skin', (l) => l._skinNormal()],
        ['skinRough', 'Polishing skin', (l) => l._skinRough()],
        ['clothNormal', 'Weaving warm fabric', (l) => l._clothNormal()],
        ['clothRough', 'Brushing the jacket', (l) => l._clothRough()],
        ['clothAO', 'Deepening fabric folds', (l) => l._clothAO()],
        ['leatherNormal', 'Tanning hiking boots', (l) => l._leatherNormal()],
        ['hairNormal', 'Combing hair strands', (l) => l._hairNormal()],
      ];
    }

    /** Load everything, awaiting a frame between steps so the loader animates. */
    async load(onProgress) {
      if (!global.document || !global.document.createElement) {
        throw new Error('This browser does not support HTML canvas, which the game needs to create its artwork.');
      }
      const total = this.steps.length;
      for (let i = 0; i < total; i++) {
        const [name, label, factory] = this.steps[i];
        const texture = factory(this);
        if (!texture) throw new Error('Failed to generate the texture "' + name + '".');
        this.textures.set(name, texture);
        if (onProgress) onProgress((i + 1) / total, label);
        await new Promise((r) => global.requestAnimationFrame(() => r()));
      }
      return this;
    }

    get(name) {
      const t = this.textures.get(name);
      if (!t) throw new Error('Requested unknown texture "' + name + '".');
      return t;
    }

    dispose() {
      this.textures.forEach((t) => t.dispose());
      this.textures.clear();
    }

    // ---------------------------------------------------------------- helpers

    static canvas(size, height) {
      const c = global.document.createElement('canvas');
      c.width = size;
      c.height = height || size;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Could not get a 2D drawing context for the game artwork.');
      return { canvas: c, ctx };
    }

    static toTexture(canvas, opts) {
      const o = opts || {};
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = o.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      if (o.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return tex;
    }

    // ------------------------------------------------- procedural PBR maps

    /**
     * Sample a height function into a Float32Array (tileable by construction
     * when the supplied function is periodic).
     * @param {number} size    map resolution
     * @param {function} fn    (u, v) in 0..1 -> height in 0..1
     */
    /**
     * Seamlessly tileable value noise. Lattice coordinates wrap modulo
     * `period`, so the resulting map repeats without visible seams.
     */
    static tileNoise(u, v, period, seed) {
      const s = seed || 0;
      const fx = u * period;
      const fy = v * period;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = TFW.Utils.smoothstep(fx - x0);
      const ty = TFW.Utils.smoothstep(fy - y0);
      const w = (ix, iy) => TFW.Utils.hash2(((ix % period) + period) % period + s * 37.1, ((iy % period) + period) % period + s * 91.7);
      const a = w(x0, y0);
      const b = w(x0 + 1, y0);
      const c = w(x0, y0 + 1);
      const d = w(x0 + 1, y0 + 1);
      return TFW.Utils.lerp(TFW.Utils.lerp(a, b, tx), TFW.Utils.lerp(c, d, tx), ty);
    }

    /** Fractal tileable noise in 0..1. */
    static tileFbm(u, v, period, octaves, seed) {
      let amp = 1;
      let per = period;
      let sum = 0;
      let norm = 0;
      const n = octaves || 3;
      for (let i = 0; i < n; i++) {
        sum += AssetLoader.tileNoise(u, v, per, (seed || 0) + i) * amp;
        norm += amp;
        amp *= 0.5;
        per *= 2;
      }
      return sum / norm;
    }

    static heightField(size, fn) {
      const h = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          h[y * size + x] = fn(x / size, y / size);
        }
      }
      return h;
    }

    /** Convert a height field into a tangent-space normal map texture. */
    static normalMapFromHeight(size, heights, strength, repeat) {
      const { canvas, ctx } = AssetLoader.canvas(size);
      const img = ctx.createImageData(size, size);
      const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
      const s = strength === undefined ? 2.0 : strength;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // Sobel gradients give a smooth, artefact-free slope estimate.
          const dx =
            (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
            (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
          const dy =
            (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
            (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
          let nx = -dx * s;
          let ny = -dy * s;
          const nz = 1;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= len; ny /= len;
          const nzn = nz / len;
          const i = (y * size + x) * 4;
          img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
          img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
          img.data[i + 2] = Math.round((nzn * 0.5 + 0.5) * 255);
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const tex = AssetLoader.toTexture(canvas, { repeat: repeat || [1, 1] });
      // Normal / roughness / AO maps are data, not colour.
      tex.colorSpace = THREE.NoColorSpace !== undefined ? THREE.NoColorSpace : THREE.LinearSRGBColorSpace;
      return tex;
    }

    /** Greyscale data map (roughness, AO, etc.) from a 0..1 function. */
    static dataMap(size, fn, repeat) {
      const { canvas, ctx } = AssetLoader.canvas(size);
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = Math.round(TFW.Utils.clamp01(fn(x / size, y / size)) * 255);
          const i = (y * size + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const tex = AssetLoader.toTexture(canvas, { repeat: repeat || [1, 1] });
      tex.colorSpace = THREE.NoColorSpace !== undefined ? THREE.NoColorSpace : THREE.LinearSRGBColorSpace;
      return tex;
    }

    /** Text label on a soft parchment plate — used by signboards. */
    static labelTexture(title, subtitle) {
      const { canvas, ctx } = AssetLoader.canvas(512, 256);
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#fff6e2');
      g.addColorStop(1, '#f2ddb8');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = '#8b5a2b';
      ctx.lineWidth = 12;
      ctx.strokeRect(10, 10, 492, 236);
      ctx.fillStyle = '#3a2a13';
      ctx.textAlign = 'center';
      ctx.font = 'bold 44px "Trebuchet MS", Verdana, sans-serif';
      const words = String(title).split(' ');
      const lines = [];
      let line = '';
      words.forEach((w) => {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > 430 && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      });
      lines.push(line);
      const startY = 128 - (lines.length - 1) * 26 - (subtitle ? 16 : 0);
      lines.forEach((l, i) => ctx.fillText(l, 256, startY + i * 52));
      if (subtitle) {
        ctx.font = 'bold 26px "Trebuchet MS", Verdana, sans-serif';
        ctx.fillStyle = '#7a5320';
        ctx.fillText(subtitle, 256, startY + lines.length * 52 + 12);
      }
      return AssetLoader.toTexture(canvas);
    }

    // ---------------------------------------------------------------- textures

    _particle() {
      const { canvas, ctx } = AssetLoader.canvas(128);
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0.0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.25)');
      g.addColorStop(1.0, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return AssetLoader.toTexture(canvas);
    }

    _glow() {
      const { canvas, ctx } = AssetLoader.canvas(256);
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0.0, 'rgba(255,255,240,1)');
      g.addColorStop(0.25, 'rgba(255,240,200,0.55)');
      g.addColorStop(0.6, 'rgba(255,225,170,0.16)');
      g.addColorStop(1.0, 'rgba(255,220,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      return AssetLoader.toTexture(canvas);
    }

    /** Indian National Flag: saffron / white / green with a 24-spoke Ashoka Chakra. */
    _flag() {
      const W = 600;
      const H = 400;
      const { canvas, ctx } = AssetLoader.canvas(W, H);
      ctx.fillStyle = '#ff9933';
      ctx.fillRect(0, 0, W, H / 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, H / 3, W, H / 3);
      ctx.fillStyle = '#138808';
      ctx.fillRect(0, (2 * H) / 3, W, H / 3);

      const cx = W / 2;
      const cy = H / 2;
      const r = H / 6 - 8;
      ctx.strokeStyle = '#000080';
      ctx.fillStyle = '#000080';

      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 2.6;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.16, cy + Math.sin(a) * r * 0.16);
        ctx.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
        ctx.stroke();
        // small spoke pin near the rim, as on the real chakra
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      return AssetLoader.toTexture(canvas);
    }

    _snow() {
      const { canvas, ctx } = AssetLoader.canvas(256);
      ctx.fillStyle = '#f7fbff';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const s = 1 + Math.random() * 2.4;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(214,232,251,0.55)' : 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      }
      return AssetLoader.toTexture(canvas, { repeat: [26, 26] });
    }

    _rock() {
      const { canvas, ctx } = AssetLoader.canvas(256);
      ctx.fillStyle = '#8c86a0';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 240; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const w = 12 + Math.random() * 60;
        const h = 8 + Math.random() * 30;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(120,114,138,0.5)' : 'rgba(168,162,186,0.5)';
        ctx.beginPath();
        ctx.ellipse(x, y, w * 0.5, h * 0.5, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      return AssetLoader.toTexture(canvas, { repeat: [8, 8] });
    }

    _wood() {
      const { canvas, ctx } = AssetLoader.canvas(256);
      ctx.fillStyle = '#a9713c';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i++) {
        ctx.strokeStyle = 'rgba(122,79,39,' + (0.15 + Math.random() * 0.4) + ')';
        ctx.lineWidth = 1 + Math.random() * 3;
        ctx.beginPath();
        const y = Math.random() * 256;
        ctx.moveTo(0, y);
        for (let x = 0; x <= 256; x += 32) {
          ctx.lineTo(x, y + Math.sin((x + i * 20) * 0.05) * 4);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = 'rgba(90,56,26,0.35)';
        ctx.beginPath();
        ctx.ellipse(Math.random() * 256, Math.random() * 256, 5, 3, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      return AssetLoader.toTexture(canvas, { repeat: [2, 2] });
    }

    _ice() {
      const { canvas, ctx } = AssetLoader.canvas(256);
      const g = ctx.createLinearGradient(0, 0, 256, 256);
      g.addColorStop(0, '#bff0ff');
      g.addColorStop(0.5, '#8fdcf8');
      g.addColorStop(1, '#cdf4ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 34; i++) {
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        let x = Math.random() * 256;
        let y = Math.random() * 256;
        ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
          x += (Math.random() - 0.5) * 90;
          y += (Math.random() - 0.5) * 90;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return AssetLoader.toTexture(canvas, { repeat: [3, 3] });
    }

    _cloud() {
      const { canvas, ctx } = AssetLoader.canvas(256, 128);
      ctx.clearRect(0, 0, 256, 128);
      const blobs = 16;
      for (let i = 0; i < blobs; i++) {
        const x = 30 + Math.random() * 196;
        const y = 60 + Math.sin(i * 1.7) * 16 + Math.random() * 10;
        const r = 18 + Math.random() * 30;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return AssetLoader.toTexture(canvas);
    }

    // -------------------------------------------- character surface detail

    /** Fine pore/crease detail for the child's skin (very subtle). */
    _skinNormal() {
      const S = 256;
      const h = AssetLoader.heightField(S, (u, v) => {
        const pores = AssetLoader.tileFbm(u, v, 48, 3, 1);
        const broad = AssetLoader.tileFbm(u, v, 8, 2, 7);
        return pores * 0.72 + broad * 0.28;
      });
      return AssetLoader.normalMapFromHeight(S, h, 0.55, [3, 3]);
    }

    /** Skin roughness: slightly shinier on raised areas, matte in creases. */
    _skinRough() {
      return AssetLoader.dataMap(256, (u, v) => {
        const n = AssetLoader.tileFbm(u, v, 16, 3, 3);
        return 0.46 + n * 0.22;
      }, [3, 3]);
    }

    /** Woven fabric: a warp/weft weave with slub irregularities. */
    _clothNormal() {
      const S = 256;
      const h = AssetLoader.heightField(S, (u, v) => {
        const warp = Math.sin(u * Math.PI * 2 * 32) * 0.5 + 0.5;
        const weft = Math.sin(v * Math.PI * 2 * 32) * 0.5 + 0.5;
        const weave = Math.max(warp * 0.9, weft * 0.9);
        const slub = AssetLoader.tileFbm(u, v, 12, 3, 11);
        return weave * 0.62 + slub * 0.38;
      });
      return AssetLoader.normalMapFromHeight(S, h, 1.5, [5, 5]);
    }

    _clothRough() {
      return AssetLoader.dataMap(256, (u, v) => {
        const weave = (Math.sin(u * Math.PI * 2 * 32) * Math.sin(v * Math.PI * 2 * 32)) * 0.5 + 0.5;
        const n = AssetLoader.tileFbm(u, v, 10, 3, 5);
        return 0.68 + weave * 0.12 + n * 0.16;
      }, [5, 5]);
    }

    /** Contact darkening inside the weave, so fabric reads as soft and thick. */
    _clothAO() {
      return AssetLoader.dataMap(256, (u, v) => {
        const weave = (Math.sin(u * Math.PI * 2 * 32) * Math.sin(v * Math.PI * 2 * 32)) * 0.5 + 0.5;
        const n = AssetLoader.tileFbm(u, v, 14, 2, 9);
        return 0.72 + weave * 0.2 + n * 0.08;
      }, [5, 5]);
    }

    /** Pebbled leather grain for the hiking boots. */
    _leatherNormal() {
      const S = 256;
      const h = AssetLoader.heightField(S, (u, v) => {
        const grain = AssetLoader.tileFbm(u, v, 26, 3, 13);
        const cracks = 1 - Math.abs(AssetLoader.tileNoise(u, v, 9, 17) - 0.5) * 2;
        return grain * 0.75 + cracks * 0.25;
      });
      return AssetLoader.normalMapFromHeight(S, h, 1.9, [4, 4]);
    }

    /** Directional strand streaks so hair catches an anisotropic highlight. */
    _hairNormal() {
      const S = 256;
      const h = AssetLoader.heightField(S, (u, v) => {
        // Stretch the noise strongly along v => long thin strands.
        const strands = AssetLoader.tileFbm(u, v * 0.08, 40, 2, 19);
        const fine = AssetLoader.tileFbm(u, v * 0.2, 90, 1, 23);
        return strands * 0.7 + fine * 0.3;
      });
      return AssetLoader.normalMapFromHeight(S, h, 2.4, [4, 1]);
    }

    _footprint() {
      const { canvas, ctx } = AssetLoader.canvas(64);
      ctx.clearRect(0, 0, 64, 64);
      const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
      g.addColorStop(0, 'rgba(150,190,225,0.85)');
      g.addColorStop(0.7, 'rgba(170,205,235,0.4)');
      g.addColorStop(1, 'rgba(190,220,245,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(32, 32, 20, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      return AssetLoader.toTexture(canvas);
    }
  }

  TFW.AssetLoader = AssetLoader;
})(window);
