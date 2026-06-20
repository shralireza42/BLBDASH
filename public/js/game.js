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
      this.animator = (window.Character && window.Character.Animator) ? new window.Character.Animator() : null;
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
      // Trigger the matching one-shot animation for the key that was pressed.
      if (this.animator) this.animator.play(a === 'jump' ? 'jump' : a === 'slide' ? 'slide' : a);
      const S2 = window.Sound;
      if (a === 'left') { if (this.targetLane > 0 && S2) S2.lane(); this.targetLane = Math.max(0, this.targetLane - 1); }
      else if (a === 'right') { if (this.targetLane < 2 && S2) S2.lane(); this.targetLane = Math.min(2, this.targetLane + 1); }
      else if (a === 'jump') {
        if (this.air <= 0.001 && !this.sliding) { this.vy = JUMP_V; if (S2) S2.jump(); }
      } else if (a === 'slide') {
        if (this.air <= 0.001 && !this.sliding) { this.sliding = true; this.slideTimer = SLIDE_TIME; if (S2) S2.slide(); }
        else if (this.air > 0.001) { this.vy = -JUMP_V * 0.9; } // fast-drop
      }
    }

    setOpponent(o) {
      if (!o) return;
      this._oppTarget = o;
      if (!this.opponent) { this.opponent = Object.assign({}, o); return; }
      // discrete fields update immediately; lane/air/distance are smoothed in _step
      this.opponent.name = o.name;
      this.opponent.alive = o.alive;
      this.opponent.score = o.score;
      this.opponent.coins = o.coins;
      this.opponent.frame = o.frame;
      this.opponent.sliding = o.sliding;
    }

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
      if (this.animator) this.animator.update(dt);
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

      // smooth the opponent ghost toward its latest networked state
      if (this._oppTarget && this.opponent) {
        const tg = this._oppTarget, o = this.opponent, k = Math.min(1, dt * 10);
        const tl = tg.lane == null ? 1 : tg.lane, ol = o.lane == null ? 1 : o.lane;
        o.lane = ol + (tl - ol) * k;
        o.air = (o.air || 0) + (((tg.air || 0) - (o.air || 0)) * k);
        const td = tg.distance || 0, od = o.distance == null ? td : o.distance;
        o.distance = od + (td - od) * k;
      }

      this.score = Math.floor(this.traveled) + this.coins * S.COIN_VALUE;
      this.onUpdate({
        score: this.score, distance: Math.floor(this.traveled), coins: this.coins, speed,
        lane: this.lane, air: this.air, sliding: this.sliding,
        frame: this.animator ? this.animator.currentFrame() : null,
      });
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
      if (window.Sound) window.Sound.coin();
      const p = this._project(0.6, S.LANE_OFFSETS[e.lane], e.h);
      for (let i = 0; i < 8; i++) {
        this.particles.push({
          x: p.x, y: p.y,
          vx: (Math.random() - 0.5) * 130, vy: -Math.random() * 170,
          life: 0.5, color: i % 2 ? '#16f2d6' : '#ffe27a', r: 2 + Math.random() * 2.5, glow: true,
        });
      }
    }

    _die() {
      if (!this.alive) return;
      this.alive = false;
      if (window.Sound) window.Sound.crash();
      const p = this._project(PLAYER_Z, S.LANE_OFFSETS[this.targetLane], this.air);
      for (let i = 0; i < 22; i++) {
        this.particles.push({
          x: p.x, y: p.y - 20,
          vx: (Math.random() - 0.5) * 340, vy: -Math.random() * 300,
          life: 0.9, color: i % 2 ? '#ff4fd8' : '#16f2d6', r: 3 + Math.random() * 3, glow: true,
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
      this._drawOverlay(ctx, W, H);
    }

    _drawBackground(ctx, W, H) {
      // deep neon ocean water
      const sky = ctx.createLinearGradient(0, 0, 0, this.horizonY + 40);
      sky.addColorStop(0, '#03021a');
      sky.addColorStop(0.5, '#0a0a44');
      sky.addColorStop(1, '#13105e');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, this.horizonY + 40);

      // bioluminescent glow orb (neon "sun")
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
        const rx = (i / 4) * W + Math.sin(this.time * 0.2 + i) * 24 + W * 0.1;
        const grd = ctx.createLinearGradient(rx, 0, rx + 70, this.horizonY);
        grd.addColorStop(0, 'rgba(80,230,255,0.10)');
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(rx, 0); ctx.lineTo(rx + 60, 0); ctx.lineTo(rx + 170, this.horizonY); ctx.lineTo(rx - 90, this.horizonY);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // parallax neon reef silhouette on the horizon
      const off = (this.traveled * 8) % (W * 0.5);
      ctx.save();
      ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(60,20,90,0.85)';
      for (let i = -1; i < 5; i++) {
        const bx = i * (W * 0.5) - off;
        ctx.beginPath();
        ctx.moveTo(bx, this.horizonY);
        ctx.lineTo(bx + W * 0.08, this.horizonY - H * 0.1);
        ctx.lineTo(bx + W * 0.16, this.horizonY - H * 0.04);
        ctx.lineTo(bx + W * 0.26, this.horizonY - H * 0.16);
        ctx.lineTo(bx + W * 0.36, this.horizonY - H * 0.05);
        ctx.lineTo(bx + W * 0.5, this.horizonY);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // seabed water below horizon
      const g = ctx.createLinearGradient(0, this.horizonY, 0, H);
      g.addColorStop(0, '#0a0838');
      g.addColorStop(1, '#1a0b4a');
      ctx.fillStyle = g;
      ctx.fillRect(0, this.horizonY, W, H - this.horizonY);

      // ambient rising bubbles (deterministic from time)
      ctx.save();
      ctx.strokeStyle = 'rgba(120,240,255,0.45)';
      ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 6; ctx.lineWidth = 1.3;
      for (let i = 0; i < 16; i++) {
        const seed = i * 53.13;
        const bx = (Math.sin(seed) * 0.5 + 0.5) * W + Math.sin(this.time + i) * 8;
        const by = H - ((this.time * (18 + (i % 5) * 8) + seed * 30) % (H * 0.9));
        const br = 2 + (i % 4);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }

    _drawRoad(ctx, W, H) {
      const nearL = this._project(PLAYER_Z, -1.55, 0);
      const nearR = this._project(PLAYER_Z, 1.55, 0);
      const farL = this._project(VIEW, -1.55, 0);
      const farR = this._project(VIEW, 1.55, 0);
      // dark glassy seabed lane
      const road = ctx.createLinearGradient(0, this.horizonY, 0, H);
      road.addColorStop(0, '#0b0730');
      road.addColorStop(1, '#241158');
      ctx.fillStyle = road;
      ctx.beginPath();
      ctx.moveTo(farL.x, farL.y); ctx.lineTo(farR.x, farR.y);
      ctx.lineTo(nearR.x, nearR.y); ctx.lineTo(nearL.x, nearL.y);
      ctx.closePath(); ctx.fill();

      ctx.save();
      // scrolling neon cross-lines (synthwave grid) within the lane
      ctx.strokeStyle = 'rgba(22,242,214,0.5)';
      ctx.shadowColor = '#16f2d6'; ctx.shadowBlur = 8; ctx.lineWidth = 1.5;
      const dashStart = this.traveled % 3;
      for (let z = VIEW - dashStart; z > PLAYER_Z; z -= 3) {
        const a = this._project(z, -1.55, 0);
        const b = this._project(z, 1.55, 0);
        ctx.globalAlpha = Math.min(1, a.scale * 1.6);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // glowing lane dividers (cyan)
      ctx.strokeStyle = 'rgba(80,255,240,0.85)';
      ctx.shadowColor = '#16f2d6'; ctx.shadowBlur = 12; ctx.lineWidth = 2;
      for (const ln of [-0.5, 0.5]) {
        const a = this._project(PLAYER_Z, ln, 0);
        const c = this._project(VIEW, ln, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      }
      // glowing edge rails (magenta)
      ctx.strokeStyle = 'rgba(255,79,216,0.95)';
      ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 16; ctx.lineWidth = 3;
      for (const ln of [-1.55, 1.55]) {
        const a = this._project(PLAYER_Z, ln, 0);
        const c = this._project(VIEW, ln, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      }
      ctx.restore();
    }

    // pick a deterministic sea-creature variant per obstacle
    _seaKind(e) {
      if (e.type === 'jump') return e.id % 2 ? 'puffer' : 'clam';
      if (e.type === 'slide') return e.id % 2 ? 'jelly' : 'kelp';
      return e.id % 2 ? 'coral' : 'rock';
    }

    _neon(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }

    _drawObstacle(ctx, e, z) {
      const p = this._project(z, S.LANE_OFFSETS[e.lane], 0);
      const s = p.scale;
      const kind = this._seaKind(e);
      const x = p.x, y = p.y;
      ctx.save();
      ctx.lineWidth = Math.max(1, 2 * s);

      if (kind === 'puffer') {            // jump over: spiky pufferfish on the seabed
        const r = 30 * s;
        this._neon(ctx, '#ffb030', 18);
        ctx.fillStyle = '#ff8c1a'; ctx.strokeStyle = '#fff0c0';
        // spikes
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y - r + Math.sin(a) * r);
          ctx.lineTo(x + Math.cos(a) * r * 1.4, y - r + Math.sin(a) * r * 1.4); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(x, y - r, r, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; this._neon(ctx, '#fff', 0);
        ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 1.1, r * 0.18, 0, 7); ctx.arc(x + r * 0.35, y - r * 1.1, r * 0.18, 0, 7); ctx.fill();
      } else if (kind === 'clam') {       // jump over: glowing clam shell
        const w = 70 * s, h = 40 * s;
        this._neon(ctx, '#ff6fae', 16);
        ctx.fillStyle = '#ff8fc6'; ctx.strokeStyle = '#ffd9ec';
        ctx.beginPath(); ctx.moveTo(x - w / 2, y);
        ctx.quadraticCurveTo(x, y - h * 2, x + w / 2, y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + i * w * 0.2, y - h * 1.3); ctx.stroke(); }
        this._neon(ctx, '#16f2d6', 14); ctx.fillStyle = '#bff9ff';
        ctx.beginPath(); ctx.arc(x, y - h * 0.4, 6 * s, 0, 7); ctx.fill(); // pearl
      } else if (kind === 'jelly') {      // slide under: hanging jellyfish
        const top = y - 168 * s, w = 70 * s, domeH = 40 * s;
        this._neon(ctx, '#ff4fd8', 18);
        ctx.fillStyle = 'rgba(255,120,230,0.85)'; ctx.strokeStyle = '#ffd0f4';
        ctx.beginPath(); ctx.ellipse(x, top + domeH, w / 2, domeH, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath(); ctx.moveTo(x + i * w * 0.12, top + domeH);
          for (let k = 0; k < 4; k++) {
            const ty = top + domeH + (k + 1) * 20 * s;
            ctx.quadraticCurveTo(x + i * w * 0.12 + Math.sin(this.time * 4 + k + i) * 6 * s, ty - 10 * s, x + i * w * 0.12 + Math.sin(this.time * 4 + k + i) * 6 * s, ty);
          }
          ctx.stroke();
        }
      } else if (kind === 'kelp') {       // slide under: overhead glowing kelp arch
        const top = y - 170 * s, w = 78 * s;
        this._neon(ctx, '#39ff9e', 16);
        ctx.strokeStyle = '#7dffc4'; ctx.lineWidth = Math.max(2, 5 * s);
        for (const sx of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(x + sx * w / 2, y);
          ctx.quadraticCurveTo(x + sx * w * 0.7, top + 40 * s, x, top);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(57,255,158,0.5)';
        ctx.beginPath(); ctx.ellipse(x, top, w * 0.5, 14 * s, 0, 0, 7); ctx.fill();
      } else if (kind === 'coral') {      // dodge: tall neon coral pillar
        const h = 130 * s, w = 60 * s;
        this._neon(ctx, '#b14dff', 18);
        ctx.fillStyle = '#8a3dff'; ctx.strokeStyle = '#e0c0ff';
        this._roundRect(ctx, x - w / 2, y - h, w, h, 14 * s, true, true);
        ctx.strokeStyle = '#ff7de0'; ctx.lineWidth = Math.max(1, 2 * s);
        for (let i = 0; i < 4; i++) { const yy = y - h * (0.2 + i * 0.2); ctx.beginPath(); ctx.moveTo(x - w / 2, yy); ctx.lineTo(x - w, yy - 10 * s); ctx.moveTo(x + w / 2, yy); ctx.lineTo(x + w, yy - 10 * s); ctx.stroke(); }
      } else {                            // rock: dodge, jagged glowing boulder
        const h = 120 * s, w = 78 * s;
        this._neon(ctx, '#3affd8', 16);
        ctx.fillStyle = '#1c2b5a'; ctx.strokeStyle = '#3affd8';
        ctx.beginPath();
        ctx.moveTo(x - w / 2, y);
        ctx.lineTo(x - w * 0.4, y - h * 0.75);
        ctx.lineTo(x - w * 0.05, y - h);
        ctx.lineTo(x + w * 0.35, y - h * 0.7);
        ctx.lineTo(x + w / 2, y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    _drawCoin(ctx, e, z) {
      const p = this._project(z, S.LANE_OFFSETS[e.lane], e.h);
      const r = 13 * p.scale;
      const t = this.time * 6 + e.id;
      const sx = Math.abs(Math.cos(t)) * 0.7 + 0.3; // spin
      ctx.save();
      ctx.translate(p.x, p.y);
      // neon glow halo
      this._neon(ctx, '#16f2d6', 16);
      ctx.scale(sx, 1);
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
      g.addColorStop(0, '#eafff9');
      g.addColorStop(0.55, '#ffe27a');
      g.addColorStop(1, '#15c2b0');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#16f2d6'; ctx.lineWidth = Math.max(1, 2 * p.scale);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a6b5e';
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
      // Exact animation frame from the controller (falls back to state-based art).
      const frame = this.animator ? this.animator.currentFrame() : null;
      window.Blobbie.draw(ctx, p.x, p.y, size, { frame, state, time: this.time, alpha: this.alive ? 1 : 0.4 });
    }

    _drawGhost(ctx) {
      // Live rival on the SAME track: positioned by their relative distance, in
      // their actual lane, with their real jump height & animation frame.
      const o = this.opponent;
      if (!o || o.distance == null) return;
      const dead = o.alive === false;
      const rel = o.distance - this.traveled;     // +ve = rival is ahead of me
      const zg = Math.max(PLAYER_Z + 0.4, Math.min(VIEW - 3, PLAYER_Z + rel));
      const laneWorld = (o.lane == null ? 1 : o.lane) - 1;
      const air = dead ? 0 : (o.air || 0);
      const p = this._project(zg, laneWorld, air);
      const playerScale = FOCAL / (FOCAL + PLAYER_Z);
      const size = this.H * 0.18 * (p.scale / playerScale);
      const frame = o.frame || (window.Character && window.Character.frameAtTime
        ? window.Character.frameAtTime('run', this.time) : null);

      window.Blobbie.draw(ctx, p.x, p.y, size, {
        frame, state: dead ? 'slide' : 'run', time: this.time,
        alpha: dead ? 0.35 : 0.72, tint: '#39ff9e',
      });

      const gap = Math.round(rel);
      let label = o.name || 'Rival';
      if (dead) label += ' • OUT';
      else if (gap > 1) label += ' • ' + gap + 'm ahead';
      else if (gap < -1) label += ' • ' + (-gap) + 'm behind';
      ctx.save();
      ctx.fillStyle = 'rgba(57,255,158,0.95)';
      ctx.font = 'bold ' + Math.max(10, 13 * p.scale) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#39ff9e'; ctx.shadowBlur = 8;
      ctx.fillText(label, p.x, p.y - size - 6);
      ctx.restore();
    }

    _drawParticles(ctx) {
      ctx.save();
      for (const p of this.particles) {
        ctx.globalAlpha = Math.max(0, p.life * 1.6);
        ctx.fillStyle = p.color;
        if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 10; } else ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    _drawOverlay(ctx, W, H) {
      // neon vignette to frame the scene
      const vg = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.32, W / 2, H * 0.55, Math.max(W, H) * 0.72);
      vg.addColorStop(0, 'transparent');
      vg.addColorStop(1, 'rgba(2,0,14,0.55)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
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
