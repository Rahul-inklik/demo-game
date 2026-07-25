/**
 * UI.js — the single owner of every DOM screen, HUD element and overlay.
 *
 * Rendering/gameplay code never touches the DOM directly; it calls these
 * methods. UI turns user clicks/keys into callbacks (set via `bind`) so the
 * game logic stays free of HTML concerns.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  /** Small helper: fetch an element or throw a clear error (no silent nulls). */
  function must(id) {
    const el = global.document.getElementById(id);
    if (!el) throw new Error('UI is missing the required element #' + id + ' in index.html.');
    return el;
  }

  const OPTION_TAGS = ['A', 'B', 'C', 'D', 'E', 'F'];

  class UI {
    constructor() {
      const d = global.document;
      this.d = d;

      // Screens
      this.loadingScreen = must('loading-screen');
      this.loadingBar = must('loading-bar');
      this.loadingText = must('loading-text');

      this.errorOverlay = must('error-overlay');
      this.errorMessage = must('error-message');
      this.errorDetail = must('error-detail-text');
      this.errorReload = must('error-reload');

      this.titleScreen = must('title-screen');
      this.btnPlay = must('btn-play');

      // HUD
      this.hud = must('hud');
      this.hudTimer = must('hud-timer');
      this.hudScore = must('hud-score');
      this.hudLives = must('hud-lives');
      this.hudCheckpoint = must('hud-checkpoint');
      this.hudObjective = must('hud-objective');
      this.hudAltitude = must('hud-altitude');
      this.btnPause = must('btn-pause');

      this.interactPrompt = must('interact-prompt');
      this.interactLabel = must('interact-label');
      this.toastArea = must('toast-area');
      this.subtitleBar = must('subtitle-bar');
      this.subtitleName = must('subtitle-name');
      this.subtitleText = must('subtitle-text');

      // Sign popup
      this.signPopup = must('sign-popup');
      this.signTitle = must('sign-title');
      this.signText = must('sign-text');
      this.btnSignClose = must('btn-sign-close');

      // Quiz
      this.quizModal = must('quiz-modal');
      this.quizProgress = must('quiz-progress');
      this.quizQuestion = must('quiz-question');
      this.quizOptions = must('quiz-options');
      this.quizFeedback = must('quiz-feedback');
      this.quizLives = must('quiz-lives');

      // Pause
      this.pauseMenu = must('pause-menu');
      this.btnResume = must('btn-resume');
      this.btnRestartPause = must('btn-restart-pause');
      this.btnTitlePause = must('btn-title-pause');

      // Victory
      this.victoryScreen = must('victory-screen');
      this.victoryTime = must('victory-time');
      this.victoryScore = must('victory-score');
      this.victoryCheckpoints = must('victory-checkpoints');
      this.victoryQuiz = must('victory-quiz');
      this.btnRestartVictory = must('btn-restart-victory');
      this.btnTitleVictory = must('btn-title-victory');

      // Game over
      this.gameoverScreen = must('gameover-screen');
      this.gameoverSub = must('gameover-sub');
      this.btnRestartOver = must('btn-restart-over');
      this.btnTitleOver = must('btn-title-over');

      // FX overlays
      this.fade = must('fade');
      this.flash = must('flash');
      this.vignette = must('vignette');

      this.callbacks = {};
      this._subtitleTimer = null;
      this._interactVisible = false;
      this._quizAnswerCb = null;
    }

    /** Wire button callbacks. Missing callbacks simply do nothing. */
    bind(callbacks) {
      this.callbacks = callbacks || {};
      const c = this.callbacks;
      const clickSound = () => { if (c.onUiSound) c.onUiSound(); };

      this.btnPlay.addEventListener('click', () => { clickSound(); if (c.onPlay) c.onPlay(); });
      this.errorReload.addEventListener('click', () => global.location.reload());
      this.btnPause.addEventListener('click', () => { clickSound(); if (c.onPause) c.onPause(); });
      this.btnResume.addEventListener('click', () => { clickSound(); if (c.onResume) c.onResume(); });
      this.btnRestartPause.addEventListener('click', () => { clickSound(); if (c.onRestart) c.onRestart(); });
      this.btnTitlePause.addEventListener('click', () => { clickSound(); if (c.onReturnTitle) c.onReturnTitle(); });
      this.btnSignClose.addEventListener('click', () => { clickSound(); if (c.onSignClose) c.onSignClose(); });
      this.btnRestartVictory.addEventListener('click', () => { clickSound(); if (c.onRestart) c.onRestart(); });
      this.btnTitleVictory.addEventListener('click', () => { clickSound(); if (c.onReturnTitle) c.onReturnTitle(); });
      this.btnRestartOver.addEventListener('click', () => { clickSound(); if (c.onRestart) c.onRestart(); });
      this.btnTitleOver.addEventListener('click', () => { clickSound(); if (c.onReturnTitle) c.onReturnTitle(); });
    }

    // -------------------------------------------------------- screen helpers

    _show(el) { el.classList.add('show'); }
    _hide(el) { el.classList.remove('show'); }

    hideAllScreens() {
      [this.loadingScreen, this.titleScreen, this.signPopup, this.quizModal,
       this.pauseMenu, this.victoryScreen, this.gameoverScreen, this.errorOverlay]
        .forEach((s) => this._hide(s));
    }

    // -------------------------------------------------------- loading / error

    setProgress(fraction, label) {
      this.loadingBar.style.width = Math.round(TFW.Utils.clamp01(fraction) * 100) + '%';
      if (label) this.loadingText.textContent = label;
    }

    showLoading() { this.hideAllScreens(); this._show(this.loadingScreen); }
    hideLoading() { this._hide(this.loadingScreen); }

    showError(message, detail) {
      this.hideAllScreens();
      this.hud.classList.remove('show');
      this.errorMessage.textContent = message || 'Something went wrong while starting the game.';
      this.errorDetail.textContent = detail || '';
      this._show(this.errorOverlay);
    }

    // -------------------------------------------------------- title / hud

    showTitle() {
      this.hideAllScreens();
      this.hud.classList.remove('show');
      this.vignette.classList.remove('show');
      this._show(this.titleScreen);
    }

    hideTitle() { this._hide(this.titleScreen); }

    showHUD() { this.hud.classList.add('show'); this.vignette.classList.add('show'); }
    hideHUD() { this.hud.classList.remove('show'); }

    updateHUD(state) {
      if (state.time !== undefined) this.hudTimer.textContent = TFW.Utils.formatTime(state.time);
      if (state.score !== undefined) this.hudScore.textContent = String(state.score);
      if (state.lives !== undefined) {
        this.hudLives.textContent = state.lives > 0 ? '♥'.repeat(state.lives) : '—';
      }
      if (state.checkpoint !== undefined) this.hudCheckpoint.textContent = state.checkpoint;
      if (state.objective !== undefined) this.hudObjective.textContent = state.objective;
      if (state.altitude !== undefined) this.hudAltitude.textContent = Math.max(0, Math.round(state.altitude)) + ' m';
    }

    bumpChip(which) {
      const map = { score: this.hudScore, lives: this.hudLives, time: this.hudTimer };
      const el = map[which];
      if (!el) return;
      const chip = el.closest('.hud-chip');
      if (!chip) return;
      chip.classList.remove('bump');
      void chip.offsetWidth; // restart animation
      chip.classList.add('bump');
    }

    // -------------------------------------------------------- interact prompt

    setInteractPrompt(label) {
      if (label) {
        this.interactLabel.textContent = label;
        if (!this._interactVisible) {
          this.interactPrompt.classList.add('show');
          this._interactVisible = true;
        }
      } else if (this._interactVisible) {
        this.interactPrompt.classList.remove('show');
        this._interactVisible = false;
      }
    }

    // -------------------------------------------------------- toasts / subtitles

    toast(message, kind, duration) {
      const el = this.d.createElement('div');
      el.className = 'toast ' + (kind || 'info');
      el.textContent = message;
      this.toastArea.appendChild(el);
      const life = duration || 2600;
      global.setTimeout(() => {
        el.classList.add('out');
        global.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
      }, life);
    }

    showSubtitle(name, text, duration) {
      this.subtitleName.textContent = name || '';
      this.subtitleText.textContent = text || '';
      this.subtitleBar.classList.add('show');
      if (this._subtitleTimer) global.clearTimeout(this._subtitleTimer);
      if (duration) {
        this._subtitleTimer = global.setTimeout(() => this.hideSubtitle(), duration);
      }
    }

    hideSubtitle() {
      this.subtitleBar.classList.remove('show');
      if (this._subtitleTimer) { global.clearTimeout(this._subtitleTimer); this._subtitleTimer = null; }
    }

    // -------------------------------------------------------- sign popup

    showSign(title, text) {
      this.signTitle.textContent = title;
      this.signText.textContent = text;
      this._show(this.signPopup);
    }

    hideSign() { this._hide(this.signPopup); }

    // -------------------------------------------------------- quiz

    /**
     * Render a question. `onAnswer(index)` is called on click or number key.
     */
    showQuiz(question, index, total, lives, onAnswer) {
      this._quizAnswerCb = onAnswer;
      this.quizProgress.textContent = 'Question ' + (index + 1) + ' of ' + total;
      this.quizQuestion.textContent = question.question;
      this.updateQuizLives(lives);
      this.quizFeedback.textContent = '';
      this.quizFeedback.className = 'quiz-feedback';

      this.quizOptions.innerHTML = '';
      this._optionButtons = [];
      question.options.forEach((opt, i) => {
        const btn = this.d.createElement('button');
        btn.type = 'button';
        btn.className = 'quiz-option';
        btn.innerHTML = '<span class="tag">' + (OPTION_TAGS[i] || (i + 1)) + '</span><span>' + opt + '</span>';
        btn.addEventListener('click', () => this._chooseOption(i));
        this.quizOptions.appendChild(btn);
        this._optionButtons.push(btn);
      });

      this._show(this.quizModal);
    }

    _chooseOption(i) {
      if (this._quizLocked) return;
      if (this._quizAnswerCb) this._quizAnswerCb(i);
    }

    /** Number-key entry (1-4) while the quiz is open. Returns true if handled. */
    handleQuizKey(code) {
      if (!this.quizModal.classList.contains('show') || this._quizLocked) return false;
      const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[code];
      if (digit === undefined || !this._optionButtons || digit >= this._optionButtons.length) return false;
      this._chooseOption(digit);
      return true;
    }

    lockQuiz(locked) {
      this._quizLocked = locked;
      if (this._optionButtons) this._optionButtons.forEach((b) => { b.disabled = locked; });
    }

    highlightAnswer(chosen, correct, isCorrect) {
      if (!this._optionButtons) return;
      const correctBtn = this._optionButtons[correct];
      if (correctBtn) correctBtn.classList.add('correct');
      if (!isCorrect && this._optionButtons[chosen]) this._optionButtons[chosen].classList.add('wrong');
    }

    setQuizFeedback(text, good) {
      this.quizFeedback.textContent = text;
      this.quizFeedback.className = 'quiz-feedback ' + (good ? 'good' : 'bad');
    }

    updateQuizLives(lives) {
      this.quizLives.textContent = 'Lives: ' + (lives > 0 ? '♥'.repeat(lives) : '—');
    }

    hideQuiz() { this._hide(this.quizModal); this._quizLocked = false; }

    // -------------------------------------------------------- pause / victory / over

    showPause() { this._show(this.pauseMenu); }
    hidePause() { this._hide(this.pauseMenu); }

    showVictory(stats) {
      this.victoryTime.textContent = TFW.Utils.formatTime(stats.time);
      this.victoryScore.textContent = String(stats.score);
      this.victoryCheckpoints.textContent = stats.checkpoints + '/' + stats.checkpointTotal;
      this.victoryQuiz.textContent = stats.quizCorrect + '/' + stats.quizTotal;
      this._show(this.victoryScreen);
    }

    hideVictory() { this._hide(this.victoryScreen); }

    showGameOver(message) {
      if (message) this.gameoverSub.textContent = message;
      this._show(this.gameoverScreen);
    }

    hideGameOver() { this._hide(this.gameoverScreen); }

    // -------------------------------------------------------- fx overlays

    fadeOut() { this.fade.classList.add('on'); }
    fadeIn() { this.fade.classList.remove('on'); }

    flashScreen() {
      this.flash.classList.remove('on');
      void this.flash.offsetWidth;
      this.flash.classList.add('on');
    }
  }

  TFW.UI = UI;
})(window);
