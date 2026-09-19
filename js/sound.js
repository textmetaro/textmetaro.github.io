/* sound.js — sample-first, synth-fallback audio + haptics.
 *
 * TYPING follows TickTock (github.com/0xJacky/TickTock): one of THREE sounds
 * chosen by key type — delete / modifier (space·return·shift) / click (normal).
 * Provide real files via CONFIG.sounds.keyboard.{click,delete,modifier}, or
 * leave null to get three distinct synthesized clicks.
 *
 * SEND / RECEIVE use CONFIG.sounds.send/receive. Each sound entry is:
 *   "sounds/x"  |  { src:"sounds/x", offset:2.0, maxDur:1.6 }  |  null(→synth)
 * Extensions mp3/m4a/wav/ogg are tried in order; first that loads wins.
 *
 * COPYRIGHT: TickTock's .caf files are Apple's iOS UISounds. Ship your own /
 * royalty-free audio for public deploys. Synth fallbacks are safe as-is.
 * Haptics: navigator.vibrate works on Android/Chrome; iOS Safari ignores it.
 */
(function () {
  "use strict";

  var CONFIG = window.CONFIG || {};
  var USE_CUSTOM = !!CONFIG.useCustomSounds;
  var SND = CONFIG.sounds || {};
  var EXTS = ["mp3", "m4a", "wav", "ogg"];

  var ctx = null;
  var enabled = true;
  var buffers = {};      // name -> { buf, offset, maxDur }
  var preloaded = false;

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { ctx = new AC(); bindKeepAlive(); }
    }
    // iOS parks the context in "suspended" (backgrounded) or "interrupted"
    // (phone call / another app grabbed audio). Both need an explicit resume,
    // or every sound silently no-ops until the user reloads.
    if (ctx && ctx.state !== "running") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // Keep the context alive: resume() is async, so the FIRST tap after the OS
  // suspends us plays before resume lands (→ that one sound is dropped). We
  // resume PROACTIVELY on every early interaction + when the tab returns, so
  // the context is already running by the time a sound actually fires.
  var keepAliveBound = false;
  function bindKeepAlive() {
    if (keepAliveBound || !ctx) return;
    keepAliveBound = true;
    var wake = function () { if (ctx && ctx.state !== "running") { try { ctx.resume(); } catch (e) {} } };
    ["pointerdown", "touchstart", "keydown", "focusin"].forEach(function (ev) {
      document.addEventListener(ev, wake, { capture: true, passive: true });
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) wake();
    });
    // Safari fires statechange when it interrupts us — grab it back.
    try { ctx.addEventListener("statechange", wake); } catch (e) {}
  }

  // normalize a config entry -> { src, offset, maxDur } | null
  function spec(entry) {
    if (!entry) return null;
    if (typeof entry === "string") return { src: entry, offset: 0, maxDur: 0 };
    if (!entry.src) return null;
    return { src: entry.src, offset: entry.offset || 0, maxDur: entry.maxDur || 0 };
  }

  function loadInto(name, entry) {
    var sp = spec(entry);
    if (!sp) return;
    var i = 0;
    function next() {
      if (i >= EXTS.length) return;
      var url = sp.src + "." + EXTS[i++];
      fetch(url)
        .then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(function (ab) { return ac().decodeAudioData(ab); })
        .then(function (buf) { buffers[name] = { buf: buf, offset: sp.offset, maxDur: sp.maxDur }; })
        .catch(function () { next(); });
    }
    next();
  }

  function preload() {
    if (preloaded || !USE_CUSTOM) return;
    preloaded = true;
    ac();
    var kb = SND.keyboard || {};
    loadInto("kb_click", kb.click);
    loadInto("kb_delete", kb.delete);
    loadInto("kb_modifier", kb.modifier);
    loadInto("send", SND.send);
    loadInto("receive", SND.receive);
  }

  // must be called from a user gesture once to unlock audio on iOS
  function unlock() { ac(); preload(); }

  function playBuffer(name, vol) {
    var c = ac();
    var b = buffers[name];
    if (!c || !b) return false;
    var src = c.createBufferSource();
    src.buffer = b.buf;
    var g = c.createGain();
    g.gain.value = vol == null ? 1 : vol;
    src.connect(g).connect(c.destination);
    if (b.maxDur > 0) src.start(0, b.offset || 0, b.maxDur);
    else src.start(0, b.offset || 0);
    return true;
  }

  // ---- synth fallbacks ----
  function blip(opts) {
    var c = ac();
    if (!c) return;
    var t0 = c.currentTime;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1) osc.frequency.exponentialRampToValueAtTime(opts.f1, t0 + opts.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.vol || 0.2, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  // one filtered-noise "click", tuned per key kind (TickTock-style variety)
  var KEY_TONE = {
    click:    { freq: 2200, q: 1.1, dur: 0.026, thump: 170, vol: 0.42 },
    delete:   { freq: 1650, q: 1.0, dur: 0.024, thump: 150, vol: 0.40 },
    modifier: { freq: 1150, q: 0.9, dur: 0.034, thump: 120, vol: 0.46 },
  };
  function synthKey(kind) {
    var c = ac();
    if (!c) return;
    var p = KEY_TONE[kind] || KEY_TONE.click;
    var t0 = c.currentTime;
    var buf = c.createBuffer(1, Math.ceil(c.sampleRate * p.dur), c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 5);
    }
    var src = c.createBufferSource();
    src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = p.freq + (Math.random() * 500 - 250); // key-to-key variance
    bp.Q.value = p.q;
    var hp = c.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 800;
    var g = c.createGain(); g.gain.value = p.vol;
    src.connect(bp).connect(hp).connect(g).connect(c.destination);
    src.start(t0);
    blip({ type: "sine", f0: p.thump, f1: p.thump * 0.7, dur: 0.03, vol: 0.07 });
  }

  // ---- public API ----
  // kind: "click" | "delete" | "modifier"
  function key(kind) {
    if (!enabled) return;
    kind = kind || "click";
    // When custom sounds are configured, ONLY use the sample — never the synth
    // fallback (which is the "old" sound the user heard before files loaded).
    if (!playBuffer("kb_" + kind, 0.9) && !USE_CUSTOM) synthKey(kind);
    haptic(kind === "modifier" ? 10 : 7);
  }
  function tick() { key("click"); } // backward-compat

  function send() {
    if (!enabled) return;
    if (!playBuffer("send", 1) && !USE_CUSTOM) {
      blip({ type: "sine", f0: 480, f1: 1500, dur: 0.16, vol: 0.22 });
      blip({ type: "triangle", f0: 900, f1: 1700, dur: 0.14, vol: 0.08 });
    }
    haptic(12);
  }
  function receive() {
    if (!enabled) return;
    if (!playBuffer("receive", 1) && !USE_CUSTOM) {
      blip({ type: "sine", f0: 1050, f1: 1050, dur: 0.14, vol: 0.16 });
      setTimeout(function () { blip({ type: "sine", f0: 1400, f1: 1400, dur: 0.2, vol: 0.14 }); }, 95);
    }
    haptic([0, 18, 40, 12]);
  }
  function celebrate() {
    [523, 659, 784, 1046].forEach(function (f, i) {
      setTimeout(function () { blip({ type: "triangle", f0: f, f1: f, dur: 0.22, vol: 0.2 }); }, i * 120);
    });
    haptic([0, 30, 30, 30, 30, 60]);
  }

  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }
  function setEnabled(v) { enabled = !!v; }

  window.Sound = {
    unlock: unlock, key: key, tick: tick, send: send, receive: receive,
    celebrate: celebrate, haptic: haptic, setEnabled: setEnabled,
  };
})();
