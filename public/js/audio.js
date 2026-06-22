/*
 * Blobbie Dash - synthesized sound engine (Web Audio API).
 *
 * All SFX and the looping background music are generated procedurally, so there
 * are no audio files to ship and nothing to 404. Audio only starts after a user
 * gesture (browser autoplay policy) — call Sound.unlock() from a click handler.
 */
(function () {
  'use strict';

  let ctx = null;
  let master = null, sfxGain = null, musicGain = null;
  let noiseBuf = null;
  let muted = false;
  let musicOn = false;
  let schedTimer = null;
  let step = 0;
  let nextNoteTime = 0;

  try { muted = localStorage.getItem('blobbieDash.muted') === '1'; } catch (e) {}

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.5; musicGain.connect(master);

    // shared white-noise buffer
    const len = ctx.sampleRate * 1.0;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  // ---- low-level voices ----
  function tone(opts) {
    if (!ensure() || muted) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + opts.dur);
    const peak = opts.vol == null ? 0.3 : opts.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g); g.connect(opts.bus || sfxGain);
    o.start(t); o.stop(t + opts.dur + 0.02);
  }

  function noise(dur, freq, q, vol) {
    if (!ensure() || muted) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq || 1200; bp.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol == null ? 0.4 : vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // ---- SFX ----
  const SFX = {
    jump() { tone({ type: 'sine', f0: 320, f1: 760, dur: 0.22, vol: 0.32 }); tone({ type: 'triangle', f0: 480, f1: 1000, dur: 0.18, vol: 0.12 }); },
    slide() { noise(0.28, 900, 0.8, 0.28); tone({ type: 'sawtooth', f0: 520, f1: 160, dur: 0.26, vol: 0.14 }); },
    lane() { noise(0.12, 2200, 1.2, 0.18); },
    coin() { tone({ type: 'square', f0: 988, dur: 0.07, vol: 0.16 }); setTimeout(() => tone({ type: 'square', f0: 1319, dur: 0.12, vol: 0.16 }), 60); },
    crash() { noise(0.5, 380, 0.6, 0.55); tone({ type: 'sawtooth', f0: 220, f1: 50, dur: 0.5, vol: 0.3 }); },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.28 }), i * 110)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone({ type: 'sawtooth', f0: f, dur: 0.32, vol: 0.22 }), i * 130)); },
    click() { tone({ type: 'square', f0: 660, dur: 0.05, vol: 0.12 }); },
    count() { tone({ type: 'sine', f0: 440, dur: 0.15, vol: 0.25 }); },
    go() { tone({ type: 'sine', f0: 880, dur: 0.3, vol: 0.3 }); },
    // soft running footstep (subtle): a short filtered tap + a tiny low thud
    footstep() { noise(0.06, 300, 1.4, 0.10); tone({ type: 'sine', f0: 150, f1: 80, dur: 0.07, vol: 0.06 }); },
    // wooden fence bump
    fence() { tone({ type: 'square', f0: 190, f1: 90, dur: 0.12, vol: 0.2 }); noise(0.07, 520, 1.4, 0.16); },
  };

  // ---- looping ambient synthwave music ----
  const BPM = 104;
  const stepDur = () => 60 / BPM / 2; // 8th notes
  // Am - F - C - G progression (bass roots), arpeggio over it.
  const PROG = [
    { bass: 55.00, arp: [220.00, 261.63, 329.63, 261.63] },   // Am
    { bass: 43.65, arp: [174.61, 220.00, 261.63, 220.00] },   // F
    { bass: 65.41, arp: [196.00, 261.63, 329.63, 261.63] },   // C
    { bass: 49.00, arp: [196.00, 246.94, 293.66, 246.94] },   // G
  ];

  function scheduleStep(time) {
    const bar = Math.floor(step / 8) % PROG.length;
    const chord = PROG[bar];
    const inBar = step % 8;

    // bass on beats
    if (inBar % 2 === 0) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = chord.bass;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.22, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + stepDur() * 1.8);
      o.connect(lp); lp.connect(g); g.connect(musicGain);
      o.start(time); o.stop(time + stepDur() * 2);
    }
    // soft kick on every beat
    if (inBar % 2 === 0) {
      const k = ctx.createOscillator(); const kg = ctx.createGain();
      k.type = 'sine'; k.frequency.setValueAtTime(140, time);
      k.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      kg.gain.setValueAtTime(0.5, time);
      kg.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      k.connect(kg); kg.connect(musicGain);
      k.start(time); k.stop(time + 0.2);
    }
    // arpeggio (pluck)
    const note = chord.arp[inBar % chord.arp.length];
    const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
    o2.type = 'triangle'; o2.frequency.value = note * 2;
    g2.gain.setValueAtTime(0.0001, time);
    g2.gain.exponentialRampToValueAtTime(0.10, time + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, time + stepDur() * 0.9);
    o2.connect(g2); g2.connect(musicGain);
    o2.start(time); o2.stop(time + stepDur());

    step++;
  }

  function scheduler() {
    if (!ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.2) {
      scheduleStep(nextNoteTime);
      nextNoteTime += stepDur();
    }
  }

  // ---- custom sound/music files (theme.sounds) override the synth ----
  // If a configured file is missing/unplayable, we fall back to the built-in
  // synth and remember it's missing (so we don't retry / spam 404s).
  const SF = () => (window.BlobbieTheme && window.BlobbieTheme.sounds) || {};
  const missingAudio = Object.create(null);
  let musicEl = null;

  function playFile(url, fallback) {
    if (muted) return;
    try {
      const a = new Audio(url);
      a.volume = 0.9;
      let done = false;
      const fb = () => { if (done) return; done = true; missingAudio[url] = true; if (fallback) fallback(); };
      a.addEventListener('error', fb);
      const pr = a.play();
      if (pr && pr.catch) pr.catch(fb);
    } catch (e) { missingAudio[url] = true; if (fallback) fallback(); }
  }

  // Public SFX: play a custom file if present, else the synth voice.
  function sfx(key) {
    const f = SF()[key];
    const synth = () => { if (SFX[key]) SFX[key](); };
    if (f && !missingAudio[f]) { playFile(f, synth); return; }
    synth();
  }

  function startSynthMusic() {
    if (!ensure() || schedTimer) return;
    musicOn = true;
    step = 0;
    nextNoteTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 50);
  }
  function startMusic() {
    const url = SF().music;
    if (url && !missingAudio[url]) {
      if (!musicEl) {
        musicEl = new Audio(url); musicEl.loop = true;
        musicEl.addEventListener('error', () => { missingAudio[url] = true; musicEl = null; startSynthMusic(); });
      }
      musicEl.volume = muted ? 0 : 0.5;
      const pr = musicEl.play();
      if (pr && pr.catch) pr.catch(() => { missingAudio[url] = true; musicEl = null; startSynthMusic(); });
      musicOn = true;
      return;
    }
    startSynthMusic();
  }
  function stopMusic() {
    musicOn = false;
    if (musicEl) { try { musicEl.pause(); } catch (e) {} }
    if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('blobbieDash.muted', m ? '1' : '0'); } catch (e) {}
    if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
    if (musicEl) musicEl.volume = m ? 0 : 0.5;
  }
  function toggleMuted() { setMuted(!muted); return muted; }

  window.Sound = {
    unlock, startMusic, stopMusic, setMuted, toggleMuted,
    isMuted() { return muted; },
    isMusicOn() { return musicOn; },
    sfx: SFX,
    // convenience pass-throughs (custom file if set, else synth)
    jump: () => sfx('jump'), slide: () => sfx('slide'), lane: () => sfx('lane'),
    coin: () => sfx('coin'), crash: () => sfx('crash'), win: () => sfx('win'),
    lose: () => sfx('lose'), click: () => sfx('click'), count: () => sfx('count'), go: () => sfx('go'),
    footstep: () => sfx('footstep'), fence: () => sfx('fence'),
  };
})();
