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
  const ROLES = {
    run:    'middle_pose_01',   // default running pose
    jump:   'middle_pose_02',   // airborne pose
    slide:  'middle_pose_06',   // ducking / sliding pose (shortest piece)
    idle:   'top_full_body_01', // standing full body (menu / countdown)
    avatar: 'top_full_body_01', // menu profile picture
    win:    'top_full_body_02', // victory / run-complete art
    lose:   'top_full_body_03', // defeat art
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
    // try PNG first, then SVG
    let img = await loadImage(BASE + meta.png);
    if (!img) img = await loadImage(BASE + meta.svg);
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

  function resolveName(roleOrName) {
    return ROLES[roleOrName] || roleOrName;
  }

  function get(roleOrName) {
    const name = resolveName(roleOrName);
    const entry = byName[name];
    if (entry && entry.ok && entry.img && entry.img.complete && entry.img.naturalWidth > 0) return entry;
    return null;
  }

  function has(roleOrName) { return !!get(roleOrName); }

  /**
   * Draw a character piece anchored at the FEET (footX, footY), scaled so its
   * height == targetH. Returns true if it drew, false if the asset is missing
   * (so callers can fall back).
   * opts: { alpha, tint, bob, flip }
   */
  function draw(ctx, roleOrName, footX, footY, targetH, opts) {
    opts = opts || {};
    const entry = get(roleOrName);
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
