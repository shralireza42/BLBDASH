/*
 * Blobbie Dash - ONE shared underwater-tunnel background.
 *
 * The SAME instance/renderer is used for the main menu (#bgfx) and for the
 * gameplay scene, so the background is identical in both and never switches.
 *
 * Composition (visual lock — do not change between menu & game):
 *   underwater blue gradient · bioluminescent glow · god rays ·
 *   coral reefs (left & right, outside the road) · glass tunnel road with
 *   neon cyan tunnel rings · magenta neon side strips · faint lane dividers ·
 *   empty glossy centre road · 16:9 cartoon style · fixed camera / vanishing point.
 *
 * The static scene is rendered ONCE to an offscreen canvas. Per frame we only
 * update + draw the cheap animated layers (pooled fish, pooled bubbles, road
 * caustics, neon shimmer). No Graphics objects are allocated per frame.
 *
 * Projection matches game.js exactly so gameplay entities sit on this road.
 */
(function () {
  'use strict';

  const FOCAL = 10;
  const VIEW = 72;
  const PLAYER_Z = 0.6;
  const LANE_EDGE = 1.55; // road half-width in lane units

  class BlobbieDashUnderwaterBackground {
    constructor() {
      this.W = 0; this.H = 0; this.dpr = 1;
      this.staticCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      this.sctx = this.staticCanvas ? this.staticCanvas.getContext('2d') : null;
      this.fish = [];
      this.bubbles = [];
      this.time = 0;
      this._built = false;
    }

    // ---- projection (identical to game.js) ----
    project(z, laneWorld, worldH) {
      const persp = FOCAL / (FOCAL + Math.max(z, -FOCAL + 0.1));
      const pmin = FOCAL / (FOCAL + VIEW);
      const n = (persp - pmin) / (1 - pmin);
      const x = this.centerX + laneWorld * persp * this.spread;
      const y = this.horizonY + (this.groundY - this.horizonY) * n - (worldH || 0) * persp * (this.H * 0.07);
      return { x, y, scale: persp };
    }

    // road edge x at a given screen y (null when above the road / horizon)
    _roadEdgeX(y, side) {
      const far = side < 0 ? this.roadFarL : this.roadFarR;
      const near = side < 0 ? this.roadNearL : this.roadNearR;
      if (y <= far.y) return null;
      const t = Math.min(1, Math.max(0, (y - far.y) / (near.y - far.y)));
      return far.x + (near.x - far.x) * t;
    }

    setSize(W, H, dpr) {
      dpr = dpr || 1;
      if (this._built && this.W === W && this.H === H && this.dpr === dpr) return;
      this.W = W; this.H = H; this.dpr = dpr;
      this.horizonY = H * 0.34;
      this.groundY = H * 0.97;
      this.centerX = W / 2;
      this.spread = W * 0.27;
      this.roadNearL = this.project(PLAYER_Z, -LANE_EDGE, 0);
      this.roadFarL = this.project(VIEW, -LANE_EDGE, 0);
      this.roadNearR = this.project(PLAYER_Z, LANE_EDGE, 0);
      this.roadFarR = this.project(VIEW, LANE_EDGE, 0);
      this._buildStatic();
      this._seed();
      this._built = true;
    }

    // ---------- STATIC SCENE (rendered once) ----------
    _buildStatic() {
      const W = this.W, H = this.H, c = this.staticCanvas, ctx = this.sctx;
      c.width = Math.round(W * this.dpr);
      c.height = Math.round(H * this.dpr);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // water gradient (top) + seabed (below horizon)
      const sky = ctx.createLinearGradient(0, 0, 0, this.horizonY + 40);
      sky.addColorStop(0, '#03021a');
      sky.addColorStop(0.5, '#0a0a44');
      sky.addColorStop(1, '#13105e');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, this.horizonY + 40);

      // bioluminescent glow orb
      const ox = W * 0.74, oy = this.horizonY * 0.5, orad = Math.min(W, H) * 0.13;
      const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, orad);
      og.addColorStop(0, 'rgba(120,255,240,0.9)');
      og.addColorStop(0.4, 'rgba(60,200,255,0.45)');
      og.addColorStop(1, 'transparent');
      ctx.fillStyle = og;
      ctx.beginPath(); ctx.arc(ox, oy, orad, 0, 7); ctx.fill();

      // god rays
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const rx = (i / 4) * W + W * 0.1;
        const grd = ctx.createLinearGradient(rx, 0, rx + 70, this.horizonY);
        grd.addColorStop(0, 'rgba(80,230,255,0.08)');
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(rx, 0); ctx.lineTo(rx + 60, 0); ctx.lineTo(rx + 170, this.horizonY); ctx.lineTo(rx - 90, this.horizonY);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // seabed water below horizon
      const g = ctx.createLinearGradient(0, this.horizonY, 0, H);
      g.addColorStop(0, '#0a0838');
      g.addColorStop(1, '#1a0b4a');
      ctx.fillStyle = g;
      ctx.fillRect(0, this.horizonY, W, H - this.horizonY);

      this._drawCoral(ctx);
      this._drawRoad(ctx);
    }

    _drawCoral(ctx) {
      // neon coral reefs on the far left & right, OUTSIDE the road (never centre)
      const H = this.H, W = this.W;
      const baseY = this.groundY;
      const clusters = [
        { x: W * 0.06, s: H * 0.16, c: '#ff4fd8' },
        { x: W * 0.15, s: H * 0.11, c: '#7b5cff' },
        { x: W * 0.94, s: H * 0.16, c: '#16f2d6' },
        { x: W * 0.85, s: H * 0.11, c: '#39ff9e' },
      ];
      for (const cl of clusters) {
        ctx.save();
        ctx.shadowColor = cl.c; ctx.shadowBlur = 14;
        ctx.strokeStyle = cl.c; ctx.lineWidth = Math.max(3, cl.s * 0.06);
        ctx.lineCap = 'round';
        for (let b = -2; b <= 2; b++) {
          const bx = cl.x + b * cl.s * 0.16;
          ctx.beginPath();
          ctx.moveTo(bx, baseY);
          ctx.quadraticCurveTo(bx + b * cl.s * 0.18, baseY - cl.s * 0.6, bx + b * cl.s * 0.05, baseY - cl.s);
          ctx.stroke();
          // little nubs
          ctx.beginPath(); ctx.arc(bx + b * cl.s * 0.05, baseY - cl.s, cl.s * 0.06, 0, 7); ctx.stroke();
        }
        ctx.restore();
      }
    }

    _roundedTrap(ctx, nL, nR, fL, fR) {
      ctx.beginPath();
      ctx.moveTo(fL.x, fL.y); ctx.lineTo(fR.x, fR.y);
      ctx.lineTo(nR.x, nR.y); ctx.lineTo(nL.x, nL.y);
      ctx.closePath();
    }

    _drawRoad(ctx) {
      const nL = this.roadNearL, nR = this.roadNearR, fL = this.roadFarL, fR = this.roadFarR;

      // glossy glass road surface
      const road = ctx.createLinearGradient(0, this.horizonY, 0, this.H);
      road.addColorStop(0, '#0b0730');
      road.addColorStop(0.6, '#1a1150');
      road.addColorStop(1, '#241863');
      ctx.fillStyle = road;
      this._roundedTrap(ctx, nL, nR, fL, fR);
      ctx.fill();

      // glass sheen down the centre
      const sheen = ctx.createLinearGradient(0, this.horizonY, 0, this.groundY);
      sheen.addColorStop(0, 'rgba(120,240,255,0.0)');
      sheen.addColorStop(1, 'rgba(120,240,255,0.06)');
      ctx.save();
      this._roundedTrap(ctx, nL, nR, fL, fR); ctx.clip();
      ctx.fillStyle = sheen; ctx.fillRect(0, this.horizonY, this.W, this.H - this.horizonY);
      ctx.restore();

      // tunnel rings (neon cyan arches over the road, smaller toward the vanishing point)
      ctx.save();
      ctx.strokeStyle = 'rgba(80,255,240,0.5)';
      ctx.shadowColor = '#16f2d6'; ctx.shadowBlur = 10;
      for (let z = VIEW - 4; z > PLAYER_Z; z -= 7) {
        const l = this.project(z, -LANE_EDGE, 0);
        const r = this.project(z, LANE_EDGE, 0);
        const cx = (l.x + r.x) / 2;
        const rx = (r.x - l.x) / 2;
        const ry = rx * 0.92;
        ctx.globalAlpha = Math.min(0.7, l.scale * 1.4);
        ctx.lineWidth = Math.max(1, l.scale * 3);
        ctx.beginPath();
        // arch over the road (top half + small side returns)
        ctx.ellipse(cx, l.y, rx, ry, 0, Math.PI * 0.08, Math.PI - Math.PI * 0.08, true);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // lane dividers — clearer readability (3 lanes), with a soft cyan glow
      ctx.save();
      ctx.strokeStyle = 'rgba(120,255,245,0.35)';
      ctx.shadowColor = '#16f2d6'; ctx.shadowBlur = 6; ctx.lineWidth = 1.8;
      for (const ln of [-0.5, 0.5]) {
        const a = this.project(PLAYER_Z, ln, 0), b = this.project(VIEW, ln, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();

      // neon side strips (magenta edge rails) — emissive double-stroke (glow + core)
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,79,216,0.55)';
      ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 22; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(nL.x, nL.y); ctx.lineTo(fL.x, fL.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nR.x, nR.y); ctx.lineTo(fR.x, fR.y); ctx.stroke();
      ctx.strokeStyle = '#ffd6f4'; ctx.shadowBlur = 8; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(nL.x, nL.y); ctx.lineTo(fL.x, fL.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nR.x, nR.y); ctx.lineTo(fR.x, fR.y); ctx.stroke();
      ctx.restore();
      // store the rail screen-line for shimmer reuse
      this._rail = { nL, nR, fL, fR };
    }

    // ---------- ANIMATED POOLS ----------
    _seed() {
      this.fish.length = 0;
      this.bubbles.length = 0;
      const W = this.W, H = this.H, rnd = (a, b) => a + Math.random() * (b - a);
      const palette = ['#16f2d6', '#7dfff0', '#ff8fe0', '#7b9cff', '#39ff9e'];

      // FAR fish: open water above the horizon — swim full width, very slow
      const farN = Math.max(7, Math.round(W / 95));
      for (let i = 0; i < farN; i++) {
        this.fish.push({
          kind: 'far', x: Math.random() * W, y: rnd(H * 0.08, this.horizonY * 0.92),
          vx: rnd(6, 16) * (Math.random() < 0.5 ? -1 : 1),
          size: rnd(9, 16), amp: rnd(3, 8), bob: rnd(0.5, 1.1), phase: Math.random() * 6.28,
          color: palette[(Math.random() * palette.length) | 0], alpha: rnd(0.28, 0.5),
        });
      }
      // SIDE fish: below horizon, in the water columns beside the road — slightly faster
      const sideN = 10;
      for (let i = 0; i < sideN; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        this.fish.push({
          kind: 'side', side,
          x: Math.random() * W, y: rnd(this.horizonY + H * 0.06, this.horizonY + (this.groundY - this.horizonY) * 0.5),
          vx: rnd(20, 40) * (Math.random() < 0.5 ? -1 : 1),
          size: rnd(13, 24), amp: rnd(3, 6), bob: rnd(0.6, 1.2), phase: Math.random() * 6.28,
          color: palette[(Math.random() * palette.length) | 0], alpha: rnd(0.45, 0.7),
        });
      }
      // bubbles rising everywhere (foreground)
      const bubN = Math.max(20, Math.round(W / 16));
      for (let i = 0; i < bubN; i++) {
        this.bubbles.push({ x: Math.random() * W, y: Math.random() * H, r: rnd(1.5, 6), sp: rnd(12, 42), seed: Math.random() * 6.28 });
      }
      // drifting plankton motes (depth / "alive" ambience)
      this.motes = this.motes || [];
      this.motes.length = 0;
      const moteN = Math.max(18, Math.round(W / 26));
      for (let i = 0; i < moteN; i++) {
        this.motes.push({ x: Math.random() * W, y: Math.random() * H, r: rnd(0.6, 2.2), vx: rnd(-6, 6), vy: rnd(-4, 4), seed: Math.random() * 6.28 });
      }
    }

    update(dt) {
      if (!this._built) return;
      if (dt > 0.05) dt = 0.05;
      this.time += dt;
      const W = this.W, H = this.H, margin = 18;
      for (const f of this.fish) {
        f.x += f.vx * dt;
        f.wy = f.y + Math.sin(this.time * f.bob + f.phase) * f.amp;
        if (f.kind === 'far') {
          if (f.x < -f.size * 2) f.x = W + f.size;
          else if (f.x > W + f.size * 2) f.x = -f.size;
        } else {
          // keep strictly in the side water column, never over the road
          const edge = this._roadEdgeX(f.wy, f.side);
          if (f.side < 0) {
            const max = (edge == null ? W : edge) - margin;
            if (f.x > max) f.x = -f.size;          // wrap to the left edge
            else if (f.x < -f.size * 2) f.x = max;
          } else {
            const min = (edge == null ? 0 : edge) + margin;
            if (f.x < min) f.x = W + f.size;        // wrap to the right edge
            else if (f.x > W + f.size * 2) f.x = min;
          }
        }
      }
      for (const b of this.bubbles) {
        b.y -= b.sp * dt;
        b.x += Math.sin(this.time * 0.6 + b.seed) * 0.25;
        if (b.y < -8) { b.y = this.H + 8; b.x = Math.random() * W; }
      }
      if (this.motes) for (const m of this.motes) {
        m.x += (m.vx + Math.sin(this.time * 0.4 + m.seed) * 3) * dt;
        m.y += (m.vy + Math.cos(this.time * 0.3 + m.seed) * 3) * dt;
        if (m.x < -6) m.x = W + 6; else if (m.x > W + 6) m.x = -6;
        if (m.y < -6) m.y = H + 6; else if (m.y > H + 6) m.y = -6;
      }
    }

    // ---------- DRAW (per frame) ----------
    draw(ctx) {
      if (!this._built) return;
      ctx.drawImage(this.staticCanvas, 0, 0, this.W, this.H);
      this._drawMotes(ctx);
      this._drawFish(ctx);
      this._drawGloss(ctx);
      this._drawCaustics(ctx);
      this._drawBubbles(ctx);
      this._drawShimmer(ctx);
      this._drawVignette(ctx);
    }

    _drawMotes(ctx) {
      if (!this.motes) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const m of this.motes) {
        const a = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(this.time * 1.5 + m.seed));
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(150,245,255,1)';
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    _drawGloss(ctx) {
      // premium glass: a soft specular highlight sweeping down the road
      const nL = this.roadNearL, nR = this.roadNearR, fL = this.roadFarL, fR = this.roadFarR;
      ctx.save();
      this._roundedTrap(ctx, nL, nR, fL, fR); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const sweep = (this.time * 0.12) % 1.4 - 0.2;     // 0..1.2 loop
      const yy = this.horizonY + (this.groundY - this.horizonY) * sweep;
      const grd = ctx.createLinearGradient(0, yy - this.H * 0.12, 0, yy + this.H * 0.12);
      grd.addColorStop(0, 'rgba(120,240,255,0)');
      grd.addColorStop(0.5, 'rgba(150,250,255,0.07)');
      grd.addColorStop(1, 'rgba(120,240,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, yy - this.H * 0.12, this.W, this.H * 0.24);
      ctx.restore();
    }

    _drawVignette(ctx) {
      const vg = ctx.createRadialGradient(this.W / 2, this.H * 0.55, Math.min(this.W, this.H) * 0.32, this.W / 2, this.H * 0.55, Math.max(this.W, this.H) * 0.72);
      vg.addColorStop(0, 'transparent');
      vg.addColorStop(1, 'rgba(2,0,14,0.5)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    _drawFish(ctx) {
      ctx.save();
      for (const f of this.fish) {
        const dir = f.vx < 0 ? -1 : 1;
        const s = f.size;
        ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color;
        ctx.save();
        ctx.translate(f.x, f.wy);
        ctx.scale(dir, 1);
        // body
        ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, 7); ctx.fill();
        // tail
        ctx.beginPath(); ctx.moveTo(-s * 0.8, 0); ctx.lineTo(-s * 1.5, -s * 0.5); ctx.lineTo(-s * 1.5, s * 0.5); ctx.closePath(); ctx.fill();
        // eye
        ctx.globalAlpha = f.alpha * 0.9; ctx.fillStyle = '#04122a';
        ctx.beginPath(); ctx.arc(s * 0.55, -s * 0.1, s * 0.12, 0, 7); ctx.fill();
        ctx.restore();
        ctx.fillStyle = f.color;
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    _drawCaustics(ctx) {
      // subtle moving light ripples on the glass road (clipped to the road)
      const nL = this.roadNearL, nR = this.roadNearR, fL = this.roadFarL, fR = this.roadFarR;
      ctx.save();
      this._roundedTrap(ctx, nL, nR, fL, fR); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const bands = 4;
      for (let i = 0; i < bands; i++) {
        const phase = this.time * 0.5 + i * 1.7;
        const yy = this.horizonY + ((Math.sin(phase) * 0.5 + 0.5) * (this.groundY - this.horizonY));
        const a = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(phase * 1.3));
        const w = (this.W * 0.5) * ((yy - this.horizonY) / (this.groundY - this.horizonY) + 0.2);
        const grd = ctx.createLinearGradient(this.centerX - w, yy, this.centerX + w, yy);
        grd.addColorStop(0, 'rgba(80,240,255,0)');
        grd.addColorStop(0.5, 'rgba(120,250,255,' + a.toFixed(3) + ')');
        grd.addColorStop(1, 'rgba(80,240,255,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, yy - 10, this.W, 20);
      }
      ctx.restore();
    }

    _drawBubbles(ctx) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,240,255,0.45)';
      ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 5; ctx.lineWidth = 1.3;
      for (const b of this.bubbles) {
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }

    _drawShimmer(ctx) {
      // gentle pulsing glow on the neon cyan/magenta strips (no geometry change)
      if (!this._rail) return;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 1.6);
      const r = this._rail;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.10 + 0.12 * pulse;
      ctx.strokeStyle = '#16f2d6';
      ctx.shadowColor = '#16f2d6'; ctx.shadowBlur = 16; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r.nL.x, r.nL.y); ctx.lineTo(r.fL.x, r.fL.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r.nR.x, r.nR.y); ctx.lineTo(r.fR.x, r.fR.y); ctx.stroke();
      ctx.restore();
    }
  }

  window.BlobbieDashUnderwaterBackground = BlobbieDashUnderwaterBackground;
  window.createUnderwaterTunnelBackground = function () { return new BlobbieDashUnderwaterBackground(); };
})();
