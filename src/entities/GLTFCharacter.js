/**
 * GLTFCharacter.js — optional loader/wrapper for a custom Mixamo-rigged
 * GLB/GLTF character model, used as a drop-in replacement for the built-in
 * procedural character (see CharacterRig.js).
 *
 * This is entirely optional and off by default (Config.player.model.enabled).
 * The model streams in asynchronously; Player.js keeps using the safe,
 * always-available procedural character until the custom model has finished
 * loading, then swaps the visuals over. If the file is missing, malformed, or
 * the browser can't parse it, the game quietly keeps the procedural
 * character and logs a warning — the game never breaks because of a missing
 * or bad model file.
 *
 * What this file does:
 *   - Loads the .glb/.gltf with THREE.GLTFLoader (vendor/GLTFLoader.js).
 *   - Scales the model uniformly to match Config.player.height.
 *   - Finds the right-hand bone (to hang the flag from) and the head bone
 *     (for camera framing) using common Mixamo naming conventions.
 *   - Builds an AnimationMixer and maps the file's AnimationClips onto the
 *     game's logical action names (idle/walk/run/jumpUp/jumpFall/land/
 *     interact/plant/celebrate), either from Config.player.model.clipMap or
 *     by guessing from clip names.
 *   - Exposes playAction(name) which crossfades between clips.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  /** Lowercase, alphanumeric-only — makes bone-name matching robust to the
   *  many separator styles exporters use ("mixamorig:RightHand", "Hand_R",
   *  "hand.R", "RightHand", ...). */
  function normalize(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isFingerBone(n) {
    return /(thumb|index|middle|ring|pinky)/.test(n);
  }

  function isHandBone(n, side) {
    if (isFingerBone(n)) return false;
    if (side === 'right') {
      return n.endsWith('righthand') || n.endsWith('handright') || n.endsWith('handr') ||
        (n.indexOf('hand') !== -1 && n.indexOf('right') !== -1);
    }
    return n.endsWith('lefthand') || n.endsWith('handleft') || n.endsWith('handl') ||
      (n.indexOf('hand') !== -1 && n.indexOf('left') !== -1);
  }

  function isHeadBone(n) {
    // Matches "mixamorigHead" but not "mixamorigHeadTop_End" or "...Neck".
    return n.endsWith('head');
  }

  /** Logical action name -> list of substrings to look for in clip names. */
  const CLIP_KEYWORDS = {
    idle: ['idle', 'breathing', 'stand'],
    walk: ['walk', 'run'],
    run: ['fast_run', 'fast run', 'sprint', 'run', 'jog'],
    jumpUp: ['jumpup', 'jump up', 'jump_start', 'jumping up', 'jump'],
    jumpFall: ['fall', 'jumpdown', 'jump down', 'falling', 'jump'],
    land: ['land'],
    interact: ['talking', 'interact', 'wave', 'look around', 'yes'],
    plant: ['victory', 'plant', 'pickup', 'pick up', 'throw'],
    celebrate: ['victory', 'cheer', 'dance', 'celebrat', 'yell'],
    turnLeft: ['left turn', 'left_turn', 'turnleft'],
    turnRight: ['right turn', 'right_turn', 'turnright'],
  };

  class GLTFCharacter {
    /**
     * @param {string} url            path to the .glb/.gltf file
     * @param {number} targetHeight   world-unit height to scale the model to
     * @param {object} opts           { clipMap, crossfade }
     */
    constructor(url, targetHeight, opts) {
      const o = opts || {};
      this.group = new THREE.Group();
      this.ready = false;
      this.loadFailed = false;
      this.handBone = null;
      this.headBone = null;
      this.headHeight = targetHeight * 0.9; // refined once the model loads
      this.mixer = null;
      this.actions = {};
      this.currentKey = null;
      this._current = null;
      this._crossfade = o.crossfade === undefined ? 0.25 : o.crossfade;
      this._readyCallbacks = [];

      if (!global.THREE || !THREE.GLTFLoader) {
        this.loadFailed = true;
        // eslint-disable-next-line no-console
        console.warn('GLTFCharacter: THREE.GLTFLoader is not available (check that vendor/GLTFLoader.js loaded). Keeping the built-in character.');
        return;
      }

      const loader = new THREE.GLTFLoader();
      loader.load(
        url,
        (gltf) => this._onLoaded(gltf, targetHeight, o.clipMap || {}),
        undefined,
        (err) => this._onError(err, url)
      );
    }

    /** Runs cb immediately if already loaded, otherwise queues it. */
    onReady(cb) {
      if (this.ready) cb();
      else this._readyCallbacks.push(cb);
    }

    _onError(err, url) {
      this.loadFailed = true;
      // eslint-disable-next-line no-console
      console.warn('GLTFCharacter: could not load "' + url + '" (' + (err && err.message ? err.message : err) + '). Keeping the built-in character.');
    }

    _onLoaded(gltf, targetHeight, clipMap) {
      const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) {
        this._onError(new Error('glTF file has no scene'), '');
        return;
      }

      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = false;
          // The character is always close to the camera; matches the same
          // choice made for the procedural rig in CharacterRig.js.
          o.frustumCulled = false;
        }
        if (o.isBone) {
          const n = normalize(o.name);
          if (!this.handBone && isHandBone(n, 'right')) this.handBone = o;
          if (!this.headBone && isHeadBone(n)) this.headBone = o;
        }
      });

      // Uniform scale so the model matches the gameplay height, then plant
      // its feet at y=0 and centre it on X/Z (Player.js drives group.position
      // itself, so the model's own origin must be at its feet).
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const rawHeight = Math.max(0.0001, box.max.y - box.min.y);
      const scale = targetHeight / rawHeight;
      root.scale.setScalar(scale);
      root.updateMatrixWorld(true);

      const box2 = new THREE.Box3().setFromObject(root);
      root.position.x -= (box2.max.x + box2.min.x) / 2;
      root.position.z -= (box2.max.z + box2.min.z) / 2;
      root.position.y -= box2.min.y;
      root.updateMatrixWorld(true);

      this.group.add(root);
      this.root = root;

      if (this.headBone) {
        const world = new THREE.Vector3();
        this.headBone.getWorldPosition(world);
        this.headHeight = this.group.worldToLocal(world.clone()).y;
      } else {
        const box3 = new THREE.Box3().setFromObject(root);
        this.headHeight = (box3.max.y - box3.min.y) * 0.92;
      }

      this.mixer = new THREE.AnimationMixer(root);
      this._resolveClips(gltf.animations || [], clipMap);

      this.ready = true;
      this._readyCallbacks.forEach((cb) => cb());
      this._readyCallbacks.length = 0;
    }

    _resolveClips(clips, clipMap) {
      Object.keys(CLIP_KEYWORDS).forEach((key) => {
        let clip = null;
        const explicitName = clipMap[key];
        if (explicitName) {
          clip = clips.find((c) => c.name === explicitName) || null;
          if (!clip) {
            // eslint-disable-next-line no-console
            console.warn('GLTFCharacter: clipMap.' + key + ' = "' + explicitName + '" was not found in the file.');
          }
        }
        if (!clip) {
          const words = CLIP_KEYWORDS[key];
          clip = clips.find((c) => {
            const n = c.name.toLowerCase();
            return words.some((w) => n.indexOf(w) !== -1);
          }) || null;
        }
        if (clip) {
          const action = this.mixer.clipAction(clip);
          action.loop = THREE.LoopRepeat;
          this.actions[key] = action;
        }
      });

      if (Object.keys(this.actions).length === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          'GLTFCharacter: none of the expected animation clips were found automatically. ' +
          'Clip names in this file: [' + clips.map((c) => c.name).join(', ') + ']. ' +
          'Fill in the exact names under Config.player.model.clipMap.'
        );
      }
    }

    /**
     * Crossfade to a logical action. Valid keys: idle, walk, run, jumpUp,
     * jumpFall, land, interact, plant, celebrate. Missing keys fall back to
     * "idle" if available; if no clips loaded at all, this is a no-op (the
     * model will simply hold its bind pose).
     */
    playAction(key) {
      if (!this.ready) return;
      const next = this.actions[key] || this.actions.idle;
      if (!next || next === this._current) return;

      const dur = this._crossfade;
      next.reset().setEffectiveWeight(1);
      if (this._current) {
        next.fadeIn(dur).play();
        this._current.fadeOut(dur);
      } else {
        next.play();
      }
      this._current = next;
      this.currentKey = key;
    }

    update(dt) {
      if (this.mixer) this.mixer.update(dt);
    }

    dispose() {
      if (this.mixer) this.mixer.stopAllAction();
      this.group.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m) return;
          Object.keys(m).forEach((k) => { if (m[k] && m[k].isTexture) m[k].dispose(); });
          m.dispose();
        });
      });
    }
  }

  TFW.GLTFCharacter = GLTFCharacter;
})(window);
