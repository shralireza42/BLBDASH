/*
 * Blobbie Dash - frame-based character animation system (SVG only).
 *
 * Five animations, each a sequence of SVG frames in public/assets/character/svg/:
 *   run    : run_back_frame_01..08              (loops while the player just runs)
 *   jump   : jump_back_frame_01..06             (UP key)
 *   slide  : jump_slide_sit_mix_back_frame_01..06 (DOWN key)
 *   left   : move_left_back_frame_01..06        (LEFT key)
 *   right  : move_right_back_frame_01..06       (RIGHT key)
 *
 * Behaviour:
 *   - `run` loops forever by default.
 *   - The four key animations are ONE-SHOT PING-PONG: they play frame 1 -> last,
 *     then smoothly back last -> 1, and then hand control back to `run`.
 *
 * ─── USE YOUR OWN ART ───────────────────────────────────────────────────────
 * Replace each file in public/assets/character/svg/ with your own SVG of the
 * SAME file name. The game loads strictly by these names (see manifest.json).
 * To add/remove frames or retime an animation, edit ANIM below.
 * ────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');
  const seq = (base, count) => Array.from({ length: count }, (_, i) => base + pad2(i + 1));

  // The five animations. `fps` = playback speed; loop vs. one-shot ping-pong.
  const ANIM = {
    run:   { frames: seq('run_back_frame_', 8),                 fps: 14, loop: true },
    jump:  { frames: seq('jump_back_frame_', 6),                fps: 14, pingpong: true },
    slide: { frames: seq('jump_slide_sit_mix_back_frame_', 6),  fps: 18, pingpong: true },
    left:  { frames: seq('move_left_back_frame_', 6),           fps: 24, pingpong: true },
    right: { frames: seq('move_right_back_frame_', 6),          fps: 24, pingpong: true },
  };

  // Static single-frame roles (menu avatar, win/lose art). Point these at any
  // frame you like.
  const ROLES = {
    idle:   'run_back_frame_01',
    avatar: 'run_back_frame_01',
    win:    'jump_back_frame_06',
    lose:   'jump_slide_sit_mix_back_frame_06',
  };

  const MANIFEST_URL = 'assets/character/manifest.json';
  const BASE = 'assets/character/';

  const byName = Object.create(null); // name -> { meta, img, ok }
  let manifest = [];
  let ready = false;
  let loadPromise = null;

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function loadOne(meta) {
    let img = meta.svg ? await loadImage(BASE + meta.svg) : null;
    if (!img && meta.png) img = await loadImage(BASE + meta.png);
    byName[meta.name] = { meta, img, ok: !!img };
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
        manifest = await res.json();
      } catch (e) { manifest = []; }
      manifest.forEach((m) => { byName[m.name] = { meta: m, img: null, ok: false }; });
      ready = manifest.length > 0;
      await Promise.all(manifest.map(loadOne));
    })();
    return loadPromise;
  }

  function resolveName(roleOrName) { return ROLES[roleOrName] || roleOrName; }

  function entryFor(name) {
    const e = byName[name];
    if (e && e.ok && e.img && e.img.complete && e.img.naturalWidth > 0) return e;
    return null;
  }

  function get(roleOrName) { return entryFor(resolveName(roleOrName)); }
  function has(roleOrName) { return !!get(roleOrName); }

  /**
   * Draw an exact frame/role anchored at the FEET (footX, footY), scaled so its
   * height == targetH. Aspect ratio comes from the actual SVG (so your art is
   * never distorted). opts: { alpha, tint }. Returns true if drawn.
   */
  function draw(ctx, roleOrName, footX, footY, targetH, opts) {
    opts = opts || {};
    const entry = get(roleOrName);
    if (!entry) return false;
    const iw = entry.img.naturalWidth || entry.meta.export_size[0];
    const ih = entry.img.naturalHeight || entry.meta.export_size[1];
    const w = targetH * (iw / ih);
    const h = targetH;
    const dx = footX - w / 2;
    const dy = footY - h;

    ctx.save();
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.drawImage(entry.img, dx, dy, w, h);
    if (opts.tint) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = (opts.alpha == null ? 1 : opts.alpha) * 0.5;
      ctx.fillStyle = opts.tint;
      ctx.fillRect(dx, dy, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    return true;
  }

  // Fit a role/frame inside a box centred at (cx, cy) — avatars / result art.
  function drawContained(ctx, roleOrName, cx, cy, boxW, boxH, opts) {
    const entry = get(roleOrName);
    if (!entry) return false;
    const iw = entry.img.naturalWidth || entry.meta.export_size[0];
    const ih = entry.img.naturalHeight || entry.meta.export_size[1];
    const scale = Math.min(boxW / iw, boxH / ih);
    const h = ih * scale;
    return draw(ctx, roleOrName, cx, cy + h / 2, h, opts);
  }

  // Frame name for a looping animation at a given time (used for the opponent
  // ghost, which always just runs).
  function frameAtTime(animKey, time) {
    const def = ANIM[animKey];
    if (!def) return null;
    const n = def.frames.length;
    return def.frames[Math.floor((time || 0) * def.fps) % n];
  }

  /**
   * Stateful per-player animation controller.
   *   play('jump'|'slide'|'left'|'right'|'run')  -> trigger an animation
   *   update(dt)                                  -> advance; one-shots auto-return to run
   *   currentFrame()                              -> asset name to draw this frame
   */
  function Animator() {
    this.key = 'run';
    this.def = ANIM.run;
    this.t = 0;
  }
  Animator.prototype.play = function (key) {
    const def = ANIM[key];
    if (!def) return;
    if (key === this.key && def.loop) return; // keep run looping seamlessly
    this.key = key; this.def = def; this.t = 0; // (re)start; one-shots restart on repeat press
  };
  const EPS = 1e-6; // guard against float under-floor dropping a frame
  Animator.prototype.update = function (dt) {
    this.t += dt;
    if (this.def.pingpong) {
      const total = this.def.frames.length * 2 - 1; // 1..N then N-1..1
      if (this.t * this.def.fps + EPS >= total) this.play('run');
    }
  };
  Animator.prototype.currentFrame = function () {
    const fr = this.def.frames, n = fr.length;
    if (this.def.loop) return fr[Math.floor(this.t * this.def.fps + EPS) % n];
    const total = n * 2 - 1;
    let idx = Math.floor(this.t * this.def.fps + EPS);
    if (idx >= total) idx = total - 1;
    const f = idx < n ? idx : (2 * n - 2 - idx); // ping-pong fold
    return fr[f];
  };
  Animator.prototype.isOneShot = function () { return !!this.def.pingpong; };

  window.Character = {
    ANIM, ROLES, Animator, load, draw, drawContained, frameAtTime, has, get,
    get ready() { return ready; },
    get manifest() { return manifest; },
    image(name) { const e = get(name); return e ? e.img : null; },
  };
})();
