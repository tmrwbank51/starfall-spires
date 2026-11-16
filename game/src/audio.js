// Starfall Spires — sound. Every effect is synthesized with WebAudio:
// oscillators, filtered noise and gain envelopes. No audio files, no network.
// The context starts on the first user gesture; mute silences everything.
(function () {
  'use strict';

  var ctx = null;
  var master = null;
  var padNodes = [];
  var muted = false;
  var started = false;

  function ensure() {
    if (ctx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx || muted) return;
    var t = now() + (delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(dur, vol, filterFreq, delay, type) {
    if (!ctx || muted) return;
    var t = now() + (delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = filterFreq || 800;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
  }

  function startAmbient() {
    if (!ctx || started) return;
    started = true;
    // A slow two-oscillator pad, quiet enough to sit under the action.
    var freqs = [110, 164.8, 220.5];
    for (var i = 0; i < freqs.length; i++) {
      (function (f, idx) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        var lfo = ctx.createOscillator();
        var lfoGain = ctx.createGain();
        osc.type = idx === 2 ? 'triangle' : 'sine';
        osc.frequency.value = f;
        g.gain.value = 0.018;
        lfo.frequency.value = 0.07 + idx * 0.045;
        lfoGain.gain.value = 0.009;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        osc.connect(g);
        g.connect(master);
        osc.start();
        lfo.start();
        padNodes.push(osc, lfo);
      })(freqs[i], i);
    }
  }

  var sfx = {
    unlock: function () {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
      startAmbient();
    },
    setMuted: function (m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },
    isMuted: function () { return muted; },
    select: function () { tone(660, 0.09, 'triangle', 0.16, 880); },
    error: function () { tone(160, 0.16, 'square', 0.1, 110); },
    deploy: function () {
      tone(220, 0.16, 'sine', 0.3, 90);
      noise(0.12, 0.12, 500);
    },
    shoot: function () { tone(920, 0.07, 'square', 0.05, 480); },
    hit: function () { noise(0.06, 0.1, 1400, 0, 'bandpass'); },
    heal: function () { tone(520, 0.18, 'sine', 0.08, 780); },
    explosion: function () {
      noise(0.5, 0.4, 300);
      tone(90, 0.45, 'sine', 0.35, 40);
    },
    towerDown: function () {
      noise(0.8, 0.4, 220);
      tone(140, 0.7, 'sawtooth', 0.16, 45);
      tone(520, 0.3, 'triangle', 0.14, 780, 0.15);
    },
    crown: function () { tone(740, 0.12, 'triangle', 0.18); tone(988, 0.2, 'triangle', 0.18, null, 0.1); },
    energyFull: function () { tone(1180, 0.1, 'sine', 0.07); },
    victory: function () {
      var notes = [523, 659, 784, 1047, 784, 1047];
      for (var i = 0; i < notes.length; i++) tone(notes[i], 0.24, 'triangle', 0.2, null, i * 0.13);
    },
    defeat: function () {
      var notes = [392, 330, 262, 196];
      for (var i = 0; i < notes.length; i++) tone(notes[i], 0.3, 'triangle', 0.18, null, i * 0.18);
    },
  };

  window.SS = window.SS || {};
  window.SS.audio = sfx;
})();
