/**
 * Player.js — the hero child "Aarav": physics controller + bone animation.
 *
 * The visual character is a single procedural SkinnedMesh built by
 * CharacterRig.js (real Bone hierarchy, skin weights, facial morph targets,
 * MeshPhysicalMaterial with procedural detail maps, LOD). This file owns the
 * gameplay controller and drives that skeleton.
 *
 * The controller half (movement, gravity, jumping, ground snapping, step-up
 * walls, fall detection) is unchanged, and the public API is preserved:
 *   position, velocity, yaw, grounded, groundType, groundY, speed,
 *   controlEnabled, reset(), setControlEnabled(), getHeadPosition(),
 *   playCelebrate(), playPlant(), playInteract(), setExpression(),
 *   update(), flag, group, dispose(), and the
 *   onFootstep / onJump / onLand / onFall callbacks.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp, clamp01, damp, dampAngle, angleDelta, moveTowards, lerp } = TFW.Utils;

  /**
   * Facial expressions as morph-target weight sets plus an eye-openness value.
   * Morph names come from CharacterRig.MORPHS; "neutral" is simply all zero.
   */
  const EXPRESSIONS = {
    neutral:     { morphs: {},                    eyeOpen: 1.00 },
    happy:       { morphs: { happy: 1.0 },        eyeOpen: 0.94 },
    excited:     { morphs: { excited: 1.0 },      eyeOpen: 1.06 },
    curious:     { morphs: { curious: 1.0 },      eyeOpen: 1.04 },
    proud:       { morphs: { proud: 1.0 },        eyeOpen: 0.90 },
    celebrating: { morphs: { celebrate: 1.0 },    eyeOpen: 0.62 },
  };

  /** Rest-pose bone offsets (radians) applied on top of every animated pose. */
  const REST = {
    armL: { z: 0.10 }, armR: { z: -0.10 },
    forearmL: { x: -0.06 }, forearmR: { x: -0.06 },
    thighL: { z: 0.015 }, thighR: { z: -0.015 },
  };

  class Player {
    constructor(scene, assets, world, config, camera) {
      this.scene = scene;
      this.world = world;
      this.cfg = config.player;
      this._fallDepth = config.gameplay.fallDepth;
      this._camera = camera || null;

      this.position = new THREE.Vector3();
      this.velocity = new THREE.Vector3();
      this.yaw = 0;
      this.grounded = true;
      this.groundType = 'snow';
      this.groundY = 0;
      this.controlEnabled = true;
      this.speed = 0;

      this._coyote = 0;
      this._airTime = 0;
      this._animPhase = 0;
      this._state = 'idle';   // idle | walk | run | air
      this._action = null;    // land | interact | plant | celebrate
      this._actionT = 0;
      this._landImpact = 0;
      this._lastFallVel = 0;
      this._lastFootLeft = false;
      this._fell = false;

      this._exprForced = null;
      this._exprHold = 0;
      this._eyeOpen = 1;
      this._blinkTimer = 2 + Math.random() * 3;
      this._blink = 0;

      this.group = new THREE.Group();

      // ---- build the skinned character -------------------------------
      if (!TFW.CharacterRig || !TFW.CharacterRig.createCharacter) {
        throw new Error('Player: CharacterRig.js must load before Player.js.');
      }
      this.character = TFW.CharacterRig.createCharacter(assets);
      this.bones = this.character.bones;
      this.group.add(this.character.group);

      // Smoothed morph weights, one slot per morph target.
      this._morph = new Float32Array(this.character.morphNames.length);

      // Camera look-at height, derived from the built character rather than
      // hard-coded, so changing Config.player.height keeps the framing correct.
      this._eyeHeight = this.character.headHeight || 1.6;

      this._initRestPose();
      this._attachFlag(assets);

      // ---- optional custom Mixamo model (see Config.player.model) --------
      // Off by default. The procedural character above always loads and
      // remains the visible character until (and unless) a custom model
      // finishes loading successfully, so a missing/broken model file can
      // never leave the player invisible.
      this._customReady = false;
      this._customModel = null;
      this._lastYawForTurn = this.yaw;
      const modelCfg = this.cfg.model;
      if (modelCfg && modelCfg.enabled && TFW.GLTFCharacter) {
        this._customModel = new TFW.GLTFCharacter(modelCfg.url, this.cfg.height, {
          clipMap: modelCfg.clipMap,
          crossfade: modelCfg.crossfade,
        });
        this.group.add(this._customModel.group);
        this._customModel.onReady(() => this._onCustomModelReady());
      }

      scene.add(this.group);
      this._tmpTarget = new THREE.Vector3();
    }

    /** Called once the optional custom GLTF model has finished loading. */
    _onCustomModelReady() {
      this.character.group.visible = false;
      this._eyeHeight = this._customModel.headHeight || this._eyeHeight;
      // Re-parent the flag onto the model's own right hand if one was found;
      // THREE.Object3D#add() automatically detaches it from the old parent.
      if (this._customModel.handBone) {
        this._customModel.handBone.add(this.flag.group);
      }
      this._customReady = true;
    }

    // ------------------------------------------------------------- setup

    _initRestPose() {
      this._rest = {};
      Object.keys(this.bones).forEach((name) => {
        const r = REST[name];
        this._rest[name] = { x: (r && r.x) || 0, y: (r && r.y) || 0, z: (r && r.z) || 0 };
      });
      this._applyRest();
    }

    _applyRest() {
      Object.keys(this.bones).forEach((name) => {
        const b = this.bones[name];
        const r = this._rest[name];
        b.rotation.set(r.x, r.y, r.z);
      });
    }

    /** Set a bone rotation as rest + offset, damped for smooth transitions. */
    _bone(name, x, z, rate, dt, y) {
      const b = this.bones[name];
      if (!b) return;
      const r = this._rest[name];
      const s = rate === undefined ? 0.0016 : rate;
      b.rotation.x = damp(b.rotation.x, r.x + (x || 0), s, dt);
      b.rotation.z = damp(b.rotation.z, r.z + (z || 0), s, dt);
      if (y !== undefined) b.rotation.y = damp(b.rotation.y, r.y + y, s, dt);
    }

    _attachFlag(assets) {
      // The Tiranga is carried in the right hand, parented to the hand bone so
      // it follows the skinned arm exactly. Bone local space is unscaled, so the
      // flag carries the character scale itself.
      const S = this.character.scale || 1;
      this.flag = new TFW.Flag(assets, { poleHeight: 2.3, clothWidth: 1.4, clothHeight: 0.9, withPole: true });
      this.flag.group.scale.setScalar(0.72 * S);
      this.flag.group.position.set(0.0, -0.10 * S, 0.03 * S);
      this.flag.group.rotation.set(0.10, 0, -0.16);
      this.bones.handR.add(this.flag.group);
    }

    // ------------------------------------------------------------- state

    reset(spawn, yaw) {
      this.position.set(spawn.x, spawn.y, spawn.z);
      this.velocity.set(0, 0, 0);
      this.yaw = yaw || 0;
      this.grounded = true;
      this._coyote = 0;
      this._airTime = 0;
      this._fell = false;
      this._action = null;
      this._actionT = 0;
      this._state = 'idle';
      this._exprForced = null;
      this._exprHold = 0;
      this.controlEnabled = true;
      this._applyRest();
      for (let i = 0; i < this._morph.length; i++) this._morph[i] = 0;
      this._pushMorphs();
      this.group.position.copy(this.position);
      this.group.rotation.y = this.yaw;
    }

    setControlEnabled(v) {
      this.controlEnabled = v;
      if (!v) { this.velocity.x = 0; this.velocity.z = 0; }
    }

    getHeadPosition(out) {
      const t = out || this._tmpTarget;
      t.set(this.position.x, this.position.y + this._eyeHeight, this.position.z);
      return t;
    }

    playCelebrate() { this._action = 'celebrate'; this._actionT = 0; }
    playPlant() { this._action = 'plant'; this._actionT = 0; }
    playInteract() {
      if (this._action === 'celebrate' || this._action === 'plant') return;
      this._action = 'interact';
      this._actionT = 0;
    }

    setExpression(name, holdSeconds) {
      if (!EXPRESSIONS[name]) return;
      this._exprForced = name;
      this._exprHold = holdSeconds || 2.5;
    }

    /** Optional: let the LOD know which camera to measure distance from. */
    setCamera(camera) { this._camera = camera; }

    // ------------------------------------------------------------- update

    update(dt, move, cameraYaw, running, jumpPressed) {
      if (this.controlEnabled) {
        this._move(dt, move, cameraYaw, running, jumpPressed);
      } else {
        this.velocity.x = moveTowards(this.velocity.x, 0, this.cfg.deceleration * dt);
        this.velocity.z = moveTowards(this.velocity.z, 0, this.cfg.deceleration * dt);
        this._applyGravityAndGround(dt);
        this.speed = Math.hypot(this.velocity.x, this.velocity.z);
      }
      this.group.position.copy(this.position);
      this.group.rotation.y = this.yaw;

      this.flag.setWind(0.7 + clamp01(this.speed / this.cfg.runSpeed) * 0.9);

      if (this._customReady) {
        this._animateCustomModel(dt);
      } else {
        this._animate(dt);
        this._updateFace(dt);
      }
      if (this._customModel) this._customModel.update(dt);
      this.flag.update(dt);
      // The character LOD is auto-updated by the renderer from the active
      // camera each frame (THREE.LOD.autoUpdate), so no manual step is needed.
    }

    // ---------------------------------------------------------- controller
    // (unchanged gameplay physics — the feel is identical to before)

    _move(dt, move, cameraYaw, running, jumpPressed) {
      // Camera-relative intent:
      //   forward (W) = ( sin,  cos ), right (D) = (-cos, sin )
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      const dirX = move.y * sin - move.x * cos;
      const dirZ = move.y * cos + move.x * sin;
      const intent = Math.hypot(dirX, dirZ);

      const maxSpeed = (running ? this.cfg.runSpeed : this.cfg.walkSpeed) * move.magnitude;

      if (intent > 0.001) {
        const nx = dirX / intent;
        const nz = dirZ / intent;
        const accel = this.cfg.acceleration * (this.grounded ? 1 : this.cfg.airControl);
        this.velocity.x = moveTowards(this.velocity.x, nx * maxSpeed, accel * dt);
        this.velocity.z = moveTowards(this.velocity.z, nz * maxSpeed, accel * dt);
        this.yaw = dampAngle(this.yaw, Math.atan2(nx, nz), this.cfg.turnRate, dt);
      } else {
        const decel = this.cfg.deceleration * (this.grounded ? 1 : this.cfg.airControl);
        this.velocity.x = moveTowards(this.velocity.x, 0, decel * dt);
        this.velocity.z = moveTowards(this.velocity.z, 0, decel * dt);
      }

      if (jumpPressed && (this.grounded || this._coyote > 0)) {
        this.velocity.y = this.cfg.jumpVelocity;
        this.grounded = false;
        this._coyote = 0;
        if (this.onJump) this.onJump(this.position);
      }

      this._integrateHorizontal(dt);
      this._applyGravityAndGround(dt);
      this._updateSpeedState(running);
    }

    _integrateHorizontal(dt) {
      const dx = this.velocity.x * dt;
      const dz = this.velocity.z * dt;
      const stepUp = this.cfg.stepUp;

      const tryMove = (ax, az) => {
        const nx = this.position.x + ax;
        const nz = this.position.z + az;
        const surf = this.world.surfaceHeightAt(nx, nz);
        if (this.grounded && surf.y - this.position.y > stepUp) return false;
        this.position.x = nx;
        this.position.z = nz;
        return true;
      };

      if (!tryMove(dx, dz)) {
        const movedX = tryMove(dx, 0);
        const movedZ = tryMove(0, dz);
        if (!movedX) this.velocity.x *= 0.4;
        if (!movedZ) this.velocity.z *= 0.4;
      }
    }

    _applyGravityAndGround(dt) {
      this.velocity.y -= this.cfg.gravity * dt;
      this.velocity.y = Math.max(this.velocity.y, -this.cfg.maxFallSpeed);
      this.position.y += this.velocity.y * dt;

      const surf = this.world.surfaceHeightAt(this.position.x, this.position.z);
      this.groundY = surf.y;
      this.groundType = surf.type;

      const wasGrounded = this.grounded;
      if (this.position.y <= surf.y + this.cfg.groundSnap && this.velocity.y <= 0.01) {
        this.position.y = surf.y;
        if (!wasGrounded) {
          const impact = clamp01(-this._lastFallVel / 26);
          if (this.onLand) this.onLand(this.position, impact, surf.type);
          this._triggerLand(impact);
        }
        this.velocity.y = 0;
        this.grounded = true;
        this._coyote = this.cfg.coyoteTime;
        this._airTime = 0;
      } else {
        if (wasGrounded) this._coyote = this.cfg.coyoteTime;
        this.grounded = false;
        this._coyote = Math.max(0, this._coyote - dt);
        this._airTime += dt;
        this._lastFallVel = this.velocity.y;
      }

      this._checkFall();
    }

    _checkFall() {
      const floor = this.world.baseElevationAt(this.position.z) - this._fallDepth;
      if (!this._fell && this.position.y < floor) {
        this._fell = true;
        if (this.onFall) this.onFall();
      }
    }

    _updateSpeedState(running) {
      this.speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (!this.grounded) this._state = 'air';
      else if (this.speed > this.cfg.walkSpeed + 1.5) this._state = 'run';
      else if (this.speed > 0.4) this._state = 'walk';
      else this._state = 'idle';
    }

    // ------------------------------------------------------- bone animation

    _triggerLand(impact) {
      if (impact < 0.18) return;
      if (this._action === 'celebrate' || this._action === 'plant') return;
      this._action = 'land';
      this._actionT = 0;
      this._landImpact = impact;
    }

    _animate(dt) {
      const speed01 = clamp01(this.speed / this.cfg.runSpeed);
      const moving = this.speed > 0.4 && this.grounded;

      // Stride cycle + footstep emission.
      const freq = lerp(6, 12.5, speed01);
      if (moving && (!this._action || this._action === 'land')) {
        const prev = this._animPhase;
        this._animPhase += dt * freq;
        const s = Math.sin(this._animPhase);
        const ps = Math.sin(prev);
        if (ps < 0 && s >= 0) this._emitFoot(false);
        else if (ps > 0 && s <= 0) this._emitFoot(true);
      }

      if (this._action) {
        this._actionT += dt;
        if (this._action === 'land' && this._actionT > 0.34) this._action = null;
        else if (this._action === 'interact' && (this._actionT > 0.95 || this.speed > 2.5)) this._action = null;
        else if (this._action === 'plant' && this._actionT > 0.9) { this._action = 'celebrate'; this._actionT = 0; }
      }

      if (this._action === 'celebrate') this._poseCelebrate(dt);
      else if (this._action === 'plant') this._posePlant(dt);
      else if (this._action === 'interact') this._poseInteract(dt);
      else if (this._action === 'land') this._poseLand(dt);
      else if (this._state === 'air') this._poseAir(dt);
      else this._poseLocomotion(dt, speed01, moving);
    }

    /**
     * Drives the optional custom Mixamo model instead of the procedural bone
     * poses: keeps the same action-state machine and footstep timing as
     * _animate(), but picks/crossfades an AnimationClip instead of posing
     * individual bones.
     */
    _animateCustomModel(dt) {
      const speed01 = clamp01(this.speed / this.cfg.runSpeed);
      const moving = this.speed > 0.4 && this.grounded;
      const running = this.speed > this.cfg.walkSpeed + 1.5;

      const freq = lerp(6, 12.5, speed01);
      if (moving && (!this._action || this._action === 'land')) {
        const prev = this._animPhase;
        this._animPhase += dt * freq;
        const s = Math.sin(this._animPhase);
        const ps = Math.sin(prev);
        if (ps < 0 && s >= 0) this._emitFoot(false);
        else if (ps > 0 && s <= 0) this._emitFoot(true);
      }

      if (this._action) {
        this._actionT += dt;
        if (this._action === 'land' && this._actionT > 0.34) this._action = null;
        else if (this._action === 'interact' && (this._actionT > 0.95 || this.speed > 2.5)) this._action = null;
        else if (this._action === 'plant' && this._actionT > 0.9) { this._action = 'celebrate'; this._actionT = 0; }
      }

      // Turn-in-place detection: only relevant while grounded and not
      // already running/jumping/acting, otherwise the run/jump clip wins.
      const modelCfg = this.cfg.model || {};
      const yawRate = angleDelta(this._lastYawForTurn, this.yaw) / Math.max(dt, 0.0001);
      this._lastYawForTurn = this.yaw;
      const turningSlow = this.grounded && !this._action &&
        this.speed < (modelCfg.turnMaxSpeed === undefined ? 1.6 : modelCfg.turnMaxSpeed) &&
        Math.abs(yawRate) > (modelCfg.turnAngularSpeed === undefined ? 1.4 : modelCfg.turnAngularSpeed);

      let key;
      if (this._action === 'celebrate') key = 'celebrate';
      else if (this._action === 'plant') key = 'plant';
      else if (this._action === 'interact') key = 'interact';
      else if (this._action === 'land') key = 'land';
      else if (this._state === 'air') key = this.velocity.y > 0.5 ? 'jumpUp' : 'jumpFall';
      else if (moving) key = running ? 'run' : 'walk';
      else if (turningSlow) {
        const flipped = !!modelCfg.turnDirectionFlipped;
        const turningRight = flipped ? yawRate < 0 : yawRate > 0;
        key = turningRight ? 'turnRight' : 'turnLeft';
      } else key = 'idle';

      this._customModel.playAction(key);
      this.group.position.y = this.position.y;
    }

    _poseLocomotion(dt, speed01, moving) {
      const swing = Math.sin(this._animPhase);
      const legAmp = lerp(0.20, 0.85, speed01);
      const kneeAmp = lerp(0.25, 0.95, speed01);
      const armAmp = lerp(0.14, 0.62, speed01);
      const t = performance.now() * 0.001;

      // Legs: thigh swings, knee bends on the back-swing (real deformation now).
      this._bone('thighL', moving ? swing * legAmp : 0, 0, 0.0016, dt);
      this._bone('thighR', moving ? -swing * legAmp : 0, 0, 0.0016, dt);
      this._bone('shinL', moving ? Math.max(0, -swing) * kneeAmp : 0.02, 0, 0.0016, dt);
      this._bone('shinR', moving ? Math.max(0, swing) * kneeAmp : 0.02, 0, 0.0016, dt);
      // Ankles keep the boots roughly level with the ground.
      this._bone('footL', moving ? -swing * 0.22 : 0, 0, 0.0018, dt);
      this._bone('footR', moving ? swing * 0.22 : 0, 0, 0.0018, dt);

      // Left arm swings freely; right arm holds the flag high and steady.
      this._bone('armL', moving ? -swing * armAmp : Math.sin(t * 1.7) * 0.03, 0, 0.0016, dt);
      this._bone('forearmL', moving ? -Math.max(0, swing) * armAmp * 0.5 : 0, 0, 0.0018, dt);
      this._bone('armR', -0.62 + (moving ? swing * armAmp * 0.16 : Math.cos(t * 1.7) * 0.03), 0, 0.0018, dt);
      this._bone('forearmR', -0.55, 0, 0.002, dt);
      this._bone('shoulderL', moving ? swing * 0.06 : 0, 0, 0.003, dt);
      this._bone('shoulderR', -0.10, 0, 0.003, dt);

      // Spine leans into the run, chest counter-rotates for a natural gait.
      const breathe = moving ? 0 : Math.sin(t * 1.8) * 0.012;
      this._bone('hips', 0, moving ? swing * 0.03 : 0, 0.003, dt, moving ? -swing * 0.06 : 0);
      this._bone('spine', speed01 * 0.13 + breathe, 0, 0.0025, dt);
      this._bone('chest', speed01 * 0.07, 0, 0.0025, dt, moving ? swing * 0.08 : 0);
      this._bone('neck', -speed01 * 0.09, 0, 0.003, dt);
      this._bone('head',
        moving ? -speed01 * 0.05 : 0,
        moving ? 0 : Math.sin(t * 1.3) * 0.03,
        0.004, dt,
        moving ? 0 : Math.sin(t * 0.5) * 0.14);

      const bob = moving ? Math.abs(Math.sin(this._animPhase)) * 0.045 * (0.5 + speed01) : 0;
      this.group.position.y = this.position.y + bob;
    }

    _poseAir(dt) {
      const rising = this.velocity.y > 0.5;
      this._bone('thighL', rising ? -0.55 : 0.28, 0, 0.0012, dt);
      this._bone('thighR', rising ? 0.32 : -0.12, 0, 0.0012, dt);
      this._bone('shinL', rising ? 0.85 : 0.25, 0, 0.0012, dt);
      this._bone('shinR', rising ? 0.30 : 0.15, 0, 0.0012, dt);
      this._bone('armL', -1.15, 0, 0.0012, dt);
      this._bone('forearmL', -0.35, 0, 0.002, dt);
      this._bone('armR', -1.0, 0, 0.0014, dt);
      this._bone('forearmR', -0.5, 0, 0.002, dt);
      this._bone('spine', rising ? -0.10 : 0.12, 0, 0.002, dt);
      this._bone('chest', rising ? -0.05 : 0.06, 0, 0.002, dt);
      this._bone('head', rising ? -0.14 : 0.10, 0, 0.004, dt);
      this.group.position.y = this.position.y;
    }

    _poseLand(dt) {
      const k = 1 - clamp01(this._actionT / 0.34);
      const squash = k * (0.35 + this._landImpact * 0.45);
      this._bone('thighL', squash * 0.9, 0, 0.0012, dt);
      this._bone('thighR', squash * 0.9, 0, 0.0012, dt);
      this._bone('shinL', squash * 1.5, 0, 0.0012, dt);
      this._bone('shinR', squash * 1.5, 0, 0.0012, dt);
      this._bone('footL', -squash * 0.6, 0, 0.0015, dt);
      this._bone('footR', -squash * 0.6, 0, 0.0015, dt);
      this._bone('spine', squash * 0.55, 0, 0.0015, dt);
      this._bone('chest', squash * 0.3, 0, 0.0015, dt);
      this._bone('armL', -0.45 - squash * 0.4, 0, 0.0015, dt);
      this._bone('armR', -0.62, 0, 0.002, dt);
      this._bone('head', -squash * 0.2, 0, 0.004, dt);
      this.group.position.y = this.position.y - squash * 0.10;
    }

    _poseInteract(dt) {
      const reach = Math.sin(clamp01(this._actionT / 0.95) * Math.PI);
      this._bone('spine', 0.22 * reach, 0, 0.003, dt);
      this._bone('chest', 0.10 * reach, 0, 0.003, dt);
      this._bone('armL', -1.25 * reach, 0, 0.002, dt);
      this._bone('forearmL', -0.55 * reach, 0, 0.002, dt);
      this._bone('armR', -0.62, 0, 0.002, dt);
      this._bone('head', 0.16 * reach, 0, 0.004, dt);
      this._bone('thighL', 0, 0, 0.003, dt);
      this._bone('thighR', 0, 0, 0.003, dt);
      this._bone('shinL', 0.02, 0, 0.003, dt);
      this._bone('shinR', 0.02, 0, 0.003, dt);
      this.group.position.y = this.position.y;
    }

    _posePlant(dt) {
      // Drive the flag pole down into the snow, then rise.
      const drive = Math.sin(clamp01(this._actionT / 0.9) * Math.PI);
      this._bone('armR', -0.62 + 1.05 * drive, 0, 0.0012, dt);
      this._bone('forearmR', -0.55 + 0.30 * drive, 0, 0.002, dt);
      this._bone('armL', -0.55 * drive, 0, 0.002, dt);
      this._bone('spine', 0.28 * drive, 0, 0.002, dt);
      this._bone('chest', 0.12 * drive, 0, 0.002, dt);
      this._bone('thighL', 0.22 * drive, 0, 0.002, dt);
      this._bone('thighR', 0.22 * drive, 0, 0.002, dt);
      this._bone('shinL', 0.42 * drive, 0, 0.002, dt);
      this._bone('shinR', 0.42 * drive, 0, 0.002, dt);
      this._bone('head', 0.14 * drive, 0, 0.004, dt);
      this.group.position.y = this.position.y - drive * 0.07;
    }

    _poseCelebrate(dt) {
      const t = this._actionT;
      // Both arms punch skyward with joyful hops.
      this._bone('armL', -2.55 + Math.sin(t * 9) * 0.22, 0.45, 0.0012, dt);
      this._bone('forearmL', -0.25, 0, 0.002, dt);
      this._bone('armR', -2.45 + Math.cos(t * 9) * 0.22, -0.40, 0.0012, dt);
      this._bone('forearmR', -0.20, 0, 0.002, dt);
      this._bone('shoulderL', -0.22, 0, 0.003, dt);
      this._bone('shoulderR', -0.22, 0, 0.003, dt);
      this._bone('thighL', Math.sin(t * 11) * 0.22, 0, 0.0018, dt);
      this._bone('thighR', -Math.sin(t * 11) * 0.22, 0, 0.0018, dt);
      this._bone('shinL', 0.15 + Math.max(0, -Math.sin(t * 11)) * 0.4, 0, 0.0018, dt);
      this._bone('shinR', 0.15 + Math.max(0, Math.sin(t * 11)) * 0.4, 0, 0.0018, dt);
      this._bone('spine', -0.14, 0, 0.002, dt);
      this._bone('chest', -0.08, 0, 0.002, dt);
      this._bone('neck', -0.10, 0, 0.003, dt);
      this._bone('head', -0.12, Math.sin(t * 8) * 0.10, 0.004, dt);
      this.group.position.y = this.position.y + Math.abs(Math.sin(t * 6)) * 0.15;
    }

    _emitFoot(left) {
      this._lastFootLeft = left;
      if (this.onFootstep && this.grounded) {
        this.onFootstep(this.position, this.speed > this.cfg.walkSpeed + 1.5, this.yaw, this.groundType);
      }
    }

    // ------------------------------------------------- expressions / morphs

    _currentExpression() {
      if (this._exprHold > 0 && this._exprForced) return this._exprForced;
      if (this._action === 'celebrate' || this._action === 'plant') return 'celebrating';
      if (this._action === 'interact') return 'curious';
      if (this._state === 'run' || this._state === 'air') return 'excited';
      if (this._state === 'walk') return 'happy';
      return 'neutral';
    }

    _updateFace(dt) {
      if (this._exprHold > 0) this._exprHold -= dt;
      const expr = EXPRESSIONS[this._currentExpression()];
      const names = this.character.morphNames;
      const rate = 0.0009;

      // Blend every morph slot toward the active expression's weights.
      for (let i = 0; i < names.length; i++) {
        const target = expr.morphs[names[i]] || 0;
        this._morph[i] = damp(this._morph[i], target, rate, dt);
      }
      this._pushMorphs();

      // Blink on a natural random cadence.
      this._blinkTimer -= dt;
      if (this._blinkTimer <= 0) { this._blink = 1; this._blinkTimer = 2.4 + Math.random() * 3.2; }
      if (this._blink > 0) this._blink = Math.max(0, this._blink - dt * 7);

      this._eyeOpen = damp(this._eyeOpen, expr.eyeOpen, 0.0009, dt);
      const open = clamp01(this._eyeOpen * (1 - this._blink));
      // Lid rotates from fully open (-1.25 rad, tucked up) to closed (0.18).
      const lidX = lerp(0.18, -1.25, open);
      const eyes = this.character.eyes;
      if (eyes.lidL) {
        eyes.lidL.rotation.x = damp(eyes.lidL.rotation.x, lidX, 0.0004, dt);
        eyes.lidR.rotation.x = eyes.lidL.rotation.x;
      }
    }

    _pushMorphs() {
      const infl = this.character.mesh.morphTargetInfluences;
      if (!infl) return;
      for (let i = 0; i < this._morph.length && i < infl.length; i++) {
        infl[i] = this._morph[i];
      }
    }

    dispose() {
      this.scene.remove(this.group);
      this.flag.dispose();
      this.character.dispose();
      if (this._customModel) this._customModel.dispose();
    }
  }

  TFW.Player = Player;
})(window);
