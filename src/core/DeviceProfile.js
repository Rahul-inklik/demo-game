/**
 * DeviceProfile.js — detects the device and tunes quality before the world is
 * built.
 *
 * Runs once at boot, *before* Game.init(), and writes the chosen budgets into
 * Config.quality. Every system (Course, Environment, Effects, renderer, LOD)
 * reads those numbers instead of hard-coded constants, so one profile switch
 * scales the whole game from a phone to a desktop.
 *
 * Touch controls are shown only when the device actually reports touch input.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  /** Rendering / population budgets per tier. */
  const TIERS = {
    // Phones and low-power tablets.
    low: {
      name: 'low',
      maxPixelRatio: 1.4,
      shadows: true,
      shadowMapSize: 1024,
      antialias: false,
      trees: 80,
      rocks: 34,
      birds: 3,
      decorScale: 0.42,
      snowCount: 420,
      clouds: 7,
      sparkParticles: 320,
      puffParticles: 240,
      footprints: 14,
      terrainSegX: 130,
      terrainSegZ: 190,
      distantPeaks: 0.6,
      // Must stay above camera.maxDistance so zooming out never swaps the
      // model in view (that read as an ugly pop).
      characterLodDistance: 26,
      fogFar: 380,
      fireworkShellParticles: 34,
      celebrateParticles: 40,
    },
    // Big tablets / weaker laptops.
    medium: {
      name: 'medium',
      maxPixelRatio: 1.6,
      shadows: true,
      shadowMapSize: 1536,
      antialias: true,
      trees: 140,
      rocks: 60,
      birds: 5,
      decorScale: 0.72,
      snowCount: 850,
      clouds: 11,
      sparkParticles: 600,
      puffParticles: 460,
      footprints: 22,
      terrainSegX: 170,
      terrainSegZ: 250,
      distantPeaks: 0.85,
      characterLodDistance: 30,
      fogFar: 460,
      fireworkShellParticles: 52,
      celebrateParticles: 70,
    },
    // Desktop: the original full-fat settings.
    high: {
      name: 'high',
      maxPixelRatio: 1.9,
      shadows: true,
      shadowMapSize: 2048,
      antialias: true,
      trees: 200,
      rocks: 85,
      birds: 6,
      decorScale: 1,
      snowCount: 1400,
      clouds: 14,
      sparkParticles: 900,
      puffParticles: 700,
      footprints: 30,
      terrainSegX: 220,
      terrainSegZ: 320,
      distantPeaks: 1,
      characterLodDistance: 34,
      fogFar: 520,
      fireworkShellParticles: 70,
      celebrateParticles: 90,
    },
  };

  const DeviceProfile = {
    /** True when the browser reports a touch-capable screen. */
    hasTouch: false,
    /** True for phone/tablet-class devices (drives UI layout + quality). */
    isMobile: false,
    isSmallScreen: false,
    tierName: 'high',
    tier: TIERS.high,

    detect() {
      const nav = global.navigator || {};
      const ua = String(nav.userAgent || '');

      const maxTouch = nav.maxTouchPoints || 0;
      const coarse = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
      this.hasTouch = ('ontouchstart' in global) || maxTouch > 0 || coarse;

      // Treat iPadOS (which reports as Mac) as mobile when it exposes touch.
      const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile|Silk/i.test(ua);
      const macTouch = /Macintosh/.test(ua) && maxTouch > 1;

      const w = global.innerWidth || 1280;
      const h = global.innerHeight || 720;
      const minSide = Math.min(w, h);
      this.isSmallScreen = minSide <= 820;

      this.isMobile = (uaMobile || macTouch) || (this.hasTouch && this.isSmallScreen);

      // Pick a tier from device class, memory and core count where available.
      const mem = nav.deviceMemory || nav.deviceMemoryGB || 0; // non-standard, may be absent
      const ramGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : (nav.deviceMemoryGB || 0);
      const cores = nav.hardwareConcurrency || 0;

      let tier;
      if (!this.isMobile) {
        tier = 'high';
      } else if (minSide <= 400 || (cores && cores <= 4) || (ramGB && ramGB <= 3)) {
        tier = 'low';
      } else {
        tier = 'medium';
      }

      // Honour the OS "reduce motion / save data" hints by dropping a tier.
      const reduceMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const saveData = !!(nav.connection && nav.connection.saveData);
      if ((reduceMotion || saveData) && tier === 'high') tier = 'medium';
      else if ((reduceMotion || saveData) && tier === 'medium') tier = 'low';

      this.tierName = tier;
      this.tier = TIERS[tier];
      return this;
    },

    /** Write the chosen budgets into Config so every system picks them up. */
    apply(config) {
      const t = this.tier;
      config.quality = Object.assign({}, t, {
        isMobile: this.isMobile,
        hasTouch: this.hasTouch,
      });
      config.render.maxPixelRatio = t.maxPixelRatio;
      config.render.shadowMapSize = t.shadowMapSize;
      config.render.fogFar = t.fogFar;

      if (this.isMobile) {
        // Slightly wider than desktop so the trail ahead stays readable on a
        // small screen, but still tight enough to keep the hero prominent.
        config.render.fov = 60;
        config.render.far = 780;
        // Touch steering is less precise than a mouse, so make the controller
        // a touch more forgiving without changing the feel on desktop.
        config.player.coyoteTime = 0.22;
        config.player.jumpBuffer = 0.22;
        config.gameplay.interactRange = 5.2;
        config.yeti.triggerRadius = 8.5;
        config.camera.distance = 7.6;
        config.camera.height = 2.2;
      }
      return config.quality;
    },

    /** Convenience used by systems that only need a number. */
    q(config, key, fallback) {
      const quality = config.quality;
      if (quality && quality[key] !== undefined) return quality[key];
      return fallback;
    },
  };

  DeviceProfile.TIERS = TIERS;
  TFW.DeviceProfile = DeviceProfile;
})(window);
