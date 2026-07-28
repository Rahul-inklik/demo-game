/**
 * GameManager.js — gameplay rules and flow (kept separate from rendering).
 *
 * Owns score, lives, timer, checkpoints, respawning, the Yeti dialogue + quiz
 * sequence and the summit flag-planting / victory cinematic. It reacts to the
 * player's position and drives the UI, audio and effect systems through the
 * references handed to it by Game.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp, distXZ, pick } = TFW.Utils;

  const STATE = { PLAYING: 'playing', QUIZ: 'quiz', PLANTING: 'planting', CINEMATIC: 'cinematic', VICTORY: 'victory', GAMEOVER: 'gameover' };

  class GameManager {
    constructor(ctx) {
      this.ctx = ctx; // { config, player, yeti, course, camera, ui, audio, effects, assets, scene }
      this.cfg = ctx.config;

      this.quiz = new TFW.Quiz(this.cfg.quiz, {
        onQuestion: (q, i, total) => this._onQuizQuestion(q, i, total),
        onCorrect: (q, chosen) => this._onQuizCorrect(q, chosen),
        onWrong: (q, chosen) => this._onQuizWrong(q, chosen),
        onComplete: (correct, total) => this._onQuizComplete(correct, total),
      });

      this._timers = [];
      this._dialogue = { queue: [], timer: 0, name: '', onDone: null };
      this._plantedFlag = null;
      this._baseY = 0;
    }

    // ------------------------------------------------------------ lifecycle

    reset() {
      const c = this.ctx;
      this._clearTimers();
      this._dialogue = { queue: [], timer: 0, name: '', onDone: null };

      this.state = STATE.PLAYING;
      this.score = 0;
      this.lives = this.cfg.gameplay.startLives;
      this.time = 0;
      this.currentCheckpoint = 0;
      this.quizTriggered = false;
      this.signOpen = false;
      this.flagPlanted = false;
      this._plantProgress = 0;
      this._cinemaTimer = 0;
      this._fwTimer = 0;
      this._readSigns = new Set();

      this.quiz.reset();

      // Spawn.
      const sp = this.cfg.player.spawn;
      const groundY = c.course.surfaceHeightAt(sp.x, sp.z).y;
      this._baseY = groundY;
      const spawnVec = new THREE.Vector3(sp.x, groundY, sp.z);
      c.player.reset(spawnVec, this.cfg.player.spawnYaw);
      c.camera.stopCinematic();
      c.camera.stopConversation();
      c.camera.snapTo(c.player.getHeadPosition(), this.cfg.player.spawnYaw);

      // Claim base camp immediately.
      this.respawnPoint = { x: sp.x, z: sp.z, yaw: this.cfg.player.spawnYaw };
      c.course.checkpoints[0].activate();
      c.course.resetBridge();
      this.objective = c.course.checkpoints[0].objective;
      this.checkpointName = c.course.checkpoints[0].name;

      // Remove any planted flag from a previous run.
      if (this._plantedFlag) {
        c.scene.remove(this._plantedFlag.group);
        this._plantedFlag.dispose();
        this._plantedFlag = null;
      }
      c.player.flag.group.visible = true;

      c.yeti.setState('idle');
      c.effects.reset();
      this._pushHUD();
    }

    get canControlPlayer() {
      return this.state === STATE.PLAYING && !this.signOpen;
    }

    // ------------------------------------------------------------ per-frame

    update(dt) {
      if (this.state === STATE.PLAYING || this.state === STATE.QUIZ) {
        if (this.state === STATE.PLAYING && !this.signOpen) this.time += dt;
      }

      this._updateDialogue(dt);

      const player = this.ctx.player;
      const altitude = player.position.y - this._baseY;
      const climb01 = clamp((player.position.y - this._baseY) / 96, 0, 1);
      this.ctx.audio.setAltitude(climb01);
      this.ctx.environment && this.ctx.environment.setAltitude(climb01);

      if (this.state === STATE.PLAYING) {
        this._checkCheckpoints();
        this._checkYetiTrigger();
        this._checkInteractables();
      }

      if (this.state === STATE.PLANTING) this._updatePlanting(dt);
      if (this.state === STATE.CINEMATIC) this._updateCinematic(dt);

      // Yeti gently faces the player when they are close.
      if (distXZ(player.position.x, player.position.z, this.ctx.yeti.position.x, this.ctx.yeti.position.z) < 16) {
        this.ctx.yeti.lookAt(player.position);
      }

      this._pushHUD(altitude);
    }

    _pushHUD(altitude) {
      this.ctx.ui.updateHUD({
        time: this.time,
        score: this.score,
        lives: this.lives,
        checkpoint: this.checkpointName,
        objective: this.objective,
        altitude: altitude !== undefined ? altitude : (this.ctx.player.position.y - this._baseY),
      });
    }

    // ------------------------------------------------------------ checkpoints

    _checkCheckpoints() {
      const next = this.currentCheckpoint + 1;
      const list = this.ctx.course.checkpoints;
      if (next >= list.length) return;
      const cp = list[next];
      const p = this.ctx.player.position;
      if (distXZ(p.x, p.z, cp.position.x, cp.position.z) < cp.radius) {
        this._claimCheckpoint(next);
      }
    }

    _claimCheckpoint(index) {
      const cp = this.ctx.course.checkpoints[index];
      cp.activate();
      this.currentCheckpoint = index;
      this.checkpointName = cp.name;
      this.objective = cp.objective;
      this.respawnPoint = { x: cp.position.x, z: cp.position.z, yaw: this.ctx.player.yaw };

      this.addScore(this.cfg.gameplay.checkpointScore, 'Checkpoint reached!');
      this.ctx.effects.checkpointBurst(new THREE.Vector3(cp.position.x, cp.position.y + 2.5, cp.position.z));
      this.ctx.audio.checkpoint();
      this.ctx.ui.toast('✓ ' + cp.name, 'good');
      this.ctx.ui.flashScreen();
    }

    // ------------------------------------------------------------ fall / respawn

    onPlayerFall() {
      if (this.state !== STATE.PLAYING) return;

      // Falling off the mountain costs a life. Update the count immediately so
      // the HUD hearts drop right away, then either respawn or end the run.
      this.loseLife();
      const dead = this.lives <= 0;

      this.ctx.audio.fall();
      this.ctx.effects.shake(0.25);
      this.ctx.player.setControlEnabled(false);
      this.ctx.ui.fadeOut();
      this.ctx.ui.toast(
        dead ? '💔 Out of lives!' : ('💔 Life lost — back to the checkpoint (' + this.lives + ' left)'),
        'bad'
      );

      this._addTimer(this.cfg.gameplay.respawnDelay, () => {
        if (dead) {
          this.ctx.ui.fadeIn();
          this._gameOver('You ran out of lives on the climb. Dust off the snow and try again, brave warrior!');
          return;
        }
        // Give the bridge back its planks so a fall through the collapsing
        // crossing is a fair retry rather than a permanently broken bridge.
        this.ctx.course.resetBridge();
        this.ctx.camera.stopConversation();
        const rp = this.respawnPoint;
        const y = this.ctx.course.surfaceHeightAt(rp.x, rp.z).y;
        const vec = new THREE.Vector3(rp.x, y, rp.z);
        this.ctx.player.reset(vec, rp.yaw);
        this.ctx.camera.snapTo(this.ctx.player.getHeadPosition(), rp.yaw);
        this.ctx.effects.respawnSwirl(vec);
        this.ctx.audio.respawn();
        this.ctx.ui.fadeIn();
      });
    }

    // ------------------------------------------------------------ interact

    _checkInteractables() {
      // Flag planting prompt near the summit pole (after the quiz).
      if (this.quiz.completed && !this.flagPlanted) {
        const pole = this.cfg.summit.flagPole;
        const p = this.ctx.player.position;
        if (distXZ(p.x, p.z, pole.x, pole.z) < this.cfg.gameplay.interactRange + 1) {
          this._activeInteract = { kind: 'plant' };
          this.ctx.ui.setInteractPrompt('Plant the Tiranga');
          return;
        }
      }

      // Nearest signboard in range.
      const p = this.ctx.player.position;
      let nearest = null;
      let nearestDist = this.cfg.gameplay.interactRange;
      this.ctx.course.signboards.forEach((s) => {
        const d = distXZ(p.x, p.z, s.position.x, s.position.z);
        if (d < nearestDist) { nearest = s; nearestDist = d; }
      });
      if (nearest) {
        this._activeInteract = { kind: 'sign', sign: nearest };
        this.ctx.ui.setInteractPrompt(nearest.getInteractLabel());
      } else {
        this._activeInteract = null;
        this.ctx.ui.setInteractPrompt(null);
      }
    }

    handleInteract() {
      if (this.signOpen) { this.closeSign(); return; }
      if (this.state !== STATE.PLAYING) return;
      const act = this._activeInteract;
      if (!act) return;
      if (act.kind === 'plant') { this._plantFlag(); return; }
      if (act.kind === 'sign') { this._openSign(act.sign); }
    }

    _openSign(sign) {
      this.signOpen = true;
      this.ctx.ui.setInteractPrompt(null);
      if (this.ctx.player.playInteract) this.ctx.player.playInteract();
      this.ctx.ui.showSign(sign.title, sign.text);
      this.ctx.audio.sign();
      this.ctx.audio.setDucked(true);
      if (!this._readSigns.has(sign.id)) {
        this._readSigns.add(sign.id);
        sign.markRead();
        this.addScore(this.cfg.gameplay.signScore, 'Learned something new!');
        this.ctx.effects.sparkleRing(new THREE.Vector3(sign.position.x, sign.position.y + 2.6, sign.position.z), 1.6, this.cfg.Palette.checkpointOn);
      }
    }

    closeSign() {
      if (!this.signOpen) return;
      this.signOpen = false;
      this.ctx.ui.hideSign();
      this.ctx.audio.uiBack();
      this.ctx.audio.setDucked(false);
    }

    // ------------------------------------------------------------ Yeti + quiz

    _checkYetiTrigger() {
      if (this.quizTriggered) return;
      const p = this.ctx.player.position;
      const y = this.cfg.yeti.position;
      if (distXZ(p.x, p.z, y.x, y.z) < this.cfg.yeti.triggerRadius) {
        this._startYetiGreeting();
      }
    }

    _startYetiGreeting() {
      this.quizTriggered = true;
      this.state = STATE.QUIZ;
      this.ctx.player.setControlEnabled(false);
      this.ctx.ui.setInteractPrompt(null);
      this.ctx.audio.setDucked(true);

      // The Yeti steps out to meet the boy face to face, with a friendly poof
      // of snow. Both then turn to look at each other.
      const player = this.ctx.player;
      const yetiPos = this.ctx.yeti.appearInFrontOf(player.position, player.yaw, this.ctx.course);
      player.yaw = Math.atan2(yetiPos.x - player.position.x, yetiPos.z - player.position.z);

      // Pull the camera around into a two-shot so the boy and the Yeti are both
      // on screen for the whole greeting + quiz conversation.
      this.ctx.camera.startConversation(player.position, yetiPos, {
        aHeight: this.cfg.player.height,
        bHeight: 6.8, // the Yeti is a big scaled-up giant (see Yeti.js SCALE)
      });
      this.ctx.effects.burst(new THREE.Vector3(yetiPos.x, yetiPos.y + 1.2, yetiPos.z), {
        additive: false, count: 40, color: 0xffffff,
        speedMin: 2, speedMax: 7, upMin: 0.2, upMax: 1.1,
        lifeMin: 0.5, lifeMax: 1.1, size0: 0.7, size1: 1.4, gravity: 3, alpha0: 0.85,
      });
      this.ctx.effects.sparkleRing(new THREE.Vector3(yetiPos.x, yetiPos.y + 0.4, yetiPos.z), 2.4, this.cfg.Palette.ice);
      this.ctx.effects.shake(0.15);
      this.ctx.audio.checkpoint();
      this.ctx.yeti.setState('wave');

      this._startDialogue(this.cfg.yeti.name, this.cfg.yeti.greeting, () => {
        this.ctx.yeti.setState('talk');
        this.ctx.audio.quizOpen();
        this.quiz.start();
      }, 2.6);
    }

    answerQuiz(index) {
      this.quiz.answer(index);
    }

    _onQuizQuestion(question, index, total) {
      this.ctx.yeti.setState('talk');
      this.ctx.ui.showQuiz(question, index, total, this.lives, (i) => this.answerQuiz(i));
      this.ctx.ui.lockQuiz(false);
    }

    _onQuizCorrect(question, chosen) {
      this.ctx.ui.lockQuiz(true);
      this.ctx.ui.highlightAnswer(chosen, question.answer, true);
      this.ctx.ui.setQuizFeedback('Correct! ' + question.fact, true);
      this.ctx.audio.correct();
      this.addScore(this.cfg.gameplay.quizScore, 'Great answer!');
      const yetiPos = new THREE.Vector3(this.ctx.yeti.position.x, this.ctx.yeti.position.y + 4, this.ctx.yeti.position.z);
      this.ctx.effects.quizSuccess(yetiPos);
      this.ctx.yeti.setState('celebrate');
      this._addTimer(2.4, () => { this.ctx.yeti.setState('talk'); this.quiz.advance(); });
    }

    _onQuizWrong(question, chosen) {
      this.ctx.ui.lockQuiz(true);
      this.ctx.ui.highlightAnswer(chosen, question.answer, false);
      this.loseLife();
      this.ctx.ui.updateQuizLives(this.lives);
      this.ctx.audio.wrong();
      this.ctx.effects.quizFail(new THREE.Vector3(this.ctx.yeti.position.x, this.ctx.yeti.position.y + 3, this.ctx.yeti.position.z));

      if (this.lives <= 0) {
        this.ctx.ui.setQuizFeedback('Out of lives — but every hero tries again!', false);
        this._addTimer(2.0, () => this._gameOver('The quiz was tricky! Give the climb another go.'));
        return;
      }
      this.ctx.ui.setQuizFeedback(pick(this.cfg.yeti.wrong) + ' (Lost a life)', false);
      // retry() re-emits onQuestion, which re-renders and unlocks the options.
      this._addTimer(2.2, () => this.quiz.retry());
    }

    _onQuizComplete(correct, total) {
      this.ctx.ui.hideQuiz();
      this.ctx.audio.setDucked(false);
      this.state = STATE.PLAYING;
      // The chat is over and the boy can walk again, so hand the camera back
      // to the normal follow view.
      this.ctx.camera.stopConversation();
      this.ctx.player.setControlEnabled(true);
      this.objective = 'Plant the Tiranga at the summit!';
      this.checkpointName = 'The Summit Awaits';

      this.ctx.yeti.setState('point');
      this._startDialogue(this.cfg.yeti.name, this.cfg.yeti.finished, () => {
        this.ctx.yeti.setState('idle');
      }, 2.8);
      this.ctx.ui.toast('Quiz complete! Head to the flag pole', 'good', 3200);
    }

    // ------------------------------------------------------------ flag plant

    _plantFlag() {
      this.flagPlanted = true;
      this.state = STATE.PLANTING;
      this.ctx.player.setControlEnabled(false);
      this.ctx.ui.setInteractPrompt(null);
      this.ctx.audio.setDucked(true);

      // Face the child at the pole and cheer.
      const pole = this.cfg.summit.flagPole;
      this.ctx.player.yaw = Math.atan2(pole.x - this.ctx.player.position.x, pole.z - this.ctx.player.position.z);
      if (this.ctx.player.playPlant) this.ctx.player.playPlant();
      else this.ctx.player.playCelebrate();
      this.ctx.player.flag.group.visible = false;

      // Reveal the large flag unfurling up the summit mast.
      const flag = new TFW.Flag(this.ctx.assets, { poleHeight: this.cfg.summit.poleHeight, clothWidth: 3.4, clothHeight: 2.2, withPole: false });
      flag.group.position.copy(this.ctx.course.summitFlagAnchor);
      flag.cloth.scale.x = 0.001;
      this.ctx.scene.add(flag.group);
      this._plantedFlag = flag;
      this._plantProgress = 0;

      const top = this.ctx.course.summitPoleTop;
      this.ctx.effects.flagPlant(top.clone());
      this.ctx.audio.plantFlag();
      this.ctx.ui.flashScreen();
      this.addScore(this.cfg.gameplay.summitScore, 'Tiranga planted!');
      this.ctx.ui.toast('🇮🇳 Jai Hind!', 'good', 3000);

      // Bring Bholu up to the summit to celebrate face-to-face beside the boy.
      const yGround = this.ctx.course.surfaceHeightAt(pole.x + 3.4, pole.z + 1.2).y;
      this.ctx.yeti.position.set(pole.x + 3.4, yGround, pole.z + 1.2);
      this.ctx.yeti.group.position.copy(this.ctx.yeti.position);
      this.ctx.yeti._faceTarget = Math.atan2(
        this.ctx.player.position.x - this.ctx.yeti.position.x,
        this.ctx.player.position.z - this.ctx.yeti.position.z
      );
      this.ctx.yeti.group.rotation.y = this.ctx.yeti._faceTarget;
      this.ctx.yeti.setState('celebrate');
    }

    _updatePlanting(dt) {
      if (!this._plantedFlag) return;
      this._plantProgress = Math.min(1, this._plantProgress + dt / 1.4);
      const e = 1 - Math.pow(1 - this._plantProgress, 3);
      this._plantedFlag.cloth.scale.x = Math.max(0.001, e);
      this._plantedFlag.update(dt);
      if (this._plantProgress >= 1) this._beginCinematic();
    }

    _beginCinematic() {
      this.state = STATE.CINEMATIC;
      this._cinemaTimer = 0;
      this._fwTimer = 0;
      const top = this.ctx.course.summitPoleTop.clone();
      top.y -= 2;
      this.ctx.camera.startCinematic(top);
      this.ctx.effects.celebrate(this.ctx.course.summitPoleTop.clone());
    }

    _updateCinematic(dt) {
      this._cinemaTimer += dt;
      if (this._plantedFlag) this._plantedFlag.update(dt);

      // Periodic fireworks around the summit.
      this._fwTimer -= dt;
      if (this._fwTimer <= 0) {
        this._fwTimer = 0.55;
        const c = this.cfg.summit.flagPole;
        const pos = new THREE.Vector3(
          c.x + (Math.random() - 0.5) * 26,
          this.ctx.course.summitGroundY + 6 + Math.random() * 4,
          c.z + (Math.random() - 0.5) * 26
        );
        const colors = [this.cfg.Palette.saffron, 0xffffff, this.cfg.Palette.green, this.cfg.Palette.checkpointOn, this.cfg.Palette.tentAlt];
        this.ctx.effects.firework(pos, pick(colors));
        this.ctx.audio.firework();
      }

      if (this._cinemaTimer >= 5.5) this._finishVictory();
    }

    _finishVictory() {
      this.state = STATE.VICTORY;
      const timeBonus = Math.max(0, Math.round(this.cfg.gameplay.timeBonusBase - this.time * 5));
      this.score += timeBonus;
      this.ctx.ui.showVictory({
        time: this.time,
        score: this.score,
        checkpoints: this.currentCheckpoint + 1,
        checkpointTotal: this.ctx.course.checkpoints.length,
        quizCorrect: this.quiz.correctCount,
        quizTotal: this.quiz.total,
      });
      this.ctx.audio.victory();
      this.ctx.onVictory && this.ctx.onVictory();
    }

    // ------------------------------------------------------------ game over

    _gameOver(message) {
      this.state = STATE.GAMEOVER;
      this.ctx.ui.hideQuiz();
      this.ctx.camera.stopConversation();
      this.ctx.audio.setDucked(false);
      this.ctx.audio.wrong();
      this.ctx.ui.showGameOver(message);
      this.ctx.onGameOver && this.ctx.onGameOver();
    }

    // ------------------------------------------------------------ score/lives

    addScore(amount, toastMsg) {
      this.score += amount;
      this.ctx.ui.bumpChip('score');
      if (toastMsg) this.ctx.ui.toast('+' + amount + ' — ' + toastMsg, 'info');
    }

    loseLife() {
      this.lives = Math.max(0, this.lives - 1);
      this.ctx.ui.bumpChip('lives');
    }

    // ------------------------------------------------------------ dialogue

    _startDialogue(name, lines, onDone, perLine) {
      this._dialogue.queue = lines.slice();
      this._dialogue.name = name;
      this._dialogue.onDone = onDone || null;
      this._dialogue.perLine = perLine || 2.6;
      this._dialogue.timer = 0.01;
    }

    _updateDialogue(dt) {
      if (this._dialogue.timer <= 0) return;
      this._dialogue.timer -= dt;
      if (this._dialogue.timer > 0) return;
      if (this._dialogue.queue.length) {
        const line = this._dialogue.queue.shift();
        this.ctx.ui.showSubtitle(this._dialogue.name, line);
        this.ctx.audio.yetiTalk();
        this._dialogue.timer = this._dialogue.perLine;
      } else {
        this.ctx.ui.hideSubtitle();
        this._dialogue.timer = 0;
        const done = this._dialogue.onDone;
        this._dialogue.onDone = null;
        if (done) done();
      }
    }

    // ------------------------------------------------------------ timers

    _addTimer(seconds, fn) {
      const id = global.setTimeout(() => {
        this._timers = this._timers.filter((t) => t !== id);
        fn();
      }, seconds * 1000);
      this._timers.push(id);
    }

    _clearTimers() {
      this._timers.forEach((id) => global.clearTimeout(id));
      this._timers = [];
    }

    dispose() {
      this._clearTimers();
      if (this._plantedFlag) this._plantedFlag.dispose();
    }
  }

  GameManager.STATE = STATE;
  TFW.GameManager = GameManager;
})(window);
