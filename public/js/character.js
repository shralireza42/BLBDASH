/*
 * Blobbie Dash - manifest-driven character system.
 *
 * Loads public/assets/character/manifest.json and the matching art, then draws
 * the right piece for each game state (running, jumping, sliding, win, lose,
 * avatar, ...). Art is anchored by the FEET and scaled to a target height,
 * preserving each piece's exported aspect ratio.
 *
 * ─── HOW TO USE YOUR OWN ART ────────────────────────────────────────────────
 * 1. Export your pieces and drop them into public/assets/character/png (and/or
 *    /svg) using the SAME file names as in manifest.json. PNG is preferred; if a
 *    PNG is missing the SVG is used; if both are missing we fall back to the
 *    classic blobbie1.png sprite, so the game never breaks.
 * 2. Decide which piece represents which game state by editing ROLES below.
 *    (e.g. set run/jump/slide to your action poses, win/lose to your reaction
 *    poses.) Open /assets/character/preview.html to see every piece + its name.
 * ────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // Map a game ROLE -> an asset `name` from the manifest. Edit freely.
  //
  // A role can be EITHER a single name (string) OR an array of names for a
  // frame-by-frame animation cycle. e.g. to make a real running animation,
  // export run_01.svg, run_02.svg, ... and set:
  //   run: ['run_01', 'run_02', 'run_03', 'run_04'],
  // The frames are cycled automatically (see RUN_FPS) while the player runs.
  // (Even with a SINGLE run pose, the engine adds a procedural bounce/lean so
  //  the character visibly "runs" — see blobbie.js.)
  const ROLES = {
    run:    'middle_pose_01',   // running pose (string, or an array of frames)
    jump:   'middle_pose_02',   // airborne pose
    slide:  'middle_pose_06',   // ducking / sliding pose (shortest piece)
    idle:   'top_full_body_01', // standing full body (menu / countdown)
    avatar: 'top_full_body_01', // menu profile picture
    win:    'top_full_body_02', // victory / run-complete art
    lose:   'top_full_body_03', // defeat art
  };

  const RUN_FPS = 10; // frames/sec when a role is an array of frames

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
    // SVG-first (this project ships SVG-only art). Fall back to PNG only if a
    // project chooses to provide PNGs instead.
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
      } catch (e) {
        manifest = [];
      }
      // index meta immediately so draw() can resolve aspect ratios
      manifest.forEach((m) => { byName[m.name] = { meta: m, img: null, ok: false }; });
      ready = manifest.length > 0;
      // load art in the background; draw() checks per-asset readiness
      await Promise.all(manifest.map(loadOne));
    })();
    return loadPromise;
  }

  // Resolve a role/name (+ optional time for animated frame arrays) to a single
  // concrete asset name.
  function resolveName(roleOrName, time) {
    const val = ROLES[roleOrName] != null ? ROLES[roleOrName] : roleOrName;
    if (Array.isArray(val)) {
      if (!val.length) return null;
      const i = Math.floor((time || 0) * RUN_FPS) % val.length;
      return val[i];
    }
    return val;
  }

  function entryFor(name) {
    const entry = byName[name];
    if (entry && entry.ok && entry.img && entry.img.complete && entry.img.naturalWidth > 0) return entry;
    return null;
  }

  function get(roleOrName, time) {
    return entryFor(resolveName(roleOrName, time));
  }

  // A role "exists" if its (first) frame is loaded.
  function has(roleOrName) {
    const val = ROLES[roleOrName] != null ? ROLES[roleOrName] : roleOrName;
    const first = Array.isArray(val) ? val[0] : val;
    return !!entryFor(first);
  }

  /**
   * Draw a character piece anchored at the FEET (footX, footY), scaled so its
   * height == targetH. Returns true if it drew, false if the asset is missing
   * (so callers can fall back).
   * opts: { alpha, tint, bob, flip }
   */
  function draw(ctx, roleOrName, footX, footY, targetH, opts) {
    opts = opts || {};
    const entry = get(roleOrName, opts.time) || get(roleOrName);
    if (!entry) return false;
    const [ew, eh] = entry.meta.export_size;
    const w = targetH * (ew / eh);
    const h = targetH;
    const bob = opts.bob || 0;
    const dx = footX - w / 2;
    const dy = footY - h - bob;

    ctx.save();
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    if (opts.flip) { ctx.translate(footX, 0); ctx.scale(-1, 1); ctx.translate(-footX, 0); }
    if (opts.tint) {
      ctx.drawImage(entry.img, dx, dy, w, h);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = (opts.alpha == null ? 1 : opts.alpha) * 0.5;
      ctx.fillStyle = opts.tint;
      ctx.fillRect(dx, dy, w, h);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(entry.img, dx, dy, w, h);
    }
    ctx.restore();
    return true;
  }

  // Draw a piece to fit (contain) inside a box centred at (cx, cy) — used for
  // avatars / result art on small canvases.
  function drawContained(ctx, roleOrName, cx, cy, boxW, boxH, opts) {
    const entry = get(roleOrName);
    if (!entry) return false;
    const [ew, eh] = entry.meta.export_size;
    const scale = Math.min(boxW / ew, boxH / eh);
    const w = ew * scale, h = eh * scale;
    return draw(ctx, roleOrName, cx, cy + h / 2, h, opts);
  }

  window.Character = {
    ROLES, load, draw, drawContained, has, get,
    get ready() { return ready; },
    get manifest() { return manifest; },
    image(name) { const e = get(name); return e ? e.img : null; },
  };
})();
