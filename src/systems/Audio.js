/**
 * Audio.js — fully synthesised soundtrack and sound effects (Web Audio API).
 *
 * Nothing is streamed or downloaded: music, wind, snow ambience and every SFX
 * are generated with oscillators and filtered noise, so audio can never fail to
 * "load". If the browser has no Web Audio support the system reports it once and
 * the game keeps running silently (the UI shows a notice).
 */
(function (global) {
  'use strict';

  const TFW = (global.TFW = global.TFW || {});
  const { clamp } = TFW.Utils;

  const MIDI_A4 = 69;
  const midiToFreq = (m) => 440 * Math.pow(2, (m - MIDI_A4) / 12);

  // D major pentatonic — warm and folk-like, pleasant for a kids' adventure.
  const MELODY_SCALE = [62, 64, 66, 69, 71, 74, 76, 78];
  const MELODY_PATTERN = [0, 2, 4, 3, 5, 4, 2, 1, 0, 2, 3, 5, 6, 5, 3, 2];
  const PAD_CHORDS = [
    [50, 57, 62, 66], // D
    [45, 52, 57, 61], // A
    [47, 54, 59, 62], // Bm
    [43, 50, 55, 59], // G
  ];

  class AudioSystem {
    constructor() {
      this.ctx = null;
      this.available = true;
      this.unsupportedReason = '';
      this.enabled = true;
      this.noiseBuffer = null;
      this.musicTimer = null;
      this.nextNoteTime = 0;
      this.step16 = 0;
      this.tempo = 92;
      this.ambienceNodes = [];
      this.lastStepAt = 0;
      this.musicMode = 'idle';
    }

    /** Must be called from a user gesture (the Play / UI buttons do this). */
    init() {
      if (this.ctx) return true;
      const Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) {
        this.available = false;
        this.unsupportedReason = 'This browser does not support the Web Audio API, so the game will play without sound.';
        return false;
      }
      this.ctx = new Ctor();
      const cfg = TFW.Config.audio;

      this.master = this.ctx.createGain();
      this.master.gain.value = cfg.masterVolume;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = cfg.musicVolume;
      this.musicBus.connect(this.master);

      this.ambienceBus = this.ctx.createGain();
      this.ambienceBus.gain.value = cfg.ambienceVolume;
      this.ambienceBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = cfg.sfxVolume;
      this.sfxBus.connect(this.master);

      this.noiseBuffer = this._createNoiseBuffer(2.2);
      return true;
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    get ready() { return !!this.ctx && this.available && this.enabled; }
    get now() { return this.ctx ? this.ctx.currentTime : 0; }

    setMuted(muted) {
      this.enabled = !muted;
      if (this.master) this.master.gain.value = muted ? 0 : TFW.Config.audio.masterVolume;
    }

    /** Duck music/ambience while a menu or the quiz is open. */
    setDucked(ducked) {
      if (!this.ctx) return;
      const cfg = TFW.Config.audio;
      const t = this.now;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.linearRampToValueAtTime(ducked ? cfg.musicVolume * 0.35 : cfg.musicVolume, t + 0.4);
      this.ambienceBus.gain.cancelScheduledValues(t);
      this.ambienceBus.gain.linearRampToValueAtTime(ducked ? cfg.ambienceVolume * 0.3 : cfg.ambienceVolume, t + 0.4);
    }

    // -------------------------------------------------------------- ambience

    startAmbience() {
      if (!this.ready || this.ambienceNodes.length) return;

      // Wind: filtered noise with a slowly sweeping band-pass.
      const wind = this.ctx.createBufferSource();
      wind.buffer = this.noiseBuffer;
      wind.loop = true;
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.8;
      const windGain = this.ctx.createGain();
      windGain.gain.value = 0.5;
      const windLfo = this.ctx.createOscillator();
      windLfo.frequency.value = 0.07;
      const windLfoGain = this.ctx.createGain();
      windLfoGain.gain.value = 0.32;
      windLfo.connect(windLfoGain).connect(windGain.gain);
      const windSweep = this.ctx.createOscillator();
      windSweep.frequency.value = 0.045;
      const windSweepGain = this.ctx.createGain();
      windSweepGain.gain.value = 260;
      windSweep.connect(windSweepGain).connect(windFilter.frequency);
      wind.connect(windFilter).connect(windGain).connect(this.ambienceBus);

      // Snow shimmer: very soft high-passed noise.
      const snow = this.ctx.createBufferSource();
      snow.buffer = this.noiseBuffer;
      snow.loop = true;
      const snowFilter = this.ctx.createBiquadFilter();
      snowFilter.type = 'highpass';
      snowFilter.frequency.value = 4200;
      const snowGain = this.ctx.createGain();
      snowGain.gain.value = 0.09;
      snow.connect(snowFilter).connect(snowGain).connect(this.ambienceBus);

      [wind, snow, windLfo, windSweep].forEach((n) => n.start());
      this.windGain = windGain;
      this.windFilter = windFilter;
      this.ambienceNodes = [wind, snow, windLfo, windSweep];
    }

    stopAmbience() {
      this.ambienceNodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
      this.ambienceNodes = [];
      this.windGain = null;
    }

    /** 0 at the village, 1 at the summit — the wind gets stronger as you climb. */
    setAltitude(t01) {
      if (!this.windGain) return;
      const t = clamp(t01, 0, 1);
      this.windGain.gain.value = 0.4 + t * 0.75;
      this.windFilter.frequency.value = 420 + t * 620;
    }

    // -------------------------------------------------------------- music

    startMusic(mode) {
      if (!this.ready) return;
      this.musicMode = mode || 'adventure';
      this.stopMusic();
      this.nextNoteTime = this.now + 0.12;
      this.step16 = 0;
      this.musicTimer = global.setInterval(() => this._scheduleMusic(), 80);
    }

    stopMusic() {
      if (this.musicTimer) {
        global.clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    }

    _scheduleMusic() {
      if (!this.ready) return;
      const stepDur = 60 / this.tempo / 2; // 8th notes
      while (this.nextNoteTime < this.now + 0.35) {
        this._playMusicStep(this.step16, this.nextNoteTime, stepDur);
        this.nextNoteTime += stepDur;
        this.step16 = (this.step16 + 1) % 32;
      }
    }

    _playMusicStep(step, time, stepDur) {
      const bar = Math.floor(step / 8) % 4;
      if (step % 8 === 0) {
        const chord = PAD_CHORDS[bar];
        chord.forEach((m, i) => this._pad(midiToFreq(m), time, stepDur * 8.4, 0.055 - i * 0.006));
      }
      const patIndex = step % MELODY_PATTERN.length;
      const skip = step % 4 === 3 && (step % 8 !== 7);
      if (!skip) {
        const degree = MELODY_PATTERN[patIndex];
        const octave = this.musicMode === 'summit' ? 12 : 0;
        this._pluck(midiToFreq(MELODY_SCALE[degree] + octave), time, stepDur * 1.7, 0.075);
      }
      if (step % 8 === 0 || step % 8 === 5) this._soft(time, 0.055); // gentle heartbeat drum
    }

    _pad(freq, time, dur, gain) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(gain, time + dur * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, time + dur);
      o.connect(g).connect(this.musicBus);
      o.start(time);
      o.stop(time + dur + 0.05);
    }

    _pluck(freq, time, dur, gain) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(3400, time);
      f.frequency.exponentialRampToValueAtTime(900, time + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(gain, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(f).connect(g).connect(this.musicBus);
      o.start(time);
      o.stop(time + dur + 0.05);
    }

    _soft(time, gain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(time, Math.random(), 0.25);
    }

    // -------------------------------------------------------------- SFX core

    _createNoiseBuffer(seconds) {
      const len = Math.floor(this.ctx.sampleRate * seconds);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    _tone(opts) {
      if (!this.ready) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.now + (opts.delay || 0);
      const dur = opts.duration || 0.2;
      o.type = opts.type || 'sine';
      o.frequency.setValueAtTime(opts.freq, t);
      if (opts.toFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.toFreq), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(opts.gain || 0.2, t + Math.min(0.03, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    _noise(opts) {
      if (!this.ready) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter();
      f.type = opts.filterType || 'lowpass';
      const t = this.now + (opts.delay || 0);
      const dur = opts.duration || 0.18;
      f.frequency.setValueAtTime(opts.freq || 900, t);
      if (opts.toFreq) f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.toFreq), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(opts.gain || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start(t, Math.random() * 1.2, dur + 0.1);
    }

    _arp(notes, step, gain, type) {
      notes.forEach((m, i) => this._tone({
        freq: midiToFreq(m), duration: 0.22, gain: gain || 0.18,
        type: type || 'triangle', delay: i * (step || 0.09),
      }));
    }

    // -------------------------------------------------------------- SFX API

    footstep(running) {
      const t = this.now;
      if (t - this.lastStepAt < 0.11) return;
      this.lastStepAt = t;
      this._noise({ freq: running ? 1500 : 1050, toFreq: 320, duration: running ? 0.14 : 0.17, gain: running ? 0.2 : 0.14, filterType: 'lowpass' });
    }

    jump() {
      this._tone({ freq: 320, toFreq: 720, duration: 0.2, gain: 0.16, type: 'triangle' });
      this._noise({ freq: 1800, toFreq: 500, duration: 0.14, gain: 0.1 });
    }

    land(hard) {
      this._noise({ freq: hard ? 700 : 480, toFreq: 140, duration: hard ? 0.28 : 0.18, gain: hard ? 0.28 : 0.16 });
      this._tone({ freq: hard ? 140 : 180, toFreq: 90, duration: 0.16, gain: 0.12, type: 'sine' });
    }

    checkpoint() {
      this._arp([74, 78, 81, 86], 0.085, 0.19, 'triangle');
      this._noise({ freq: 6000, toFreq: 2500, duration: 0.4, gain: 0.06, filterType: 'highpass' });
    }

    sign() { this._arp([69, 73, 76], 0.07, 0.14, 'sine'); }

    quizOpen() {
      this._arp([62, 66, 69, 74], 0.11, 0.16, 'sine');
      this._tone({ freq: 196, duration: 0.6, gain: 0.08, type: 'sine' });
    }

    correct() { this._arp([72, 76, 79, 84, 88], 0.075, 0.2, 'triangle'); }

    wrong() {
      this._tone({ freq: 240, toFreq: 130, duration: 0.42, gain: 0.2, type: 'sawtooth' });
      this._tone({ freq: 180, toFreq: 96, duration: 0.5, gain: 0.14, type: 'triangle', delay: 0.07 });
    }

    yetiTalk() {
      const base = 128 + Math.random() * 24;
      this._tone({ freq: base, toFreq: base * 1.35, duration: 0.22, gain: 0.15, type: 'sawtooth' });
    }

    plantFlag() {
      this._noise({ freq: 2400, toFreq: 400, duration: 0.5, gain: 0.2 });
      this._arp([62, 69, 74, 78, 81], 0.1, 0.2, 'triangle');
      this._tone({ freq: 98, toFreq: 74, duration: 0.7, gain: 0.16, type: 'sine', delay: 0.05 });
    }

    firework() {
      this._noise({ freq: 3200, toFreq: 260, duration: 0.55, gain: 0.16, filterType: 'bandpass' });
      this._tone({ freq: 720 + Math.random() * 300, toFreq: 180, duration: 0.3, gain: 0.09, type: 'sine' });
    }

    respawn() {
      this._tone({ freq: 520, toFreq: 240, duration: 0.3, gain: 0.14, type: 'sine' });
      this._tone({ freq: 300, toFreq: 620, duration: 0.34, gain: 0.12, type: 'triangle', delay: 0.16 });
    }

    fall() { this._tone({ freq: 520, toFreq: 90, duration: 0.7, gain: 0.16, type: 'sine' }); }

    uiClick() { this._tone({ freq: 660, toFreq: 880, duration: 0.1, gain: 0.16, type: 'square' }); }

    uiBack() { this._tone({ freq: 500, toFreq: 320, duration: 0.12, gain: 0.14, type: 'square' }); }

    /** Bright fanfare for the victory screen; replaces the exploring music. */
    victory() {
      this.stopMusic();
      const seq = [74, 78, 81, 86, 84, 86, 93];
      seq.forEach((m, i) => this._tone({ freq: midiToFreq(m), duration: 0.5, gain: 0.2, type: 'triangle', delay: i * 0.16 }));
      [62, 69, 74].forEach((m) => this._tone({ freq: midiToFreq(m), duration: 2.4, gain: 0.09, type: 'sine' }));
      global.setTimeout(() => { this.tempo = 104; this.startMusic('summit'); }, 2600);
    }

    dispose() {
      this.stopMusic();
      this.stopAmbience();
      if (this.ctx && this.ctx.close) this.ctx.close();
      this.ctx = null;
    }
  }

  TFW.AudioSystem = AudioSystem;
})(window);
