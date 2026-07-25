/**
 * Quiz.js — pure logic for the Yeti's educational history quiz.
 *
 * Holds no DOM and no rendering: it emits events that the UI and GameManager
 * react to, which keeps gameplay rules testable and reusable.
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});

  class Quiz {
    /**
     * @param {object} config Quiz definition from Config (title + questions).
     * @param {object} hooks  { onQuestion, onCorrect, onWrong, onComplete }
     */
    constructor(config, hooks) {
      if (!config || !Array.isArray(config.questions) || !config.questions.length) {
        throw new Error('Quiz configuration is missing its questions.');
      }
      this.config = config;
      this.hooks = hooks || {};
      this.reset();
    }

    reset() {
      this.index = 0;
      this.correctCount = 0;
      this.attempts = 0;
      this.active = false;
      this.completed = false;
      this.locked = false;
    }

    get total() { return this.config.questions.length; }

    get current() { return this.config.questions[this.index]; }

    start() {
      if (this.completed) return false;
      this.active = true;
      this.locked = false;
      this._emit('onQuestion', this.current, this.index, this.total);
      return true;
    }

    /**
     * Submit an answer.
     * @returns {'correct'|'wrong'|'ignored'}
     */
    answer(optionIndex) {
      if (!this.active || this.locked) return 'ignored';
      const question = this.current;
      this.attempts++;
      if (optionIndex === question.answer) {
        this.correctCount++;
        this.locked = true;
        this._emit('onCorrect', question, optionIndex);
        return 'correct';
      }
      this.locked = true;
      this._emit('onWrong', question, optionIndex);
      return 'wrong';
    }

    /** Called by the UI once the "correct" feedback has been shown. */
    advance() {
      this.locked = false;
      if (this.index < this.total - 1) {
        this.index++;
        this._emit('onQuestion', this.current, this.index, this.total);
        return 'next';
      }
      this.active = false;
      this.completed = true;
      this._emit('onComplete', this.correctCount, this.total);
      return 'complete';
    }

    /** Called by the UI once the "wrong" feedback has been shown: retry same question. */
    retry() {
      this.locked = false;
      this._emit('onQuestion', this.current, this.index, this.total);
    }

    _emit(name, ...args) {
      const fn = this.hooks[name];
      if (typeof fn === 'function') fn(...args);
    }
  }

  TFW.Quiz = Quiz;
})(window);
