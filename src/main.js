/**
 * main.js — bootstrap.
 *
 * Verifies the engine loaded, builds all procedural artwork with a real
 * progress bar, then hands control to the title screen. Any failure surfaces a
 * clear error overlay — the game never fails silently.
 */
(function (global) {
  'use strict';

  const TFW = global.TFW;
  const doc = global.document;

  function fail(ui, message, error) {
    const detail = error ? (error.stack || String(error)) : '';
    // eslint-disable-next-line no-console
    if (error) console.error(error);
    if (ui && ui.showError) {
      ui.showError(message, detail);
    } else {
      // UI itself failed to build — fall back to a bare-bones overlay.
      const overlay = doc.getElementById('error-overlay');
      const msg = doc.getElementById('error-message');
      const det = doc.getElementById('error-detail-text');
      if (overlay && msg) {
        msg.textContent = message;
        if (det) det.textContent = detail;
        overlay.classList.add('show');
      } else {
        global.alert(message + '\n\n' + detail);
      }
    }
  }

  async function boot() {
    // Namespace sanity check.
    if (!TFW || !TFW.UI || !TFW.Game || !TFW.AssetLoader) {
      fail(null, 'The game scripts did not all load. Please check that every file in the "src" folder is present, then reload.');
      return;
    }

    let ui;
    try {
      ui = new TFW.UI();
    } catch (e) {
      fail(null, 'The game interface could not be set up. The page may be missing some HTML.', e);
      return;
    }

    // Global safety net for unexpected runtime errors.
    global.addEventListener('error', (ev) => {
      fail(ui, 'The game hit an unexpected problem and had to stop.', ev.error || ev.message);
    });
    global.addEventListener('unhandledrejection', (ev) => {
      fail(ui, 'The game hit an unexpected problem and had to stop.', ev.reason);
    });

    // Engine present?
    if (typeof global.THREE === 'undefined') {
      fail(ui, 'The 3D engine (Three.js) could not be found. Make sure "vendor/three.min.js" exists next to index.html, then reload.');
      return;
    }

    // Detect the device and pick quality budgets BEFORE the world is built.
    if (!TFW.DeviceProfile) {
      fail(ui, 'A game module (DeviceProfile.js) is missing. Please check the "src" folder and reload.');
      return;
    }
    TFW.DeviceProfile.detect();
    TFW.DeviceProfile.apply(TFW.Config);
    ui.applyDeviceProfile(TFW.DeviceProfile);

    ui.showLoading();
    ui.setProgress(0.02, TFW.DeviceProfile.isMobile ? 'Warming up (mobile mode)' : 'Warming up the engine');

    let assets;
    try {
      assets = new TFW.AssetLoader();
      await assets.load((fraction, label) => ui.setProgress(0.05 + fraction * 0.9, label));
    } catch (e) {
      fail(ui, 'The game artwork could not be created in this browser.', e);
      return;
    }

    let game;
    try {
      const canvas = doc.getElementById('game-canvas');
      if (!canvas) throw new Error('The #game-canvas element is missing from index.html.');
      game = new TFW.Game(canvas, assets, ui);
      game.init();
    } catch (e) {
      fail(ui, 'The 3D world could not be built. Your browser may not support WebGL.', e);
      return;
    }

    ui.setProgress(1, 'Ready!');

    // Remember the player's mute choice across visits/reloads.
    const MUTE_KEY = 'tfw.muted';
    let savedMute = false;
    try { savedMute = global.localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage blocked — default to sound on */ }
    game.audio.setMuted(savedMute);
    ui.initMute(savedMute);

    ui.bind({
      onUiSound: () => { if (game.audio && game.audio.ctx) game.audio.uiClick(); },
      onPlay: () => game.startGame(),
      onPause: () => game.togglePause(),
      onResume: () => game.resume(),
      onRestart: () => game.restart(),
      onReturnTitle: () => game.returnToTitle(),
      onSignClose: () => game.gameManager.closeSign(),
      onMuteChanged: (muted) => {
        game.audio.setMuted(muted);
        try { global.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* storage blocked — fine, just won't persist */ }
      },
    });

    ui.showTitle();
    global.TFWGame = game; // handy for debugging in the console
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
