/* Blobbie character renderer: loads the sprite and animates it with
 * squash/stretch + bobbing. Falls back to a procedural blob if the image
 * is unavailable, so the game never breaks. */
(function () {
  'use strict';

  const sprite = new Image();
  let spriteReady = false;
  let spriteFailed = false;
  sprite.onload = () => { spriteReady = true; };
  sprite.onerror = () => { spriteFailed = true; };
  // resolved relative to the page; works when embedded too
  sprite.src = 'assets/blobbie1.png';

  function drawProcedural(ctx, w, h, tint) {
    // Cute fallback blob, drawn centred in a w x h box (origin top-left).
    const cx = w / 2;
    ctx.save();
    ctx.fillStyle = tint || '#ef7a8b';
    ctx.strokeStyle = '#1d1d28';
    ctx.lineWidth = Math.max(2, w * 0.04);
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.08);
    ctx.bezierCurveTo(w * 0.95, h * 0.05, w * 1.02, h * 0.7, w * 0.78, h * 0.96);
    ctx.bezierCurveTo(w * 0.6, h * 1.02, w * 0.4, h * 1.02, w * 0.22, h * 0.96);
    ctx.bezierCurveTo(w * -0.02, h * 0.7, w * 0.05, h * 0.05, cx, h * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // eyes
    ctx.fillStyle = '#fff';
    const ey = h * 0.42, er = w * 0.14;
    ctx.beginPath(); ctx.arc(cx - w * 0.18, ey, er, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + w * 0.18, ey, er, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1d1d28';
    ctx.beginPath(); ctx.arc(cx - w * 0.16, ey + 2, er * 0.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + w * 0.20, ey + 2, er * 0.5, 0, 7); ctx.fill();
    // smile
    ctx.strokeStyle = '#7a1f2b';
    ctx.lineWidth = Math.max(2, w * 0.05);
    ctx.beginPath(); ctx.arc(cx, h * 0.58, w * 0.18, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw Blobbie centred at (x, y) where y is the FEET position.
   * size = target height in px. state controls the pose.
   *
   * Prefers the manifest-driven Character pieces (see character.js); if those
   * aren't available it falls back to the classic blobbie1.png sprite, and then
   * to a fully procedural blob, so the game always renders something.
   */
  function draw(ctx, x, y, size, opts) {
    opts = opts || {};
    const t = opts.time || 0;
    const alpha = opts.alpha == null ? 1 : opts.alpha;

    // (under-player shadow removed)

    // 0) custom single player image (theme.sprites.player) overrides everything
    const pUrl = window.BlobbieTheme && window.BlobbieTheme.sprites && window.BlobbieTheme.sprites.player;
    const pImg = pUrl && window.BlobbieAssets ? window.BlobbieAssets.get(pUrl) : null;
    if (pImg) {
      const ph = size, pw = ph * ((pImg.naturalWidth / pImg.naturalHeight) || 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(pImg, x - pw / 2, y - ph, pw, ph);
      if (opts.tint) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = alpha * 0.5; ctx.fillStyle = opts.tint;
        ctx.fillRect(x - pw / 2, y - ph, pw, ph);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      return;
    }

    // 1) preferred: the exact animation frame chosen by the Animator. The frame
    //    sequence is the animation itself, so we draw it straight (no procedural
    //    squash/stretch on top).
    if (opts.frame && window.Character && window.Character.has(opts.frame)) {
      if (window.Character.draw(ctx, opts.frame, x, y, size, { alpha, tint: opts.tint })) return;
    }

    // 1b) if that animation frame SVG is missing, fall back to blobbie.svg
    if (window.Character && window.Character.hasFallback()) {
      if (window.Character.drawFallback(ctx, x, y, size, { alpha, tint: opts.tint })) return;
    }

    // 2) fallback: classic sprite / procedural blob (with squash & stretch)
    let sx = 1, sy = 1, lean = 0, bob = 0;
    if (opts.state === 'jump') { sy = 1.12; sx = 0.92; lean = -0.05; }
    else if (opts.state === 'slide') { sy = 0.55; sx = 1.35; }
    else { const phase = Math.sin(t * 14); sy = 1 + phase * 0.05; sx = 1 - phase * 0.05; bob = Math.abs(Math.cos(t * 14)) * size * 0.04; }

    const w = size * sx;
    const h = size * sy;
    const drawX = x - w / 2;
    const drawY = y - h + bob;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (lean) {
      ctx.translate(x, y);
      ctx.rotate(lean);
      ctx.translate(-x, -y);
    }

    if (spriteReady && !spriteFailed) {
      if (opts.tint) {
        // draw opponent ghost with a tint overlay
        ctx.drawImage(sprite, drawX, drawY, w, h);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = opts.tint;
        ctx.globalAlpha = (opts.alpha == null ? 1 : opts.alpha) * 0.45;
        ctx.fillRect(drawX, drawY, w, h);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.drawImage(sprite, drawX, drawY, w, h);
      }
    }
    ctx.restore();

    // procedural fallback needs its own transform (drawn at origin box)
    if (!spriteReady && spriteFailed) {
      ctx.save();
      ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
      ctx.translate(drawX, drawY);
      drawProcedural(ctx, w, h, opts.tint);
      ctx.restore();
    }
  }

  window.Blobbie = { draw, get ready() { return spriteReady; } };
})();
