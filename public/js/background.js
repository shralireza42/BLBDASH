/* Blobbie Dash - animated neon underwater background for menu / non-game screens.
 * Renders to a full-screen canvas (#bgfx) behind the UI. Pauses during gameplay. */
(function () {
  'use strict';

  let canvas, ctx, W, H, dpr, raf = null, t0 = 0, running = false;
  const bubbles = [];
  const orbs = [];

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    bubbles.length = 0;
    for (let i = 0; i < 46; i++) {
      bubbles.push({ x: Math.random() * W, y: Math.random() * H, r: 2 + Math.random() * 7, sp: 12 + Math.random() * 40, drift: (Math.random() - 0.5) * 14 });
    }
    orbs.length = 0;
    const colors = ['#16f2d6', '#ff4fd8', '#7b5cff', '#22d3ee'];
    for (let i = 0; i < 5; i++) {
      orbs.push({ x: Math.random() * W, y: Math.random() * H * 0.7, r: 80 + Math.random() * 160, c: colors[i % colors.length], ph: Math.random() * 6.28 });
    }
  }

  function draw(t) {
    const time = (t - t0) / 1000;

    // deep ocean gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04030f');
    g.addColorStop(0.45, '#0a0a3a');
    g.addColorStop(1, '#12044a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // glowing distant orbs (jellyfish-light)
    for (const o of orbs) {
      const oy = o.y + Math.sin(time * 0.3 + o.ph) * 18;
      const rg = ctx.createRadialGradient(o.x, oy, 0, o.x, oy, o.r);
      rg.addColorStop(0, o.c + '55');
      rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(o.x, oy, o.r, 0, 7); ctx.fill();
    }

    // god rays from top
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const rx = (i / 5) * W + Math.sin(time * 0.2 + i) * 30 + 40;
      const grd = ctx.createLinearGradient(rx, 0, rx + 80, H);
      grd.addColorStop(0, 'rgba(80,220,255,0.10)');
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(rx, 0); ctx.lineTo(rx + 70, 0); ctx.lineTo(rx + 240, H); ctx.lineTo(rx - 120, H);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // neon perspective grid near the bottom (synthwave seabed)
    const horizon = H * 0.62;
    ctx.save();
    ctx.strokeStyle = 'rgba(22,242,214,0.35)';
    ctx.shadowColor = '#16f2d6'; ctx.shadowBlur = 8; ctx.lineWidth = 1.5;
    // verticals converging to centre
    const cx = W / 2;
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 26, horizon);
      ctx.lineTo(cx + i * 260, H);
      ctx.stroke();
    }
    // horizontals scrolling toward viewer
    const scroll = (time * 0.35) % 1;
    for (let i = 0; i < 12; i++) {
      const p = (i + scroll) / 12;
      const y = horizon + (H - horizon) * (p * p);
      ctx.globalAlpha = Math.min(1, p * 1.4);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    // rising bubbles
    ctx.save();
    for (const b of bubbles) {
      b.y -= b.sp * 0.016;
      b.x += Math.sin(time + b.y * 0.02) * 0.3 + b.drift * 0.01;
      if (b.y < -10) { b.y = H + 10; b.x = Math.random() * W; }
      ctx.strokeStyle = 'rgba(120,240,255,0.5)';
      ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 6; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.stroke();
    }
    ctx.restore();

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, 'transparent');
    vg.addColorStop(1, 'rgba(0,0,8,0.6)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    if (running) raf = requestAnimationFrame(draw);
  }

  function start() {
    if (running) return;
    running = true; t0 = performance.now();
    raf = requestAnimationFrame(draw);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }

  function init() {
    canvas = document.getElementById('bgfx');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    fit(); seed();
    window.addEventListener('resize', () => { fit(); seed(); });
    start();
  }

  window.Background = { init, start, stop, setActive(on) { on ? start() : stop(); } };
  if (document.readyState !== 'loading') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
