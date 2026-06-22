/*
 * Blobbie Dash - ONE shared "fantastic nature" world background.
 *
 * The SAME renderer is used for the main menu and gameplay so the background is
 * identical in both. All colors come from public/theme.js (window.BlobbieTheme),
 * with built-in fallbacks. Optional textures (sky/ground/road) and an animated
 * GIF/image backdrop are supported (see theme.js).
 *
 * Static scene cached once to an offscreen canvas; only cheap animated layers
 * update per frame (pooled birds/butterflies, pollen, fireflies, dapples).
 * Projection matches game.js exactly so gameplay entities sit on the path.
 * (Class name kept for backwards-compatibility with existing references.)
 */
(function () {
  'use strict';

  const FOCAL = 10, VIEW = 72, PLAYER_Z = 0.6, LANE_EDGE = 1.55;
  const W_ = () => (window.BlobbieTheme && window.BlobbieTheme.world) || {};
  const def = (v, d) => (v == null ? d : v);

  class BlobbieDashUnderwaterBackground {
    constructor() {
      this.W = 0; this.H = 0; this.dpr = 1;
      this.staticCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      this.sctx = this.staticCanvas ? this.staticCanvas.getContext('2d') : null;
      this.fliers = []; this.pollen = []; this.motes = [];
      this.time = 0; this._built = false;
      this._tex = {}; // loaded texture images
    }

    project(z, laneWorld, worldH) {
      const persp = FOCAL / (FOCAL + Math.max(z, -FOCAL + 0.1));
      const pmin = FOCAL / (FOCAL + VIEW);
      const n = (persp - pmin) / (1 - pmin);
      const x = this.centerX + laneWorld * persp * this.spread;
      const y = this.horizonY + (this.groundY - this.horizonY) * n - (worldH || 0) * persp * (this.H * 0.07);
      return { x, y, scale: persp };
    }

    _roadEdgeX(y, side) {
      const far = side < 0 ? this.roadFarL : this.roadFarR;
      const near = side < 0 ? this.roadNearL : this.roadNearR;
      if (y <= far.y) return null;
      const t = Math.min(1, Math.max(0, (y - far.y) / (near.y - far.y)));
      return far.x + (near.x - far.x) * t;
    }

    setSize(W, H, dpr) {
      dpr = dpr || 1;
      this.imageBg = !!(window.BlobbieTheme && window.BlobbieTheme.gameplayBackground);
      if (this._built && this.W === W && this.H === H && this.dpr === dpr) return;
      this.W = W; this.H = H; this.dpr = dpr;
      this.horizonY = H * 0.40;
      this.groundY = H * 0.97;
      this.centerX = W / 2;
      this.spread = W * 0.27;
      this.roadNearL = this.project(PLAYER_Z, -LANE_EDGE, 0);
      this.roadFarL = this.project(VIEW, -LANE_EDGE, 0);
      this.roadNearR = this.project(PLAYER_Z, LANE_EDGE, 0);
      this.roadFarR = this.project(VIEW, LANE_EDGE, 0);
      this._buildStatic();
      this._seed();
      this._loadTextures();
      this._built = true;
    }

    _loadTextures() {
      const tx = W_().textures || {};
      ['sky', 'ground', 'road'].forEach((k) => {
        if (tx[k] && (!this._tex[k] || this._tex[k]._src !== tx[k])) {
          const img = new Image();
          img._src = tx[k];
          img.onload = () => { this._tex[k] = img; this._buildStatic(); };
          img.onerror = () => {};
          img.src = tx[k];
        } else if (!tx[k]) { delete this._tex[k]; }
      });
    }

    _cover(ctx, img, x, y, w, h) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return;
      const sc = Math.max(w / iw, h / ih);
      const dw = iw * sc, dh = ih * sc;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }

    // ---------- STATIC SCENE ----------
    _buildStatic() {
      const W = this.W, H = this.H, c = this.staticCanvas, ctx = this.sctx;
      c.width = Math.round(W * this.dpr);
      c.height = Math.round(H * this.dpr);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // In image/GIF-backdrop mode we draw ONLY the path (transparent elsewhere)
      // so the user's image shows behind, and the runner still has a road.
      if (this.imageBg) { this._drawPath(ctx); return; }

      const w = W_();
      // sky
      const skyC = def(w.sky, ['#3aa0ff', '#8fd0ff', '#e6f6ff']);
      const sky = ctx.createLinearGradient(0, 0, 0, this.horizonY + 30);
      sky.addColorStop(0, skyC[0]); sky.addColorStop(0.55, skyC[1]); sky.addColorStop(1, skyC[2]);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, this.horizonY + 30);
      if (this._tex.sky) this._cover(ctx, this._tex.sky, 0, 0, W, this.horizonY + 30);

      // sun
      const sx = W * 0.76, sy = this.horizonY * 0.42, sr = Math.min(W, H) * 0.16;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      sg.addColorStop(0, 'rgba(255,250,210,0.98)');
      sg.addColorStop(0.35, 'rgba(255,238,160,0.7)');
      sg.addColorStop(1, 'rgba(255,238,160,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
      ctx.fillStyle = def(w.sunCore, '#fffce1');
      ctx.beginPath(); ctx.arc(sx, sy, sr * 0.32, 0, 7); ctx.fill();

      // sun rays
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const rx = (i / 5) * W + W * 0.08;
        const grd = ctx.createLinearGradient(rx, 0, rx + 70, this.horizonY);
        grd.addColorStop(0, 'rgba(255,248,200,0.07)'); grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx + 60, 0); ctx.lineTo(rx + 160, this.horizonY); ctx.lineTo(rx - 80, this.horizonY);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      this._drawClouds(ctx);
      this._drawMountains(ctx);

      // ground
      const grC = def(w.ground, ['#7ed06a', '#56b256', '#2f8f43']);
      const g = ctx.createLinearGradient(0, this.horizonY, 0, H);
      g.addColorStop(0, grC[0]); g.addColorStop(0.5, grC[1]); g.addColorStop(1, grC[2]);
      ctx.fillStyle = g; ctx.fillRect(0, this.horizonY, W, H - this.horizonY);
      if (this._tex.ground) this._cover(ctx, this._tex.ground, 0, this.horizonY, W, H - this.horizonY);

      ctx.fillStyle = def(w.hill, '#69c25f');
      for (let i = -1; i < 4; i++) {
        const hx = i * W * 0.42 + (W * 0.1);
        ctx.beginPath();
        ctx.moveTo(hx - W * 0.26, this.horizonY + 2);
        ctx.quadraticCurveTo(hx, this.horizonY - H * 0.06, hx + W * 0.26, this.horizonY + 2);
        ctx.fill();
      }

      this._drawTrees(ctx);
      this._drawPath(ctx);
    }

    _drawClouds(ctx) {
      const W = this.W;
      const puff = (cx, cy, s, a) => {
        ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
        ctx.beginPath();
        ctx.arc(cx, cy, s, 0, 7); ctx.arc(cx + s * 0.9, cy + s * 0.1, s * 0.8, 0, 7);
        ctx.arc(cx - s * 0.9, cy + s * 0.12, s * 0.72, 0, 7); ctx.arc(cx + s * 0.3, cy - s * 0.5, s * 0.65, 0, 7);
        ctx.fill();
      };
      puff(W * 0.18, this.horizonY * 0.32, this.H * 0.045, 0.95);
      puff(W * 0.46, this.horizonY * 0.22, this.H * 0.035, 0.9);
      puff(W * 0.62, this.horizonY * 0.5, this.H * 0.03, 0.85);
      puff(W * 0.9, this.horizonY * 0.28, this.H * 0.04, 0.9);
    }

    _drawMountains(ctx) {
      const w = W_(), W = this.W, H = this.H, hy = this.horizonY, peaks = 6;
      ctx.fillStyle = def(w.mountainFar, '#9fb8da');
      ctx.beginPath(); ctx.moveTo(0, hy);
      for (let i = 0; i <= peaks; i++) {
        const px = (i / peaks) * W;
        const ph = hy - H * (0.10 + 0.10 * Math.abs(Math.sin(i * 1.7)));
        ctx.lineTo(px - W / peaks / 2, hy); ctx.lineTo(px, ph);
      }
      ctx.lineTo(W, hy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = def(w.mountainSnow, '#ffffff');
      ctx.globalAlpha = 0.92;
      for (let i = 0; i <= peaks; i++) {
        const px = (i / peaks) * W;
        const ph = hy - H * (0.10 + 0.10 * Math.abs(Math.sin(i * 1.7)));
        ctx.beginPath();
        ctx.moveTo(px, ph); ctx.lineTo(px - W * 0.022, ph + H * 0.03);
        ctx.lineTo(px + W * 0.005, ph + H * 0.022); ctx.lineTo(px + W * 0.024, ph + H * 0.032);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = def(w.mountainNear, '#4f9e5a');
      ctx.beginPath(); ctx.moveTo(0, hy + 2);
      for (let i = 0; i <= 5; i++) {
        const px = (i / 5) * W + W * 0.08;
        ctx.lineTo(px - W * 0.1, hy + 2);
        ctx.lineTo(px, hy - H * (0.05 + 0.05 * Math.abs(Math.cos(i * 2.1))));
      }
      ctx.lineTo(W, hy + 2); ctx.closePath(); ctx.fill();
    }

    _tree(ctx, x, baseY, s, glow) {
      const w = W_();
      ctx.fillStyle = def(w.treeTrunk, '#7a5230');
      ctx.fillRect(x - s * 0.08, baseY - s * 0.55, s * 0.16, s * 0.55);
      const greens = def(w.treeCanopy, ['#2f8f48', '#3aa657', '#56c46a']);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = greens[i % greens.length];
        ctx.beginPath();
        ctx.arc(x, baseY - s * (0.62 + i * 0.18), s * (0.42 - i * 0.07), 0, 7);
        ctx.arc(x - s * 0.28, baseY - s * (0.55 + i * 0.16), s * (0.3 - i * 0.05), 0, 7);
        ctx.arc(x + s * 0.28, baseY - s * (0.55 + i * 0.16), s * (0.3 - i * 0.05), 0, 7);
        ctx.fill();
      }
      if (glow) {
        const cols = def(w.blossom, ['#ff9ed1', '#ffe27a', '#bfe0ff']);
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = cols[i % cols.length];
          const a = i * 1.5;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * s * 0.35, baseY - s * (0.7 + (i % 3) * 0.1) + Math.sin(a) * s * 0.2, s * 0.05, 0, 7);
          ctx.fill();
        }
      }
    }

    _drawTrees(ctx) {
      const W = this.W, baseY = this.groundY, w = W_();
      this._tree(ctx, W * 0.08, baseY, this.H * 0.42, true);
      this._tree(ctx, W * 0.2, baseY - this.H * 0.04, this.H * 0.3, true);
      this._tree(ctx, W * 0.92, baseY, this.H * 0.42, true);
      this._tree(ctx, W * 0.8, baseY - this.H * 0.04, this.H * 0.3, true);
      ctx.fillStyle = def(w.treeCanopy, ['#2f8f48', '#3aa657'])[1] || '#3aa657';
      for (const bx of [W * 0.15, W * 0.27, W * 0.73, W * 0.86]) {
        ctx.beginPath(); ctx.arc(bx, baseY, this.H * 0.05, 0, 7); ctx.arc(bx + this.H * 0.04, baseY, this.H * 0.04, 0, 7); ctx.fill();
      }
    }

    _roundedTrap(ctx, nL, nR, fL, fR) {
      ctx.beginPath();
      ctx.moveTo(fL.x, fL.y); ctx.lineTo(fR.x, fR.y);
      ctx.lineTo(nR.x, nR.y); ctx.lineTo(nL.x, nL.y);
      ctx.closePath();
    }

    // tube cross-section at depth z: floor centre + circular ring above it
    _ringAt(z) {
      const f = this.project(z, 0, 0);
      const l = this.project(z, -LANE_EDGE, 0);
      const r = this.project(z, LANE_EDGE, 0);
      const half = (r.x - l.x) / 2;
      const ry = half * 0.95;
      return { cx: f.x, floorY: f.y, rx: half, ry, cy: f.y - ry, scale: f.scale };
    }

    // The player runs INSIDE a translucent "liquid glass" tunnel; the outside
    // world (already drawn behind) shows through the glass.
    _drawPath(ctx) {
      const w = W_();
      const tnl = w.tunnel || {};
      const nL = this.roadNearL, nR = this.roadNearR, fL = this.roadFarL, fR = this.roadFarR;

      // ground just outside the tunnel (skip in image mode so backdrop shows)
      if (!this.imageBg) {
        ctx.save(); ctx.fillStyle = def(w.pathBorder, '#3f9a46');
        const eL = this.project(PLAYER_Z, -LANE_EDGE - 0.22, 0), eFL = this.project(VIEW, -LANE_EDGE - 0.22, 0);
        const eR = this.project(PLAYER_Z, LANE_EDGE + 0.22, 0), eFR = this.project(VIEW, LANE_EDGE + 0.22, 0);
        this._roundedTrap(ctx, eL, eR, eFL, eFR); ctx.fill(); ctx.restore();
      }

      // ---- translucent GLASS BODY (see the outside through it) ----
      const near = this._ringAt(PLAYER_Z);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(near.cx, near.cy, near.rx * 1.04, near.ry, 0, 0, 7);
      ctx.clip();
      const top = near.cy - near.ry;
      const body = ctx.createLinearGradient(0, top, 0, near.floorY);
      body.addColorStop(0, def(tnl.glassTop, 'rgba(120,210,255,0.20)'));
      body.addColorStop(0.62, def(tnl.glass, 'rgba(150,225,255,0.12)'));
      body.addColorStop(1, 'rgba(150,225,255,0.0)');
      ctx.fillStyle = body;
      ctx.fillRect(0, top, this.W, near.floorY - top + 6);
      ctx.restore();

      // ---- FLOOR (running surface) ----
      const pathC = def(w.path, ['#cda978', '#dcbe8c', '#e9d2a4']);
      const path = ctx.createLinearGradient(0, this.horizonY, 0, this.H);
      path.addColorStop(0, pathC[0]); path.addColorStop(0.55, pathC[1]); path.addColorStop(1, pathC[2]);
      ctx.fillStyle = path;
      this._roundedTrap(ctx, nL, nR, fL, fR); ctx.fill();
      if (this._tex.road) {
        ctx.save(); this._roundedTrap(ctx, nL, nR, fL, fR); ctx.clip();
        ctx.globalAlpha = 0.9;
        this._cover(ctx, this._tex.road, Math.min(fL.x, nL.x), fL.y, Math.max(nR.x, fR.x) - Math.min(fL.x, nL.x), this.groundY - fL.y);
        ctx.restore();
      }

      // ---- TUBE RIBS (glass rings receding to the vanishing point) ----
      ctx.save(); ctx.lineCap = 'round';
      const rib = def(tnl.rib, 'rgba(190,245,255,0.55)');
      for (let z = VIEW - 3; z > PLAYER_Z; z -= 3.2) {
        const g = this._ringAt(z);
        ctx.globalAlpha = Math.min(0.8, g.scale * 1.5);
        ctx.strokeStyle = rib; ctx.lineWidth = Math.max(1, g.scale * 2.6);
        ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.restore();

      // ---- lane lines on the floor ----
      ctx.save(); ctx.strokeStyle = def(w.laneLine, 'rgba(120,90,50,0.35)');
      ctx.lineWidth = 1.6; ctx.setLineDash([10, 12]);
      for (const ln of [-0.5, 0.5]) {
        const a = this.project(PLAYER_Z, ln, 0), b = this.project(VIEW, ln, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();

      // ---- glowing wall-base rim along the floor edges ----
      ctx.save(); ctx.strokeStyle = def(tnl.rim, '#9fe9ff');
      ctx.shadowColor = def(tnl.rim, '#9fe9ff'); ctx.shadowBlur = 10; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(nL.x, nL.y); ctx.lineTo(fL.x, fL.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nR.x, nR.y); ctx.lineTo(fR.x, fR.y); ctx.stroke();
      ctx.restore();

      this._rail = { nL, nR, fL, fR };
    }

    // animated "liquid glass": light pulses flowing along the tube + soft shine
    _drawLiquid(ctx) {
      const tnl = W_().tunnel || {};
      const gloss = def(tnl.gloss, 'rgba(255,255,255,0.6)');
      const near = this._ringAt(PLAYER_Z);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(near.cx, near.cy, near.rx * 1.04, near.ry, 0, 0, 7);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 2; i++) {
        const t = (this.time * 0.18 + i * 0.5) % 1;       // 0..1 loop
        const z = PLAYER_Z + (VIEW - PLAYER_Z) * (1 - t); // far -> near
        const g = this._ringAt(z);
        ctx.globalAlpha = 0.13 * (0.35 + 0.65 * Math.sin(t * Math.PI));
        ctx.strokeStyle = gloss; ctx.lineWidth = Math.max(1.5, g.scale * 4);
        ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, 7); ctx.stroke();
      }
      // soft vertical shine drifting across the glass
      const sh = (Math.sin(this.time * 0.7) * 0.5 + 0.5);
      ctx.globalAlpha = 0.06 + 0.05 * sh;
      const gx = near.cx + (sh - 0.5) * near.rx * 1.4;
      const gg = ctx.createLinearGradient(gx - near.rx * 0.18, 0, gx + near.rx * 0.18, 0);
      gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.5, gloss); gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg; ctx.fillRect(gx - near.rx * 0.2, near.cy - near.ry, near.rx * 0.4, near.ry * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ---------- ANIMATED POOLS ----------
    _seed() {
      this.fliers.length = 0; this.pollen.length = 0; this.motes.length = 0;
      const W = this.W, H = this.H, rnd = (a, b) => a + Math.random() * (b - a);
      const birdN = Math.max(5, Math.round(W / 150));
      for (let i = 0; i < birdN; i++) {
        this.fliers.push({ kind: 'bird', x: Math.random() * W, y: rnd(H * 0.05, this.horizonY * 0.6),
          vx: rnd(14, 30) * (Math.random() < 0.5 ? -1 : 1), size: rnd(7, 13), amp: rnd(2, 5), bob: rnd(0.8, 1.5), phase: Math.random() * 6.28 });
      }
      const cols = def(W_().blossom, ['#ff9ed1', '#ffe27a', '#bfe0ff', '#ff7fb0', '#a8f0a0']);
      for (let i = 0; i < 8; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        this.fliers.push({ kind: 'fly', side, x: Math.random() * W,
          y: rnd(this.horizonY + H * 0.05, this.horizonY + (this.groundY - this.horizonY) * 0.55),
          vx: rnd(18, 34) * (Math.random() < 0.5 ? -1 : 1), size: rnd(7, 12), amp: rnd(6, 12), bob: rnd(2, 3.4), phase: Math.random() * 6.28,
          color: cols[(Math.random() * cols.length) | 0] });
      }
      const pollenN = Math.max(18, Math.round(W / 22));
      for (let i = 0; i < pollenN; i++) this.pollen.push({ x: Math.random() * W, y: Math.random() * H, r: rnd(1.2, 3.2), sp: rnd(4, 16), seed: Math.random() * 6.28 });
      const moteN = Math.max(16, Math.round(W / 30));
      for (let i = 0; i < moteN; i++) this.motes.push({ x: Math.random() * W, y: rnd(this.horizonY, H), r: rnd(0.8, 2.2), vx: rnd(-5, 5), vy: rnd(-4, 4), seed: Math.random() * 6.28 });
    }

    update(dt) {
      if (!this._built) return;
      if (dt > 0.05) dt = 0.05;
      this.time += dt;
      const W = this.W, H = this.H, margin = 18;
      for (const f of this.fliers) {
        f.x += f.vx * dt;
        f.wy = f.y + Math.sin(this.time * f.bob + f.phase) * f.amp;
        if (f.kind === 'bird') {
          if (f.x < -f.size * 2) f.x = W + f.size; else if (f.x > W + f.size * 2) f.x = -f.size;
        } else {
          const edge = this._roadEdgeX(f.wy, f.side);
          if (f.side < 0) { const max = (edge == null ? W : edge) - margin; if (f.x > max) f.x = -f.size; else if (f.x < -f.size * 2) f.x = max; }
          else { const min = (edge == null ? 0 : edge) + margin; if (f.x < min) f.x = W + f.size; else if (f.x > W + f.size * 2) f.x = min; }
        }
      }
      for (const p of this.pollen) {
        p.y -= p.sp * dt * 0.4; p.x += (Math.sin(this.time * 0.5 + p.seed) * 8) * dt;
        if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
      }
      for (const m of this.motes) {
        m.x += (m.vx + Math.sin(this.time * 0.5 + m.seed) * 4) * dt;
        m.y += (m.vy + Math.cos(this.time * 0.4 + m.seed) * 4) * dt;
        if (m.x < -6) m.x = W + 6; else if (m.x > W + 6) m.x = -6;
        if (m.y < this.horizonY - 10) m.y = H + 6; else if (m.y > H + 6) m.y = this.horizonY;
      }
    }

    // ---------- DRAW ----------
    draw(ctx) {
      if (!this._built) return;
      if (this.imageBg) ctx.clearRect(0, 0, this.W, this.H); // let the GIF/image show behind
      ctx.drawImage(this.staticCanvas, 0, 0, this.W, this.H);
      this._drawFliers(ctx);
      this._drawLiquid(ctx);     // flowing liquid-glass highlights on the tunnel
      this._drawSunDapples(ctx); // light on the floor
      this._drawPollen(ctx);
      this._drawFireflies(ctx);
      this._drawSparkle(ctx);
      if (!this.imageBg) this._drawVignette(ctx);
    }

    _drawFliers(ctx) {
      const birdCol = def(W_().bird, 'rgba(40,55,80,0.8)');
      ctx.save();
      for (const f of this.fliers) {
        const dir = f.vx < 0 ? -1 : 1, s = f.size;
        ctx.save(); ctx.translate(f.x, f.wy); ctx.scale(dir, 1);
        if (f.kind === 'bird') {
          const flap = Math.sin(this.time * 8 + f.phase) * s * 0.3;
          ctx.strokeStyle = birdCol; ctx.lineWidth = Math.max(1.4, s * 0.18); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(-s, flap); ctx.quadraticCurveTo(-s * 0.3, -s * 0.3, 0, 0); ctx.quadraticCurveTo(s * 0.3, -s * 0.3, s, flap); ctx.stroke();
        } else {
          const flap = 0.5 + 0.5 * Math.abs(Math.sin(this.time * 9 + f.phase));
          ctx.fillStyle = f.color; ctx.globalAlpha = 0.92;
          for (const sgn of [-1, 1]) {
            ctx.save(); ctx.scale(sgn, 1);
            ctx.beginPath(); ctx.ellipse(s * 0.5 * flap + s * 0.2, -s * 0.25, s * 0.45 * flap, s * 0.4, 0, 0, 7); ctx.fill();
            ctx.beginPath(); ctx.ellipse(s * 0.45 * flap + s * 0.2, s * 0.3, s * 0.35 * flap, s * 0.3, 0, 0, 7); ctx.fill();
            ctx.restore();
          }
          ctx.globalAlpha = 1; ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-s * 0.05, -s * 0.45, s * 0.1, s * 0.9);
        }
        ctx.restore();
      }
      ctx.restore();
    }

    _drawSunDapples(ctx) {
      const nL = this.roadNearL, nR = this.roadNearR, fL = this.roadFarL, fR = this.roadFarR;
      ctx.save(); this._roundedTrap(ctx, nL, nR, fL, fR); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const ph = this.time * 0.4 + i * 1.7;
        const yy = this.horizonY + ((Math.sin(ph) * 0.5 + 0.5) * (this.groundY - this.horizonY));
        const a = 0.04 + 0.04 * (0.5 + 0.5 * Math.sin(ph * 1.3));
        const ww = (this.W * 0.4) * ((yy - this.horizonY) / (this.groundY - this.horizonY) + 0.2);
        const grd = ctx.createLinearGradient(this.centerX - ww, yy, this.centerX + ww, yy);
        grd.addColorStop(0, 'rgba(255,245,200,0)'); grd.addColorStop(0.5, 'rgba(255,248,210,' + a.toFixed(3) + ')'); grd.addColorStop(1, 'rgba(255,245,200,0)');
        ctx.fillStyle = grd; ctx.fillRect(0, yy - 9, this.W, 18);
      }
      ctx.restore();
    }

    _drawPollen(ctx) {
      ctx.save(); ctx.fillStyle = def(W_().pollen, 'rgba(255,250,210,0.7)');
      for (const p of this.pollen) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
      ctx.restore();
    }

    _drawFireflies(ctx) {
      const col = def(W_().firefly, 'rgba(220,255,160,1)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const m of this.motes) {
        ctx.globalAlpha = 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 2 + m.seed));
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fill();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }

    _drawSparkle(ctx) {
      if (!this._rail) return;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 1.4), r = this._rail;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.06 + 0.08 * pulse;
      ctx.strokeStyle = '#fff7c8'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(r.nL.x, r.nL.y); ctx.lineTo(r.fL.x, r.fL.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r.nR.x, r.nR.y); ctx.lineTo(r.fR.x, r.fR.y); ctx.stroke();
      ctx.restore();
    }

    _drawVignette(ctx) {
      const vg = ctx.createRadialGradient(this.W / 2, this.H * 0.5, Math.min(this.W, this.H) * 0.42, this.W / 2, this.H * 0.5, Math.max(this.W, this.H) * 0.75);
      vg.addColorStop(0, 'transparent'); vg.addColorStop(1, 'rgba(20,40,20,0.28)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  window.BlobbieDashUnderwaterBackground = BlobbieDashUnderwaterBackground;
  window.BlobbieDashWorldBackground = BlobbieDashUnderwaterBackground;
  window.createUnderwaterTunnelBackground = function () { return new BlobbieDashUnderwaterBackground(); };
})();
