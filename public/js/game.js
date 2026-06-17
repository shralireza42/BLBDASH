/* Blobbie Dash - pseudo-3D, 3-lane endless runner engine (Subway-Surfers / Temple-Run style).
 *
 * Controls: Left/Right (A/D or arrows or swipe) to switch lanes, Up/W/Space/swipe-up
 * to jump, Down/S/swipe-down to slide. The course is generated deterministically
 * from a seed (see shared.js) so both PvP players race the exact same track.
 */
(function () {
  'use strict';
  const S = (typeof BlobbieShared !== 'undefined') ? BlobbieShared : require('./shared.js');

  // perspective / projection tunables
  const FOCAL = 10;
  const VIEW = 72;          // how far ahead we render (world units)
  const PLAYER_Z = 0.6;
  const COLLIDE_BACK = -1.2; // entity considered "passed" the player here

  // physics
  const GRAVITY = 28;
  const JUMP_V = 11;
  const SLIDE_TIME = 0.55;
  const LANE_SPEED = 9;     // lanes per second of horizontal travel

  // collision clearances (world height units)
  const JUMP_CLEAR = 1.15;

  class BlobbieGame {
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.seed = S.normalizeSeed(opts.seed != null ? opts.seed : S.makeRandomSeed());
      this.onUpdate = opts.onUpdate || function () {};
      this.onGameOver = opts.onGameOver || function () {};
      this.showGhost = !!opts.ghost;

      this.opponent = null; // {score, distance, alive, name}
      this._raf = null;
      this._bound = {};
      this._boundTouch = {};
      this.running = false;
      this.paused = false;
      this.reset();
      this._fitCanvas();
      this._resizeHandler = () => this._fitCanvas();
      window.addEventListener('resize', this._resizeHandler);
    }

    reset() {
      this.traveled = 0;
      this.lane = 1;          // current visual lane position (float)
      this.targetLane = 1;    // committed lane (int) used for collision
      this.air = 0;
      this.vy = 0;
      this.sliding = false;
      this.slideTimer = 0;
      this.coins = 0;
      this.score = 0;
      this.time = 0;
      this.alive = true;
      this.entities = [];
      this.nextChunk = 0;
      this.particles = [];
      this.startedAt = 0;
      this.magnet = 0;
    }

    _fitCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(320, rect.width || this.canvas.clientWidth || 480);
      const h = Math.max(360, rect.height || this.canvas.clientHeight || 640);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.horizonY = h * 0.34;
      this.groundY = h * 0.97;
      this.centerX = w / 2;
      this.spread = w * 0.27;
    }

    // ---- input ----
    bindInput() {
      const kd = (e) => {
        if (!this.running || this.paused || !this.alive) return;
        const k = e.key.toLowerCase();
        if (k === 'arrowleft' || k === 'a') { this.action('left'); e.preventDefault(); }
        else if (k === 'arrowright' || k === 'd') { this.action('right'); e.preventDefault(); }
        else if (k === 'arrowup' || k === 'w' || k === ' ') { this.action('jump'); e.preventDefault(); }
        else if (k === 'arrowdown' || k === 's') { this.action('slide'); e.preventDefault(); }
      };
      this._bound.kd = kd;
      window.addEventListener('keydown', kd);

      let sx = 0, sy = 0, st = 0, swiped = false;
      const ts = (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); swiped = false; };
      const tm = (e) => {
        if (swiped || !this.running || this.paused || !this.alive) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 36 || Math.abs(dy) > 36) {
          swiped = true;
          if (Math.abs(dx) > Math.abs(dy)) this.action(dx > 0 ? 'right' : 'left');
          else this.action(dy > 0 ? 'slide' : 'jump');
        }
        e.preventDefault();
      };
      const te = (e) => {
        if (!swiped && Date.now() - st < 250) this.action('jump'); // tap = jump
      };
      this._boundTouch = { ts, tm, te };
      this.canvas.addEventListener('touchstart', ts, { passive: true });
      this.canvas.addEventListener('touchmove', tm, { passive: false });
      this.canvas.addEventListener('touchend', te, { passive: true });
    }

    unbindInput() {
      if (this._bound.kd) window.removeEventListener('keydown', this._bound.kd);
      if (this._boundTouch.ts) {
        this.canvas.removeEventListener('touchstart', this._boundTouch.ts);
        this.canvas.removeEventListener('touchmove', this._boundTouch.tm);
        this.canvas.removeEventListener('touchend', this._boundTouch.te);
      }
    }

    action(a) {
      if (!this.alive || this.paused || !this.running) return;
      if (a === 'left') { this.targetLane = Math.max(0, this.targetLane - 1); }
      else if (a === 'right') { this.targetLane = Math.min(2, this.targetLane + 1); }
      else if (a === 'jump') {
        if (this.air <= 0.001 && !this.sliding) { this.vy = JUMP_V; }
      } else if (a === 'slide') {
        if (this.air <= 0.001 && !this.sliding) { this.sliding = true; this.slideTimer = SLIDE_TIME; }
        else if (this.air > 0.001) { this.vy = -JUMP_V * 0.9; } // fast-drop
      }
    }

    setOpponent(o) { this.opponent = o; }

    // ---- lifecycle ----
    start() {
      if (this.running) return;
      this.running = true;
      this.paused = false;
      this.bindInput();
      this._last = performance.now();
      this.startedAt = Date.now();
      const loop = (now) => {
        if (!this.running) return;
        let dt = (now - this._last) / 1000;
        this._last = now;
        if (dt > 0.05) dt = 0.05; // clamp after tab switch
        if (!this.paused) this._step(dt);
        this._render();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    setPaused(p) { this.paused = p; if (!p) this._last = performance.now(); }

    stop() {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this.unbindInput();
    }

    destroy() {
      this.stop();
      window.removeEventListener('resize', this._resizeHandler);
    }

    // ---- simulation ----
    _ensureChunks() {
      const need = this.traveled + VIEW + S.CHUNK_LEN;
      while (this.nextChunk * S.CHUNK_LEN < need) {
        const chunk = S.getChunk(this.seed, this.nextChunk);
        for (const e of chunk) { e.resolved = false; this.entities.push(e); }
        this.nextChunk++;
      }
      // drop entities far behind
      if (this.entities.length > 200) {
        this.entities = this.entities.filter((e) => e.dist - this.traveled > COLLIDE_BACK - 4);
      }
    }

    _step(dt) {
      if (!this.alive) return;
      this.time += dt;
      const speed = S.speedAt(this.traveled);
      this.traveled += speed * dt;

      // lane interpolation
      const diff = this.targetLane - this.lane;
      const move = LANE_SPEED * dt;
      if (Math.abs(diff) <= move) this.lane = this.targetLane;
      else this.lane += Math.sign(diff) * move;

      // vertical physics
      if (this.air > 0.001 || this.vy !== 0) {
        this.vy -= GRAVITY * dt;
        this.air += this.vy * dt;
        if (this.air <= 0) { this.air = 0; this.vy = 0; }
      }
      if (this.sliding) {
        this.slideTimer -= dt;
        if (this.slideTimer <= 0) this.sliding = false;
      }

      this._ensureChunks();
      this._collisions();

      // particles
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 240 * dt; }
      this.particles = this.particles.filter((p) => p.life > 0);

      this.score = Math.floor(this.traveled) + this.coins * S.COIN_VALUE;
      this.onUpdate({ score: this.score, distance: Math.floor(this.traveled), coins: this.coins, speed });
    }

    _collisions() {
      const pLane = this.targetLane;
      for (const e of this.entities) {
        if (e.resolved) continue;
        const z = e.dist - this.traveled;
        if (z > 1.4) continue;          // not reached yet
        if (z < COLLIDE_BACK) { e.resolved = true; continue; }

        if (e.type === 'coin') {
          if (Math.abs(z) < 1.3 && e.lane === pLane) {
            const reach = e.h > 0 ? Math.abs(this.air - e.h) < 1.3 : this.air < 1.6;
            if (reach) { e.resolved = true; this._collectCoin(e); }
          }
          continue;
        }

        // obstacles: resolve at the player plane
        if (z <= 0.4) {
          e.resolved = true;
          if (e.lane !== pLane) continue;
          let hit = false;
          if (e.type === 'jump') hit = this.air < JUMP_CLEAR;
          else if (e.type === 'slide') hit = !this.sliding;
          else if (e.type === 'block') hit = true;
          if (hit) this._die();
        }
      }
    }

    _collectCoin(e) {
      this.coins++;
      const p = this._project(0.6, S.LANE_OFFSETS[e.lane], e.h);
      for (let i = 0; i < 6; i++) {
        this.particles.push({
          x: p.x, y: p.y,
          vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 160,
          life: 0.5, color: '#ffd23f', r: 2 + Math.random() * 2,
        });
      }
    }

    _die() {
      if (!this.alive) return;
      this.alive = false;
      const p = this._project(PLAYER_Z, S.LANE_OFFSETS[this.targetLane], this.air);
      for (let i = 0; i < 18; i++) {
        this.particles.push({
          x: p.x, y: p.y - 20,
          vx: (Math.random() - 0.5) * 320, vy: -Math.random() * 280,
          life: 0.9, color: i % 2 ? '#ef7a8b' : '#ffffff', r: 3 + Math.random() * 3,
        });
      }
      const result = { score: this.score, distance: Math.floor(this.traveled), coins: this.coins };
      // brief delay so the death burst is visible
      setTimeout(() => this.onGameOver(result), 650);
    }

    // ---- projection ----
    _project(z, laneWorld, worldH) {
      const persp = FOCAL / (FOCAL + Math.max(z, -FOCAL + 0.1));
      const pmin = FOCAL / (FOCAL + VIEW);
      const n = (persp - pmin) / (1 - pmin);
      const x = this.centerX + laneWorld * persp * this.spread;
      const baseY = this.horizonY + (this.groundY - this.horizonY) * n;
      const y = baseY - (worldH || 0) * persp * (this.H * 0.07);
      return { x, y, scale: persp };
    }

    // ---- rendering ----
    _render() {
      const ctx = this.ctx, W = this.W, H = this.H;
      this._drawBackground(ctx, W, H);
      this._drawRoad(ctx, W, H);

      // entities sorted far -> near for painter's algorithm
      const visible = this.entities
        .filter((e) => { const z = e.dist - this.traveled; return z > COLLIDE_BACK && z < VIEW; })
        .sort((a, b) => (b.dist - a.dist));
      for (const e of visible) {
        if (e.resolved && e.type === 'coin') continue;
        const z = e.dist - this.traveled;
        if (e.type === 'coin') this._drawCoin(ctx, e, z);
        else this._drawObstacle(ctx, e, z);
      }

      // opponent ghost (a marker on the far track showing relative progress)
      if (this.showGhost && this.opponent) this._drawGhost(ctx);

      this._drawPlayer(ctx);
      this._drawParticles(ctx);
    }

    _drawBackground(ctx, W, H) {
      const sky = ctx.createLinearGradient(0, 0, 0, this.horizonY + 40);
      sky.addColorStop(0, '#6a5cff');
      sky.addColorStop(0.55, '#9b6bff');
      sky.addColorStop(1, '#ffb3c8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, this.horizonY + 40);

      // sun
      ctx.fillStyle = 'rgba(255,233,150,0.95)';
      ctx.beginPath(); ctx.arc(W * 0.74, this.horizonY * 0.55, Math.min(W, H) * 0.09, 0, 7); ctx.fill();

      // parallax hills
      const off = (this.traveled * 6) % (W * 0.6);
      ctx.fillStyle = 'rgba(123,90,200,0.55)';
      for (let i = -1; i < 4; i++) {
        const bx = i * (W * 0.6) - off;
        ctx.beginPath();
        ctx.moveTo(bx, this.horizonY);
        ctx.quadraticCurveTo(bx + W * 0.3, this.horizonY - H * 0.16, bx + W * 0.6, this.horizonY);
        ctx.fill();
      }
      // ground fill below horizon
      const g = ctx.createLinearGradient(0, this.horizonY, 0, H);
      g.addColorStop(0, '#5a3fae');
      g.addColorStop(1, '#3a2570');
      ctx.fillStyle = g;
      ctx.fillRect(0, this.horizonY, W, H - this.horizonY);
    }

    _drawRoad(ctx, W, H) {
      // road surface trapezoid (lanes -1.5 .. 1.5)
      const nearL = this._project(PLAYER_Z, -1.55, 0);
      const nearR = this._project(PLAYER_Z, 1.55, 0);
      const farL = this._project(VIEW, -1.55, 0);
      const farR = this._project(VIEW, 1.55, 0);
      const road = ctx.createLinearGradient(0, this.horizonY, 0, H);
      road.addColorStop(0, '#3b2d6b');
      road.addColorStop(1, '#52407f');
      ctx.fillStyle = road;
      ctx.beginPath();
      ctx.moveTo(farL.x, farL.y); ctx.lineTo(farR.x, farR.y);
      ctx.lineTo(nearR.x, nearR.y); ctx.lineTo(nearL.x, nearL.y);
      ctx.closePath(); ctx.fill();

      // lane divider lines
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (const b of [-0.5, 0.5]) {
        const a = this._project(PLAYER_Z, b, 0);
        const c = this._project(VIEW, b, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      }
      // edge rails
      ctx.strokeStyle = 'rgba(255,210,63,0.9)';
      ctx.lineWidth = 3;
      for (const b of [-1.55, 1.55]) {
        const a = this._project(PLAYER_Z, b, 0);
        const c = this._project(VIEW, b, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      }
      // moving dashes down the centre for speed feedback
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      const dashStart = this.traveled % 4;
      for (let z = VIEW - dashStart; z > PLAYER_Z; z -= 4) {
        const a = this._project(z, 0, 0);
        const c = this._project(Math.max(PLAYER_Z, z - 1.6), 0, 0);
        ctx.lineWidth = Math.max(1, a.scale * 5);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      }
    }

    _drawObstacle(ctx, e, z) {
      const p = this._project(z, S.LANE_OFFSETS[e.lane], 0);
      const s = p.scale;
      const w = 78 * s;
      if (e.type === 'jump') {
        const h = 42 * s;
        ctx.fillStyle = '#ff5d73';
        ctx.strokeStyle = '#1d1d28'; ctx.lineWidth = Math.max(1, 2 * s);
        this._roundRect(ctx, p.x - w / 2, p.y - h, w, h, 6 * s, true, true);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(p.x - w / 2, p.y - h, w, h * 0.3);
      } else if (e.type === 'slide') {
        const barH = 26 * s;
        const top = p.y - 150 * s;
        ctx.fillStyle = '#3ad0ff';
        ctx.strokeStyle = '#1d1d28'; ctx.lineWidth = Math.max(1, 2 * s);
        this._roundRect(ctx, p.x - w / 2, top, w, barH, 6 * s, true, true);
        // posts
        ctx.fillStyle = '#bfe9ff';
        ctx.fillRect(p.x - w / 2, top, 6 * s, 150 * s);
        ctx.fillRect(p.x + w / 2 - 6 * s, top, 6 * s, 150 * s);
      } else { // block / wall
        const h = 120 * s;
        ctx.fillStyle = '#7b4dff';
        ctx.strokeStyle = '#1d1d28'; ctx.lineWidth = Math.max(1, 2 * s);
        this._roundRect(ctx, p.x - w / 2, p.y - h, w, h, 8 * s, true, true);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(p.x - w / 2, p.y - h, w, h * 0.25);
      }
    }

    _drawCoin(ctx, e, z) {
      const p = this._project(z, S.LANE_OFFSETS[e.lane], e.h);
      const r = 13 * p.scale;
      const t = this.time * 6 + e.id;
      const sx = Math.abs(Math.cos(t)) * 0.7 + 0.3; // spin
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sx, 1);
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
      g.addColorStop(0, '#fff2b0');
      g.addColorStop(0.6, '#ffd23f');
      g.addColorStop(1, '#e0a500');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#a6760a'; ctx.lineWidth = Math.max(1, 2 * p.scale);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#a6760a';
      ctx.font = 'bold ' + Math.max(8, 15 * p.scale) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('B', 0, 1);
      ctx.restore();
    }

    _drawPlayer(ctx) {
      // laneWorld goes -1 (left) .. 1 (right); this.lane is 0..2.
      const p = this._project(PLAYER_Z, this.lane - 1, this.air);
      const size = this.H * 0.18;
      let state = 'run';
      if (this.air > 0.02) state = 'jump';
      else if (this.sliding) state = 'slide';
      window.Blobbie.draw(ctx, p.x, p.y, size, { state, time: this.time, alpha: this.alive ? 1 : 0.4 });
    }

    _drawGhost(ctx) {
      // Show opponent as a translucent Blobbie positioned ahead/behind based on
      // relative distance, plus a label.
      const o = this.opponent;
      if (o.distance == null) return;
      const rel = o.distance - this.traveled; // +ve = opponent ahead
      const z = Math.max(PLAYER_Z + 1.5, Math.min(VIEW - 6, PLAYER_Z + 6 - rel * 0.04));
      const p = this._project(z, S.LANE_OFFSETS[0] + 1, 0); // centre lane far
      const size = this.H * 0.16 * p.scale * 2.2;
      window.Blobbie.draw(ctx, p.x, p.y, size, {
        state: o.alive === false ? 'slide' : 'run', time: this.time,
        alpha: 0.55, tint: '#39d98a',
      });
      ctx.fillStyle = 'rgba(57,217,138,0.95)';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((o.name || 'Rival') + (o.alive === false ? ' (out)' : ''), p.x, p.y - size - 4);
    }

    _drawParticles(ctx) {
      for (const p of this.particles) {
        ctx.globalAlpha = Math.max(0, p.life * 1.6);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _roundRect(ctx, x, y, w, h, r, fill, stroke) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }
  }

  window.BlobbieGame = BlobbieGame;
})();
