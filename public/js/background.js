/* Blobbie Dash - menu background driver.
 * Renders the ONE shared underwater-tunnel scene (same as gameplay) onto the
 * full-screen #bgfx canvas. The menu UI is just an overlay on top of this. */
(function () {
  'use strict';

  let canvas, ctx, dpr, raf = null, last = 0, running = false, bg = null;

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bg) bg = new window.BlobbieDashUnderwaterBackground();
    bg.setSize(W, H, dpr);
  }

  function frame(t) {
    if (!running) return;
    const dt = last ? (t - last) / 1000 : 0;
    last = t;
    bg.update(dt);
    bg.draw(ctx);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || !bg) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }
  // force a rebuild of the scene (e.g. after the GIF backdrop fails to load and
  // we revert to the drawn scene, so imageBg mode is re-evaluated).
  function refresh() { if (bg) { bg._built = false; fit(); } }

  function init() {
    canvas = document.getElementById('bgfx');
    if (!canvas || !window.BlobbieDashUnderwaterBackground) return;
    ctx = canvas.getContext('2d');
    fit();
    window.addEventListener('resize', fit);
    start();
  }

  window.Background = { init, start, stop, refresh, setActive(on) { on ? start() : stop(); } };
  if (document.readyState !== 'loading') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
