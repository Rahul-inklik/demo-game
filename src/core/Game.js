/**
 * Game.js — top-level orchestrator.
 *
 * Creates the renderer/scene/camera, builds the world and all systems, wires
 * input → player/camera → gameplay, and runs the fixed-timestep-ish render
 * loop. Rendering concerns live here; gameplay rules live in GameManager.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp } = TFW.Utils;

  class Game {
    constructor(canvas, assets, ui) {
      this.canvas = canvas;
      this.assets = assets;
      this.ui = ui;
      this.config = TFW.Config;

      this.mode = 'idle';   // 'idle' | 'title' | 'running'
      this.paused = false;
      this._lastTime = 0;
      this._titleAngle = 0;
      this._focus = new THREE.Vector3();
    }

    // ------------------------------------------------------------ setup

    init() {
      this._initRenderer();
      this._initScene();

      this.environment = new TFW.Environment(this.scene, this.assets, this.config, this.renderer);
      this.course = new TFW.Course(this.scene, this.assets, this.config);
      this.effects = new TFW.Effects(this.scene, this.assets);
      // The camera is handed over so the character's LOD can pick its level.
      this.player = new TFW.Player(this.scene, this.assets, this.course, this.config, this.camera);

      const yPos = this.config.yeti.position;
      const yGround = this.course.surfaceHeightAt(yPos.x, yPos.z).y;
      this.yeti = new TFW.Yeti(this.scene, this.assets, this.config, new THREE.Vector3(yPos.x, yGround, yPos.z));

      this.cameraController = new TFW.CameraController(this.camera, this.config);
      this.input = new TFW.Input(this.canvas);
      this.audio = new TFW.AudioSystem();

      // On touch devices the on-screen pad drives the camera, so disable the
      // mouse-drag / pointer-lock path to keep the two from fighting.
      const q = this.config.quality || {};
      this.touch = null;
      if (q.hasTouch && TFW.TouchControls) {
        this.input.pointerLookEnabled = false;
        this.touch = new TFW.TouchControls(global.document.body, this.input, {
          onPause: () => this.togglePause(),
        });
      }

      this._wirePlayer();
      this._wireInput();

      this.gameManager = new TFW.GameManager({
        config: this.config,
        scene: this.scene,
        assets: this.assets,
        player: this.player,
        yeti: this.yeti,
        course: this.course,
        camera: this.cameraController,
        environment: this.environment,
        ui: this.ui,
        audio: this.audio,
        effects: this.effects,
        onVictory: () => this._onVictory(),
        onGameOver: () => this._onGameOver(),
      });

      // Park the camera on a pleasant vantage for the title screen.
      const sp = this.config.player.spawn;
      const gy = this.course.surfaceHeightAt(sp.x, sp.z).y;
      this._focus.set(sp.x, gy + 1.4, sp.z);
      this.player.reset(new THREE.Vector3(sp.x, gy, sp.z), 0);
      this.cameraController.snapTo(this.player.getHeadPosition(), 0);
      this.player.group.visible = true;

      this._onResize();
      this._resizeHandler = () => this._onResize();
      global.addEventListener('resize', this._resizeHandler);
      global.addEventListener('orientationchange', this._resizeHandler);
      if (global.visualViewport) {
        global.visualViewport.addEventListener('resize', this._resizeHandler);
        global.visualViewport.addEventListener('scroll', this._resizeHandler);
      }
      // Mobile browsers suspend audio when the tab is backgrounded; pause the
      // run so players don't come back to a dead timer or a lost life.
      global.document.addEventListener('visibilitychange', () => {
        if (global.document.hidden && this.mode === 'running' && !this.paused) this.togglePause();
      });

      this.mode = 'title';
      this._lastTime = performance.now();
      this._loop = this._loop.bind(this);
      global.requestAnimationFrame(this._loop);
    }

    _initRenderer() {
      const q = this.config.quality || {};
      const gl = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: q.antialias !== false,
        powerPreference: q.isMobile ? 'default' : 'high-performance',
      });
      gl.setPixelRatio(Math.min(global.devicePixelRatio || 1, this.config.render.maxPixelRatio));
      const size = this._viewportSize();
      gl.setSize(size.w, size.h, false);
      gl.shadowMap.enabled = q.shadows !== false;
      // A cheaper shadow filter on phones; soft PCF everywhere else.
      gl.shadowMap.type = q.isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
      gl.outputColorSpace = THREE.SRGBColorSpace;
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = this.config.render.exposure;
      this.renderer = gl;
    }

    /**
     * Visible viewport size. On mobile browsers the URL bar shows/hides, so
     * visualViewport (when present) is more reliable than innerWidth/Height.
     */
    _viewportSize() {
      const vv = global.visualViewport;
      const w = Math.max(1, Math.round((vv && vv.width) || global.innerWidth || 1));
      const h = Math.max(1, Math.round((vv && vv.height) || global.innerHeight || 1));
      return { w, h };
    }

    _initScene() {
      this.scene = new THREE.Scene();
      const r = this.config.render;
      const size = this._viewportSize();
      this.camera = new THREE.PerspectiveCamera(r.fov, size.w / size.h, r.near, r.far);
      this.camera.position.set(0, 6, -20);
    }

    _wirePlayer() {
      const fx = this.effects;
      const audio = this.audio;
      this.player.onFootstep = (pos, running, yaw, groundType) => {
        audio.footstep(running);
        fx.footstepPuff(pos);
        if (running) fx.runDust(pos, 1);
        if (groundType === 'snow') fx.footprint(pos, yaw);
      };
      this.player.onJump = (pos) => { audio.jump(); fx.jumpPuff(pos); };
      this.player.onLand = (pos, impact) => { audio.land(impact > 0.6); fx.landPuff(pos, 0.5 + impact); };
      this.player.onFall = () => this.gameManager.onPlayerFall();
    }

    _wireInput() {
      this.input.onPauseRequested = () => this.togglePause();
      this.input.addKeyListener((code) => this._onKey(code));
    }

    _onKey(code) {
      if (this.mode !== 'running') return;
      if (this.gameManager.state === TFW.GameManager.STATE.QUIZ) {
        this.ui.handleQuizKey(code);
      }
    }

    // ------------------------------------------------------------ flow

    startGame() {
      this.audio.init();
      this.audio.resume();
      this.audio.tempo = 92;
      this.audio.startAmbience();
      this.audio.startMusic('adventure');

      this.ui.hideAllScreens();
      this.ui.showHUD();
      this.player.group.visible = true;
      this.gameManager.reset();

      this.mode = 'running';
      this.paused = false;
      this._lastTime = performance.now();
      this._syncTouch();
    }

    restart() {
      this.ui.hideAllScreens();
      this.ui.hideVictory();
      this.ui.hideGameOver();
      this.ui.hidePause();
      this.ui.showHUD();
      this.ui.fadeIn();

      this.cameraController.stopCinematic();
      this.audio.stopMusic();
      this.audio.tempo = 92;
      this.audio.startAmbience();
      this.audio.startMusic('adventure');
      this.audio.setDucked(false);

      this.gameManager.reset();
      this.mode = 'running';
      this.paused = false;
      this._lastTime = performance.now();
      if (this.touch) this.touch.reset();
      this._syncTouch();
    }

    returnToTitle() {
      this.ui.hideAllScreens();
      this.ui.hideHUD();
      this.ui.fadeIn();
      this.ui.exitFullscreen();
      this.cameraController.stopCinematic();
      this.audio.stopMusic();
      this.audio.setDucked(false);
      this.input.exitPointerLock();

      // Reset the world quietly so the title backdrop looks fresh.
      this.gameManager.reset();
      this.player.group.visible = true;
      this.ui.showTitle();
      this.mode = 'title';
      if (this.touch) this.touch.reset();
      this._syncTouch();
    }

    togglePause() {
      if (this.mode !== 'running') return;
      const st = this.gameManager.state;
      if (st === TFW.GameManager.STATE.VICTORY || st === TFW.GameManager.STATE.GAMEOVER) return;

      this.paused = !this.paused;
      if (this.paused) {
        this.ui.showPause();
        this.audio.setDucked(true);
        this.input.exitPointerLock();
      } else {
        this.ui.hidePause();
        this.audio.setDucked(this.gameManager.signOpen || this.gameManager.state === TFW.GameManager.STATE.QUIZ);
        this._lastTime = performance.now();
      }
      this._syncTouch();
    }

    resume() { if (this.paused) this.togglePause(); }

    /**
     * Show the touch pad only while the player actually has control: hidden on
     * the title/pause/quiz/victory screens so it never covers a dialog.
     */
    _syncTouch() {
      if (!this.touch) return;
      const gm = this.gameManager;
      const playable =
        this.mode === 'running' &&
        !this.paused &&
        !!gm &&
        gm.canControlPlayer;
      this.touch.setEnabled(playable);
    }

    _onVictory() { this.input.exitPointerLock(); this._syncTouch(); }
    _onGameOver() { this.input.exitPointerLock(); this._syncTouch(); }

    // ------------------------------------------------------------ loop

    _loop(now) {
      global.requestAnimationFrame(this._loop);
      let dt = (now - this._lastTime) / 1000;
      this._lastTime = now;
      if (!isFinite(dt) || dt < 0) dt = 0;
      dt = clamp(dt, 0, 0.05); // guard against tab-switch spikes

      if (this.mode === 'running' && !this.paused) {
        this._updateRunning(dt);
      } else if (this.mode === 'title') {
        this._updateTitle(dt);
      }

      // Always animate the living world so menus/title have life behind them.
      this.environment.update(dt, this._focus);
      this.course.update(dt, 1);
      this.yeti.update(dt);
      this.effects.update(dt);

      this.renderer.render(this.scene, this.camera);
    }

    _updateRunning(dt) {
      const gm = this.gameManager;
      const active = gm.canControlPlayer;

      this.input.setEnabled(this.mode === 'running');
      this.input.update(dt);

      if (active) {
        this.cameraController.applyLook(this.input.consumeLook());
        this.cameraController.applyZoom(this.input.consumeZoom());
      } else {
        this.input.consumeLook();
        this.input.consumeZoom();
      }

      const move = this.input.getMove();
      const running = this.input.isRunning;
      const jump = this.input.consumeJump();
      this.player.controlEnabled = active;
      this.player.update(dt, move, this.cameraController.yaw, running, jump);

      if (this.input.consumeInteract()) gm.handleInteract();

      // The camera controller decides between orbit-follow and the cinematic
      // path internally; we just tell it where the player is each frame.
      this.cameraController.update(dt, this.player.getHeadPosition(), this.course, this.effects.getShakeOffset());

      // Snow/sky follow the flag during the ending, otherwise the player.
      if (gm.state === TFW.GameManager.STATE.CINEMATIC || gm.state === TFW.GameManager.STATE.VICTORY) {
        this._focus.copy(this.cameraController.target);
      } else {
        this._focus.copy(this.player.position);
      }

      gm.update(dt);

      // Keep the touch pad in step with gameplay state (the quiz, signs and the
      // ending cinematic all take control away mid-frame).
      if (this.touch) {
        this._syncTouch();
        this.touch.setInteractAvailable(!!gm._activeInteract);
      }
    }

    _updateTitle(dt) {
      this._titleAngle += dt * 0.12;
      const sp = this.config.player.spawn;
      const gy = this._focus.y;
      const r = 16;
      this.camera.position.set(
        sp.x + Math.sin(this._titleAngle) * r,
        gy + 7,
        sp.z + Math.cos(this._titleAngle) * r
      );
      this.camera.lookAt(sp.x, gy + 1.5, sp.z);
      this.player.update(dt, { x: 0, y: 0, magnitude: 0 }, 0, false, false);
    }

    _onResize() {
      const { w, h } = this._viewportSize();
      // Re-clamp the pixel ratio: some devices report a different DPR after an
      // orientation change or when moved to another display.
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, this.config.render.maxPixelRatio));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;

      // Portrait phones see a lot less horizontally; widen the FOV a little so
      // the trail ahead stays readable instead of feeling cropped.
      const q = this.config.quality || {};
      if (q.isMobile) {
        this.camera.fov = h > w ? 68 : 60;
      }
      this.camera.updateProjectionMatrix();
      if (this.ui && this.ui.setOrientation) this.ui.setOrientation(h > w);
    }

    dispose() {
      if (this._resizeHandler) {
        global.removeEventListener('resize', this._resizeHandler);
        global.removeEventListener('orientationchange', this._resizeHandler);
        if (global.visualViewport) {
          global.visualViewport.removeEventListener('resize', this._resizeHandler);
          global.visualViewport.removeEventListener('scroll', this._resizeHandler);
        }
      }
      if (this.touch) this.touch.dispose();
      this.gameManager.dispose();
      this.input.dispose();
      this.audio.dispose();
      this.effects.dispose();
      this.player.dispose();
      this.yeti.dispose();
      this.course.dispose();
      this.environment.dispose();
      this.renderer.dispose();
    }
  }

  TFW.Game = Game;
})(window);
