/**
 * Utils.js — tiny dependency-free math & helper toolbox.
 * Every module in the game reuses these helpers instead of re-implementing them.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  const Utils = {
    /** Clamp v into [min, max]. */
    clamp(v, min, max) {
      return v < min ? min : v > max ? max : v;
    },

    clamp01(v) {
      return Utils.clamp(v, 0, 1);
    },

    lerp(a, b, t) {
      return a + (b - a) * t;
    },

    /** Frame-rate independent exponential smoothing (a -> b). */
    damp(a, b, smoothing, dt) {
      return Utils.lerp(a, b, 1 - Math.pow(smoothing, dt));
    },

    /** Frame-rate independent approach with a rate (higher = snappier). */
    approach(a, b, rate, dt) {
      return Utils.lerp(a, b, 1 - Math.exp(-rate * dt));
    },

    moveTowards(a, b, maxDelta) {
      const d = b - a;
      if (Math.abs(d) <= maxDelta) return b;
      return a + Math.sign(d) * maxDelta;
    },

    smoothstep(t) {
      t = Utils.clamp01(t);
      return t * t * (3 - 2 * t);
    },

    smootherstep(t) {
      t = Utils.clamp01(t);
      return t * t * t * (t * (t * 6 - 15) + 10);
    },

    /** Normalised 0..1 progress of v between a and b (safe for a === b). */
    inverseLerp(a, b, v) {
      if (Math.abs(b - a) < 1e-6) return 0;
      return Utils.clamp01((v - a) / (b - a));
    },

    /** 0 at edges, 1 in the middle of [a, b] — used for chasm masks. */
    bump(v, a, b) {
      const t = Utils.inverseLerp(a, b, v);
      return Math.sin(Math.PI * t);
    },

    /** Smooth pulse: 1 inside [a+f, b-f], fading to 0 at a and b. */
    pulse(v, a, b, feather) {
      if (v <= a || v >= b) return 0;
      const inA = Utils.smoothstep(Utils.inverseLerp(a, a + feather, v));
      const inB = Utils.smoothstep(Utils.inverseLerp(b, b - feather, v));
      return Math.min(inA, inB);
    },

    /** Shortest signed angular difference (radians). */
    angleDelta(from, to) {
      let d = (to - from) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    },

    /** Smoothly rotate an angle towards a target. */
    dampAngle(from, to, rate, dt) {
      return from + Utils.angleDelta(from, to) * (1 - Math.exp(-rate * dt));
    },

    randRange(min, max) {
      return min + Math.random() * (max - min);
    },

    randInt(min, max) {
      return Math.floor(Utils.randRange(min, max + 1));
    },

    pick(list) {
      return list[Math.floor(Math.random() * list.length)];
    },

    /** Deterministic PRNG (mulberry32) so the level layout is identical every run. */
    makeRandom(seed) {
      let s = seed >>> 0;
      return function random() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    /** Stable 2D hash in 0..1. */
    hash2(x, y) {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return s - Math.floor(s);
    },

    /** Smooth value noise in 0..1. */
    noise2(x, y) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const u = Utils.smoothstep(xf);
      const v = Utils.smoothstep(yf);
      const a = Utils.hash2(xi, yi);
      const b = Utils.hash2(xi + 1, yi);
      const c = Utils.hash2(xi, yi + 1);
      const d = Utils.hash2(xi + 1, yi + 1);
      return Utils.lerp(Utils.lerp(a, b, u), Utils.lerp(c, d, u), v);
    },

    /** Fractal noise in roughly -1..1. */
    fbm(x, y, octaves) {
      let amp = 1;
      let freq = 1;
      let sum = 0;
      let norm = 0;
      const n = octaves || 3;
      for (let i = 0; i < n; i++) {
        sum += (Utils.noise2(x * freq, y * freq) * 2 - 1) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum / norm;
    },

    /**
     * Sample a smooth curve described by sorted [key, value] pairs.
     * Used for the mountain elevation "spine" and corridor widths.
     */
    sampleCurve(points, x) {
      const n = points.length;
      if (x <= points[0][0]) return points[0][1];
      if (x >= points[n - 1][0]) return points[n - 1][1];
      for (let i = 0; i < n - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (x >= a[0] && x <= b[0]) {
          const t = Utils.smoothstep((x - a[0]) / (b[0] - a[0]));
          return Utils.lerp(a[1], b[1], t);
        }
      }
      return points[n - 1][1];
    },

    /** mm:ss formatting for the HUD / result screens. */
    formatTime(seconds) {
      const s = Math.max(0, Math.floor(seconds));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    },

    /** Distance in the XZ plane (the game is gravity-aligned). */
    distXZ(ax, az, bx, bz) {
      const dx = ax - bx;
      const dz = az - bz;
      return Math.sqrt(dx * dx + dz * dz);
    },
  };

  TFW.Utils = Utils;
})(window);
