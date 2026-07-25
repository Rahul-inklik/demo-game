/**
 * Input.js — keyboard + mouse handling.
 *
 * Exposes a tiny intent API (move vector, run flag, buffered jump/interact,
 * accumulated look delta, zoom delta) so gameplay code never touches DOM events.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp } = TFW.Utils;

  const KEY_MAP = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    ShiftLeft: 'run', ShiftRight: 'run',
    Space: 'jump',
    KeyE: 'interact',
  };

  const BLOCK_DEFAULT = new Set([
    'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  ]);

  class Input {
    constructor(canvas) {
      this.canvas = canvas;
      this.enabled = false;
      this.state = { up: false, down: false, left: false, right: false, run: false };

      this.jumpBuffered = 0;      // seconds remaining in the jump buffer
      this.interactPressed = false;
      this.look = { x: 0, y: 0 }; // accumulated mouse look, consumed by the camera
      this.zoom = 0;              // accumulated wheel zoom
      this.pointerLocked = false;
      this.dragging = false;

      this.keyListeners = new Set();
      this.onPauseRequested = null;
      this.onPointerLockLost = null;

      // External (touch) intents, merged with the keyboard each frame.
      this.external = { x: 0, y: 0, magnitude: 0, run: false };
      /** When true, mouse drag/wheel look is ignored (touch drives the camera). */
      this.pointerLookEnabled = true;

      this._bind();
    }

    // -------------------------------------------------- external (touch) API

    /** Set the analogue move intent from a virtual thumbstick. */
    setExternalMove(x, y, magnitude) {
      this.external.x = x || 0;
      this.external.y = y || 0;
      this.external.magnitude = magnitude || 0;
    }

    setExternalRun(run) { this.external.run = !!run; }

    /** Buffered jump press from an on-screen button. */
    pressJump() { this.jumpBuffered = TFW.Config.player.jumpBuffer; }

    /** One-shot interact press from an on-screen button. */
    pressInteract() { this.interactPressed = true; }

    /** Accumulate a camera look delta (radians) from a touch drag. */
    addLook(x, y) {
      this.look.x += x || 0;
      this.look.y += y || 0;
    }

    /** Accumulate a zoom delta from a pinch gesture. */
    addZoom(z) { this.zoom += z || 0; }

    // ------------------------------------------------------------ public API

    addKeyListener(fn) { this.keyListeners.add(fn); }
    removeKeyListener(fn) { this.keyListeners.delete(fn); }

    /** Enable/disable movement intents (UI screens disable them). */
    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) this.reset();
    }

    reset() {
      this.state.up = this.state.down = this.state.left = this.state.right = false;
      this.state.run = false;
      this.jumpBuffered = 0;
      this.interactPressed = false;
      this.look.x = this.look.y = 0;
      this.zoom = 0;
      this.dragging = false;
      this.external.x = this.external.y = 0;
      this.external.magnitude = 0;
      this.external.run = false;
    }

    /** Normalised movement intent in screen space (x = strafe, y = forward). */
    getMove() {
      const x = (this.state.right ? 1 : 0) - (this.state.left ? 1 : 0);
      const y = (this.state.up ? 1 : 0) - (this.state.down ? 1 : 0);
      const len = Math.hypot(x, y);
      if (len > 0.0001) {
        return { x: x / len, y: y / len, magnitude: clamp(len, 0, 1) };
      }
      // Fall back to the on-screen thumbstick when no key is held.
      const e = this.external;
      const elen = Math.hypot(e.x, e.y);
      if (elen > 0.0001) {
        return { x: e.x / elen, y: e.y / elen, magnitude: clamp(e.magnitude, 0, 1) };
      }
      return { x: 0, y: 0, magnitude: 0 };
    }

    get isRunning() { return this.state.run || this.external.run; }

    /** Returns true once per jump press (buffered so early presses still count). */
    consumeJump() {
      if (this.jumpBuffered > 0) {
        this.jumpBuffered = 0;
        return true;
      }
      return false;
    }

    consumeInteract() {
      if (this.interactPressed) {
        this.interactPressed = false;
        return true;
      }
      return false;
    }

    consumeLook() {
      const l = { x: this.look.x, y: this.look.y };
      this.look.x = 0;
      this.look.y = 0;
      return l;
    }

    consumeZoom() {
      const z = this.zoom;
      this.zoom = 0;
      return z;
    }

    /** Called once per frame to age the jump buffer. */
    update(dt) {
      if (this.jumpBuffered > 0) this.jumpBuffered = Math.max(0, this.jumpBuffered - dt);
    }

    requestPointerLock() {
      if (!this.pointerLookEnabled) return;
      if (!this.canvas.requestPointerLock || this.pointerLocked) return;
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required; drag-look still works */ });
    }

    exitPointerLock() {
      if (global.document.pointerLockElement === this.canvas && global.document.exitPointerLock) {
        global.document.exitPointerLock();
      }
    }

    // ------------------------------------------------------------ internals

    _bind() {
      const doc = global.document;

      this._onKeyDown = (e) => {
        if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
        this.keyListeners.forEach((fn) => fn(e.code, e));

        if (e.code === 'KeyP' || e.code === 'Escape') {
          if (this.onPauseRequested) this.onPauseRequested(e.code);
          return;
        }
        if (!this.enabled || e.repeat) return;

        const action = KEY_MAP[e.code];
        if (!action) return;
        if (action === 'jump') this.jumpBuffered = TFW.Config.player.jumpBuffer;
        else if (action === 'interact') this.interactPressed = true;
        else this.state[action] = true;
      };

      this._onKeyUp = (e) => {
        const action = KEY_MAP[e.code];
        if (!action) return;
        if (action !== 'jump' && action !== 'interact') this.state[action] = false;
      };

      this._onBlur = () => this.reset();

      this._onMouseDown = (e) => {
        if (!this.enabled || e.button !== 0 || !this.pointerLookEnabled) return;
        this.dragging = true;
        this.requestPointerLock();
      };

      this._onMouseUp = () => { this.dragging = false; };

      this._onMouseMove = (e) => {
        if (!this.enabled || !this.pointerLookEnabled) return;
        const s = TFW.Config.camera;
        if (this.pointerLocked) {
          this.look.x += e.movementX * s.sensitivity;
          this.look.y += e.movementY * s.sensitivity;
        } else if (this.dragging) {
          this.look.x += (e.movementX || 0) * s.dragSensitivity;
          this.look.y += (e.movementY || 0) * s.dragSensitivity;
        }
      };

      this._onWheel = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.zoom += Math.sign(e.deltaY) * TFW.Config.camera.zoomStep;
      };

      this._onPointerLockChange = () => {
        const locked = global.document.pointerLockElement === this.canvas;
        const lost = this.pointerLocked && !locked;
        this.pointerLocked = locked;
        if (lost && this.onPointerLockLost) this.onPointerLockLost();
      };

      this._onContextMenu = (e) => e.preventDefault();

      doc.addEventListener('keydown', this._onKeyDown);
      doc.addEventListener('keyup', this._onKeyUp);
      global.addEventListener('blur', this._onBlur);
      this.canvas.addEventListener('mousedown', this._onMouseDown);
      doc.addEventListener('mouseup', this._onMouseUp);
      doc.addEventListener('mousemove', this._onMouseMove);
      this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
      doc.addEventListener('pointerlockchange', this._onPointerLockChange);
      this.canvas.addEventListener('contextmenu', this._onContextMenu);
    }

    dispose() {
      const doc = global.document;
      doc.removeEventListener('keydown', this._onKeyDown);
      doc.removeEventListener('keyup', this._onKeyUp);
      global.removeEventListener('blur', this._onBlur);
      this.canvas.removeEventListener('mousedown', this._onMouseDown);
      doc.removeEventListener('mouseup', this._onMouseUp);
      doc.removeEventListener('mousemove', this._onMouseMove);
      this.canvas.removeEventListener('wheel', this._onWheel);
      doc.removeEventListener('pointerlockchange', this._onPointerLockChange);
      this.canvas.removeEventListener('contextmenu', this._onContextMenu);
      this.keyListeners.clear();
    }
  }

  TFW.Input = Input;
})(window);
