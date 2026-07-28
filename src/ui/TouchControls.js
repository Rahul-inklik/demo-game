/**
 * TouchControls.js — on-screen controls for touch devices.
 *
 * Created only when DeviceProfile reports touch support, so desktop players
 * never see it. It feeds the same intent API the keyboard/mouse path uses
 * (Input.setExternalMove / setExternalRun / pressJump / pressInteract /
 * addLook / addZoom), which means gameplay code needs no touch-specific
 * branches at all.
 *
 * Layout:
 *   • left half  → virtual thumbstick (walk; hold it fully forward to sprint)
 *   • right half → drag to orbit the camera, pinch to zoom
 *   • buttons    → Jump, Interact (E), Run toggle, Pause
 *
 * Auto-sprint (PUBG Mobile / Free Fire style): pushing the stick fully forward
 * and holding it there for Config.touch.sprintHoldTime seconds starts a sprint
 * by itself — the Run button is only a convenience latch, never a requirement.
 * A ring around the stick fills up while the hold charges so the player can see
 * it coming. Because a thumb held perfectly still stops firing touchmove events,
 * that timer is advanced from the game loop via update(dt), not from events.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp, clamp01 } = TFW.Utils;

  const STICK_RADIUS = 62;   // px, visual ring radius
  const DEAD_ZONE = 0.12;

  /** Used only if Config.touch is somehow absent; the real values live there. */
  const SPRINT_DEFAULTS = {
    sprintHoldTime: 3.0,
    sprintJoystickThreshold: 0.9,
    sprintReleaseThreshold: 0.62,
    sprintForwardBias: 0.55,
    sprintDecayRate: 2.2,
  };

  class TouchControls {
    /**
     * @param {HTMLElement} root   container to mount into
     * @param {Input} input        the shared input system
     * @param {object} hooks       { onPause }
     */
    constructor(root, input, hooks) {
      this.input = input;
      this.hooks = hooks || {};
      this.enabled = false;
      this.runLatched = false;

      this._stickActive = false;
      this._stickId = null;
      this._stickOrigin = { x: 0, y: 0 };
      this._stickVec = { x: 0, y: 0 };
      /** Current stick deflection, 0..1, and how far forward it points, 0..1. */
      this._stickMag = 0;
      this._stickForward = 0;

      /** Auto-sprint: seconds of full-forward hold banked so far, and the result. */
      this._sprintHold = 0;
      this._autoSprint = false;
      this._chargeShown = -1;
      this._sprintTuning = {};

      this._lookId = null;
      this._lookLast = { x: 0, y: 0 };
      this._pinch = null;

      this._build(root);
      this._bind();
    }

    // ------------------------------------------------------------- DOM

    _build(root) {
      const d = global.document;
      const el = (cls, tag) => {
        const e = d.createElement(tag || 'div');
        e.className = cls;
        return e;
      };

      this.layer = el('touch-layer');
      this.layer.setAttribute('aria-hidden', 'true');

      // Left: movement zone + thumbstick.
      this.moveZone = el('touch-zone touch-zone-move');
      this.stick = el('touch-stick');
      // Ring that fills clockwise while the auto-sprint hold charges up.
      this.stickCharge = el('touch-stick-charge');
      this.stickKnob = el('touch-stick-knob');
      this.stick.appendChild(this.stickCharge);
      this.stick.appendChild(this.stickKnob);
      this.moveZone.appendChild(this.stick);

      // Right: camera look zone.
      this.lookZone = el('touch-zone touch-zone-look');
      this.lookHint = el('touch-look-hint');
      this.lookHint.textContent = 'drag to look • pinch to zoom';
      this.lookZone.appendChild(this.lookHint);

      // Action buttons.
      this.buttons = el('touch-buttons');
      this.btnJump = el('touch-btn touch-btn-jump', 'button');
      this.btnJump.type = 'button';
      this.btnJump.innerHTML = '<span>Jump</span>';
      this.btnJump.setAttribute('aria-label', 'Jump');

      this.btnInteract = el('touch-btn touch-btn-interact', 'button');
      this.btnInteract.type = 'button';
      this.btnInteract.innerHTML = '<span>E</span>';
      this.btnInteract.setAttribute('aria-label', 'Interact');

      this.btnRun = el('touch-btn touch-btn-run', 'button');
      this.btnRun.type = 'button';
      this.btnRun.innerHTML = '<span>Run</span>';
      this.btnRun.setAttribute('aria-label', 'Toggle running');

      this.buttons.appendChild(this.btnInteract);
      this.buttons.appendChild(this.btnJump);

      this.layer.appendChild(this.moveZone);
      this.layer.appendChild(this.lookZone);
      this.layer.appendChild(this.buttons);
      this.layer.appendChild(this.btnRun);

      root.appendChild(this.layer);
    }

    // ------------------------------------------------------------- events

    _bind() {
      const opts = { passive: false };

      // ---- movement thumbstick ----
      this._onMoveStart = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        const t = e.changedTouches ? e.changedTouches[0] : e;
        if (this._stickId !== null) return;
        this._stickId = t.identifier !== undefined ? t.identifier : 'mouse';
        this._stickActive = true;
        // Anchor the stick where the thumb landed for a natural feel.
        const rect = this.moveZone.getBoundingClientRect();
        this._stickOrigin.x = t.clientX;
        this._stickOrigin.y = t.clientY;
        this.stick.style.left = (t.clientX - rect.left) + 'px';
        this.stick.style.top = (t.clientY - rect.top) + 'px';
        this.stick.classList.add('active');
        this._updateStick(t.clientX, t.clientY);
      };

      this._onMoveMove = (e) => {
        if (!this.enabled || !this._stickActive) return;
        const t = this._findTouch(e, this._stickId);
        if (!t) return;
        e.preventDefault();
        this._updateStick(t.clientX, t.clientY);
      };

      this._onMoveEnd = (e) => {
        if (!this._stickActive) return;
        if (this._findTouch(e, this._stickId, true)) {
          this._stickActive = false;
          this._stickId = null;
          this._stickVec.x = this._stickVec.y = 0;
          this._stickMag = 0;
          this._stickForward = 0;
          this.stick.classList.remove('active');
          this.stickKnob.style.transform = 'translate(-50%, -50%)';
          this.input.setExternalMove(0, 0, 0);
          // Lifting the thumb always ends the sprint and discards its charge.
          this._cancelSprint();
          this._applyRun();
        }
      };

      this.moveZone.addEventListener('touchstart', this._onMoveStart, opts);
      this.moveZone.addEventListener('touchmove', this._onMoveMove, opts);
      global.addEventListener('touchend', this._onMoveEnd, opts);
      global.addEventListener('touchcancel', this._onMoveEnd, opts);

      // ---- camera look / pinch zoom ----
      this._onLookStart = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        if (e.touches && e.touches.length >= 2) {
          this._beginPinch(e);
          return;
        }
        const t = e.changedTouches ? e.changedTouches[0] : e;
        if (this._lookId !== null) return;
        this._lookId = t.identifier !== undefined ? t.identifier : 'mouse';
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
      };

      this._onLookMove = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        if (this._pinch && e.touches && e.touches.length >= 2) {
          this._updatePinch(e);
          return;
        }
        const t = this._findTouch(e, this._lookId);
        if (!t) return;
        const dx = t.clientX - this._lookLast.x;
        const dy = t.clientY - this._lookLast.y;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
        const s = TFW.Config.camera.touchSensitivity || 0.0062;
        this.input.addLook(dx * s, dy * s);
      };

      this._onLookEnd = (e) => {
        if (e.touches && e.touches.length < 2) this._pinch = null;
        if (this._lookId !== null && this._findTouch(e, this._lookId, true)) {
          this._lookId = null;
        }
      };

      this.lookZone.addEventListener('touchstart', this._onLookStart, opts);
      this.lookZone.addEventListener('touchmove', this._onLookMove, opts);
      this.lookZone.addEventListener('touchend', this._onLookEnd, opts);
      this.lookZone.addEventListener('touchcancel', this._onLookEnd, opts);

      // ---- buttons ----
      this._tap = (el, fn) => {
        const down = (e) => {
          if (!this.enabled) return;
          e.preventDefault();
          e.stopPropagation();
          el.classList.add('pressed');
          fn();
        };
        const up = (e) => {
          e.preventDefault();
          el.classList.remove('pressed');
        };
        el.addEventListener('touchstart', down, opts);
        el.addEventListener('touchend', up, opts);
        el.addEventListener('touchcancel', up, opts);
        // Also work with a mouse for desktop testing of the touch layer.
        el.addEventListener('mousedown', down);
        el.addEventListener('mouseup', up);
      };

      this._tap(this.btnJump, () => this.input.pressJump());
      this._tap(this.btnInteract, () => this.input.pressInteract());
      this._tap(this.btnRun, () => this._toggleRun());
    }

    _findTouch(e, id, ended) {
      const list = ended ? (e.changedTouches || []) : (e.touches || e.changedTouches || []);
      if (id === 'mouse') return e;
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    }

    _updateStick(cx, cy) {
      let dx = cx - this._stickOrigin.x;
      let dy = cy - this._stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const max = STICK_RADIUS;
      const mag = clamp01(len / max);
      // How far towards the top of the screen the thumb is pushed, as a 0..1
      // cosine. Measured from the raw delta, before the knob gets clamped to the
      // ring, so it stays accurate once the stick is pinned at full deflection.
      const forward = len > 0.0001 ? -dy / len : 0;
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.stickKnob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';

      const nx = len > 0.0001 ? (cx - this._stickOrigin.x) / Math.max(len, max) : 0;
      const ny = len > 0.0001 ? (cy - this._stickOrigin.y) / Math.max(len, max) : 0;
      if (mag < DEAD_ZONE) {
        this._stickVec.x = this._stickVec.y = 0;
        this._stickMag = 0;
        this._stickForward = 0;
        this.input.setExternalMove(0, 0, 0);
        // Thumb back at the centre is a deliberate stop, so end the sprint now
        // instead of waiting for the next update(dt).
        this._cancelSprint();
        this._applyRun();
        return;
      }
      // Screen space: up on the stick means forward in the game.
      const scaled = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
      this._stickVec.x = clamp(nx, -1, 1);
      this._stickVec.y = clamp(-ny, -1, 1);
      this._stickMag = mag;
      this._stickForward = forward;
      this.input.setExternalMove(this._stickVec.x, this._stickVec.y, clamp01(scaled));

      // Whether this counts as a sprint is decided in update(dt), which is the
      // only place that sees elapsed time.
      this._applyRun();
    }

    // --------------------------------------------------------- auto-sprint

    /**
     * Per-frame tick, called from the game loop before the move intent is read.
     *
     * Holding the stick fully forward banks time; once Config.touch.sprintHoldTime
     * is reached the sprint latches on and stays on through steering, only
     * dropping when the stick eases back past sprintReleaseThreshold. That
     * hysteresis gap is what makes it feel like PUBG Mobile rather than a run
     * flag that stutters every time the thumb moves.
     */
    update(dt) {
      if (!this.enabled) return;
      const cfg = this._sprintCfg();
      const mag = this._stickActive ? this._stickMag : 0;
      const forward = this._stickActive ? this._stickForward : 0;

      if (this._autoSprint) {
        if (mag < cfg.sprintReleaseThreshold) this._cancelSprint();
      } else if (mag >= cfg.sprintJoystickThreshold && forward >= cfg.sprintForwardBias) {
        this._sprintHold = Math.min(cfg.sprintHoldTime, this._sprintHold + dt);
        if (this._sprintHold >= cfg.sprintHoldTime) this._autoSprint = true;
      } else if (this._sprintHold > 0) {
        this._sprintHold = Math.max(0, this._sprintHold - dt * cfg.sprintDecayRate);
      }

      this._applyRun();
      const charge = cfg.sprintHoldTime > 0 ? clamp01(this._sprintHold / cfg.sprintHoldTime) : 0;
      // Once sprinting the ring is redundant (the stick itself lights up), so
      // hide it and let the charge read as "complete".
      this._showCharge(this._autoSprint ? 0 : charge);
    }

    /** Resolve the sprint tuning from Config into a reused object (no per-frame garbage). */
    _sprintCfg() {
      const t = (TFW.Config && TFW.Config.touch) || {};
      const out = this._sprintTuning;
      for (const k in SPRINT_DEFAULTS) {
        out[k] = t[k] === undefined ? SPRINT_DEFAULTS[k] : t[k];
      }
      return out;
    }

    /** The one place that decides whether the run intent is on. */
    _applyRun() {
      const run = this.runLatched || this._autoSprint;
      this.input.setExternalRun(run);
      this.stick.classList.toggle('running', run);
    }

    _cancelSprint() {
      this._autoSprint = false;
      this._sprintHold = 0;
      this._showCharge(0);
    }

    /** Drive the charge ring, skipping the DOM write when nothing changed. */
    _showCharge(p) {
      const v = clamp01(p);
      if (v === this._chargeShown) return;
      // Ignore sub-degree wiggles mid-charge, but always write an exact 0 so the
      // ring can never be left stuck part-filled.
      if (v > 0 && Math.abs(v - this._chargeShown) < 0.004) return;
      this._chargeShown = v;
      this.stickCharge.style.setProperty('--sprint-charge', (v * 360).toFixed(1) + 'deg');
      this.stick.classList.toggle('charging', v > 0.001);
    }

    _toggleRun() {
      this.runLatched = !this.runLatched;
      this.btnRun.classList.toggle('latched', this.runLatched);
      this._applyRun();
    }

    _beginPinch(e) {
      const a = e.touches[0];
      const b = e.touches[1];
      this._pinch = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    }

    _updatePinch(e) {
      const a = e.touches[0];
      const b = e.touches[1];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const delta = this._pinch.dist - dist;
      this._pinch.dist = dist;
      // Pinch in => zoom out (increase camera distance).
      this.input.addZoom(delta * 0.035);
    }

    // ------------------------------------------------------------- API

    setEnabled(on) {
      this.enabled = !!on;
      this.layer.classList.toggle('show', this.enabled);
      if (!this.enabled) this.reset();
    }

    reset() {
      this._stickActive = false;
      this._stickId = null;
      this._lookId = null;
      this._pinch = null;
      this._stickVec.x = this._stickVec.y = 0;
      this._stickMag = 0;
      this._stickForward = 0;
      this.runLatched = false;
      this._cancelSprint();
      this.btnRun.classList.remove('latched');
      this.stick.classList.remove('active', 'running', 'charging');
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      this.input.setExternalMove(0, 0, 0);
      this.input.setExternalRun(false);
    }

    /** Highlight the interact button while something is in range. */
    setInteractAvailable(on) {
      this.btnInteract.classList.toggle('available', !!on);
    }

    dispose() {
      global.removeEventListener('touchend', this._onMoveEnd);
      global.removeEventListener('touchcancel', this._onMoveEnd);
      if (this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
    }
  }

  TFW.TouchControls = TouchControls;
})(window);
