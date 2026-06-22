/* Blobbie Dash - pseudo-3D, 3-lane endless runner engine (Subway-Surfers / Temple-Run style).
 *
 * Controls: Left/Right (A/D or arrows or swipe) to switch lanes, Up/W/Space/swipe-up
 * to jump, Down/S/swipe-down to slide. The course is generated deterministically
 * from a seed (see shared.js) so both PvP players race the exact same track.
 */
(function () {
  'use strict';
  const S = (typeof BlobbieShared !== 'undefined') ? BlobbieShared : require('./shared.js');

  // editable theme colors (public/theme.js), with fallbacks
  const TCOIN = () => (typeof window !== 'undefined' && window.BlobbieTheme && window.BlobbieTheme.coin) || {};
  const TOBS = () => (typeof window !== 'undefined' && window.BlobbieTheme && window.BlobbieTheme.obstacles) || {};
  const TLINE = () => (typeof window !== 'undefined' && window.BlobbieTheme && window.BlobbieTheme.speedLine) || 'rgba(255,250,225,0.32)';
  const D = (v, d) => (v == null ? d : v);

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
      this.frozen = true; // shows the scene during the countdown without advancing gameplay
      // ONE shared underwater-tunnel background (same renderer as the menu)
      this.bg = window.BlobbieDashUnderwaterBackground ? new window.BlobbieDashUnderwaterBackground() : null;
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
      this.pops = [];           // coin pickup pop rings
      this.laneShift = 0;       // lane-switch velocity (for body lean)
      this.landImpact = 0;      // 0..1 landing squash amount
      this.shakeUntil = 0;      // camera shake end time (ms)
      this.stepTimer = 0.3;     // footstep cadence countdown
      this.fenceTouches = 0;    // side-fence bumps (2 = game over)
      this.fenceMsgUntil = 0;   // on-screen fence warning timer (ms)
      this.startedAt = 0;
      this.magnet = 0;
      this.animator = (window.Character && window.Character.Animator) ? new window.Character.Animator() : null;
      this.opponents = {};      // id -> smoothed ghost state
      this._oppTargets = {};    // id -> latest networked state
      this._oppColors = {};     // id -> ghost tint
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
      this.horizonY = h * this._camHorizon(); // matches the shared world background
      this.groundY = h * 0.97;
      this.centerX = w / 2;
      this.spread = w * 0.27;
      if (this.bg) this.bg.setSize(w, h, dpr);
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
      if (a === 'left') {
        if (this.targetLane > 0) { if (S2) S2.lane(); this.targetLane--; }
        else this._fenceBump(); // already at the left edge -> bump the fence
      } else if (a === 'right') {
        if (this.targetLane < 2) { if (S2) S2.lane(); this.targetLane++; }
        else this._fenceBump(); // already at the right edge -> bump the fence
      } else if (a === 'jump') {
        if (this.air <= 0.001 && !this.sliding) { this.vy = JUMP_V; if (S2) S2.jump(); }
      } else if (a === 'slide') {
        if (this.air <= 0.001 && !this.sliding) { this.sliding = true; this.slideTimer = SLIDE_TIME; if (S2) S2.slide(); }
        else if (this.air > 0.001) { this.vy = -JUMP_V * 0.9; } // fast-drop
      }
    }

    // Bumping a side fence: 1st bump warns, 2nd bump ends the run.
    _fenceBump() {
      if (!this.alive) return;
      this.fenceTouches++;
      this.shakeUntil = performance.now() + 320;
      this.fenceMsgUntil = performance.now() + 950;
      if (window.Sound) window.Sound.fence();
      if (this.fenceTouches >= 2) this._die();
    }

    setOpponent(o) {
      if (!o) return;
      const id = o.id == null ? '_' : o.id;
      this._oppTargets[id] = o;
      if (!this._oppColors[id]) {
        const palette = ['#39ff9e', '#ffb84f', '#ff6fae', '#7da8ff'];
        this._oppColors[id] = palette[Object.keys(this._oppColors).length % palette.length];
      }
      const cur = this.opponents[id];
      if (!cur) { this.opponents[id] = Object.assign({ color: this._oppColors[id] }, o); return; }
      // discrete fields update immediately; lane/air/distance are smoothed in _step
      cur.name = o.name; cur.alive = o.alive; cur.score = o.score;
      cur.coins = o.coins; cur.frame = o.frame; cur.sliding = o.sliding;
    }

    // ---- lifecycle ----
    // start() begins the render loop immediately (so the shared background shows
    // during the countdown). Gameplay stays FROZEN until begin() is called.
    start() {
      if (this.running) return;
      this.running = true;
      this.paused = false;
      this.bindInput();
      this._last = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        let dt = (now - this._last) / 1000;
        this._last = now;
        if (dt > 0.05) dt = 0.05; // clamp after tab switch
        if (this.bg) this.bg.update(dt);            // background always animates
        if (!this.paused && !this.frozen) this._step(dt);
        this._render();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    begin() {
      this.frozen = false;
      this.startedAt = Date.now();
      this._last = performance.now();
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

      // lane interpolation — eased (snappy ease-out, no teleport)
      this.laneShift = this.targetLane - this.lane;      // signed, drives body lean
      this.lane += this.laneShift * Math.min(1, dt * 13);
      if (Math.abs(this.targetLane - this.lane) < 0.001) this.lane = this.targetLane;

      // vertical physics (+ landing impact for squash)
      const wasAir = this.air > 0.001;
      if (this.air > 0.001 || this.vy !== 0) {
        this.vy -= GRAVITY * dt;
        this.air += this.vy * dt;
        if (this.air <= 0) {
          this.air = 0; this.vy = 0;
          if (wasAir) this.landImpact = 1; // trigger landing squash
        }
      }
      if (this.landImpact > 0) this.landImpact = Math.max(0, this.landImpact - dt * 5);
      if (this.sliding) {
        this.slideTimer -= dt;
        if (this.slideTimer <= 0) this.sliding = false;
      }

      // footsteps while running on the ground (cadence scales with speed)
      if (this.air <= 0.01 && !this.sliding) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          if (window.Sound) window.Sound.footstep();
          this.stepTimer = Math.max(0.16, Math.min(0.36, 6.5 / speed));
        }
      } else {
        this.stepTimer = Math.min(this.stepTimer, 0.12); // brief pause; resume soon after landing
      }

      this._ensureChunks();
      this._collisions();

      // particles + coin-pop rings
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 240 * dt; }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const r of this.pops) { r.t += dt; }
      this.pops = this.pops.filter((r) => r.t < r.life);

      // smooth every opponent ghost toward its latest networked state
      const k = Math.min(1, dt * 10);
      for (const id in this._oppTargets) {
        const tg = this._oppTargets[id], o = this.opponents[id];
        if (!o) continue;
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
          life: 0.5, color: i % 2 ? '#ffd23f' : '#fff3c0', r: 2 + Math.random() * 2.5, glow: true,
        });
      }
      // pickup pop ring
      this.pops.push({ x: p.x, y: p.y, t: 0, life: 0.35, r0: 8, r1: 30, color: '#ffe27a' });
    }

    _die() {
      if (!this.alive) return;
      this.alive = false;
      this.shakeUntil = performance.now() + 420; // camera shake on impact
      if (window.Sound) window.Sound.crash();
      const p = this._project(PLAYER_Z, S.LANE_OFFSETS[this.targetLane], this.air);
      for (let i = 0; i < 22; i++) {
        this.particles.push({
          x: p.x, y: p.y - 20,
          vx: (Math.random() - 0.5) * 340, vy: -Math.random() * 300,
          life: 0.9, color: i % 2 ? '#ff9ed1' : '#ffe27a', r: 3 + Math.random() * 3, glow: true,
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

    // Camera zoom (editable in public/theme.js -> camera.zoom). 1 = default,
    // higher = closer to Blobbie. Purely visual; gameplay/collisions unchanged.
    _zoom() {
      const z = window.BlobbieTheme && window.BlobbieTheme.camera && window.BlobbieTheme.camera.zoom;
      const v = (typeof z === 'number' && isFinite(z)) ? z : 1.25;
      return Math.max(0.8, Math.min(2.2, v));
    }
    _camHorizon() {
      const v = window.BlobbieTheme && window.BlobbieTheme.camera && window.BlobbieTheme.camera.horizon;
      return Math.max(0.15, Math.min(0.55, (typeof v === 'number' && isFinite(v)) ? v : 0.30));
    }

    // ---- rendering ----
    _render() {
      const ctx = this.ctx, W = this.W, H = this.H;
      const now = performance.now();

      // camera zoom — scale the whole scene around the character's feet so the
      // camera feels closer/lower while Blobbie stays anchored at the bottom.
      const zoom = this._zoom();
      ctx.save();
      if (zoom !== 1) {
        ctx.translate(this.centerX, this.groundY);
        ctx.scale(zoom, zoom);
        ctx.translate(-this.centerX, -this.groundY);
      }

      // ONE shared underwater-tunnel background (identical to the menu)
      if (this.bg) this.bg.draw(ctx);
      this._drawSpeedLines(ctx); // scrolling lane cross-lines for forward-motion feel

      // camera shake jolts the gameplay layer only (keeps bg edges clean)
      let shx = 0, shy = 0;
      if (now < this.shakeUntil) {
        const m = ((this.shakeUntil - now) / 420) * 9;
        shx = (Math.random() - 0.5) * m * 2; shy = (Math.random() - 0.5) * m * 2;
      }
      ctx.save();
      ctx.translate(shx, shy);

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

      // live rivals on the same track (dead ones are removed)
      if (this.showGhost) {
        const ghosts = Object.keys(this.opponents)
          .map((id) => this.opponents[id])
          .filter((o) => o && o.alive !== false && o.distance != null)
          .sort((a, b) => (b.distance || 0) - (a.distance || 0));
        for (const o of ghosts) this._drawGhost(ctx, o);
      }

      this._drawPlayer(ctx);
      this._drawParticles(ctx);
      this._drawPops(ctx);
      ctx.restore(); // shake layer
      ctx.restore(); // camera zoom

      // fence-bump warning (screen-fixed, above the zoom/shake layers)
      if (now < this.fenceMsgUntil && this.alive) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (this.fenceMsgUntil - now) / 400);
        ctx.fillStyle = '#ff5a4d';
        ctx.font = 'bold ' + Math.round(H * 0.052) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
        ctx.fillText('\u26A0 FENCE  ' + this.fenceTouches + ' / 2', W / 2, H * 0.22);
        ctx.restore();
      }
    }

    // depth fog: entities emerge from the underwater haze as they approach
    _fog(z) {
      const t = (VIEW - z) / (VIEW * 0.55);
      return Math.max(0.12, Math.min(1, t));
    }

    _drawPops(ctx) {
      for (const r of this.pops) {
        const k = r.t / r.life;
        const rad = r.r0 + (r.r1 - r.r0) * k;
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = r.color;
        ctx.shadowColor = r.color; ctx.shadowBlur = 12;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 7); ctx.stroke();
        ctx.restore();
      }
    }

    // Scrolling neon cross-lines on the (static) shared road for a forward-motion
    // feel during gameplay. The road/tunnel/strips themselves live in this.bg.
    _drawSpeedLines(ctx) {
      if (this.frozen) return; // path is calm in the menu / during the countdown
      ctx.save();
      ctx.strokeStyle = TLINE();
      ctx.shadowColor = '#fff7d0'; ctx.shadowBlur = 6; ctx.lineWidth = 1.4;
      const dashStart = this.traveled % 3;
      for (let z = VIEW - dashStart; z > PLAYER_Z; z -= 3) {
        const a = this._project(z, -1.55, 0);
        const b = this._project(z, 1.55, 0);
        ctx.globalAlpha = Math.min(0.8, a.scale * 1.4);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // pick a deterministic nature-obstacle variant per obstacle
    _seaKind(e) {
      if (e.type === 'jump') return e.id % 2 ? 'rock' : 'log';      // jump over
      if (e.type === 'slide') return e.id % 2 ? 'branch' : 'arch';  // slide under
      return e.id % 2 ? 'tree' : 'boulder';                          // dodge by lane
    }

    _neon(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }

    // resolve a custom obstacle sprite URL (variant overrides mechanic type)
    _obstacleSprite(e, kind) {
      const sp = (window.BlobbieTheme && window.BlobbieTheme.sprites && window.BlobbieTheme.sprites.obstacles) || {};
      return sp[kind] || sp[e.type] || null;
    }
    // draw a sprite sized/anchored for its mechanic: jump=on ground low,
    // slide=overhead, block=tall on ground.
    _drawTypedSprite(ctx, img, type, x, y, s) {
      let h, bottom;
      if (type === 'jump') { h = 72 * s; bottom = y; }
      else if (type === 'slide') { h = 64 * s; bottom = y - 96 * s; }
      else { h = 150 * s; bottom = y; }
      const ar = (img.naturalWidth / img.naturalHeight) || 1;
      const w = h * ar;
      ctx.drawImage(img, x - w / 2, bottom - h, w, h);
    }

    _drawObstacle(ctx, e, z) {
      const p = this._project(z, S.LANE_OFFSETS[e.lane], 0);
      const s = p.scale;
      const kind = this._seaKind(e);
      const x = p.x, y = p.y;
      const ink = '#3a2a1a';
      const to = TOBS();

      // soft contact shadow on the path (grounds the obstacle)
      ctx.save();
      ctx.globalAlpha = this._fog(z) * 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, y + 3 * s, 44 * s, 12 * s, 0, 0, 7); ctx.fill();
      ctx.restore();

      // custom sprite replaces the drawn obstacle, if configured in theme.js
      const spUrl = this._obstacleSprite(e, kind);
      const spImg = spUrl && window.BlobbieAssets ? window.BlobbieAssets.get(spUrl) : null;
      if (spImg) {
        ctx.save(); ctx.globalAlpha = this._fog(z);
        this._drawTypedSprite(ctx, spImg, e.type, x, y, s);
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.globalAlpha = this._fog(z); // fade in from the distance
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.strokeStyle = ink;

      if (kind === 'rock') {              // jump over: low mossy rock
        const w = 70 * s, h = 38 * s;
        ctx.fillStyle = D(to.rock, '#8d8f97');
        ctx.beginPath();
        ctx.moveTo(x - w / 2, y);
        ctx.lineTo(x - w * 0.32, y - h * 0.85);
        ctx.lineTo(x + w * 0.05, y - h);
        ctx.lineTo(x + w * 0.4, y - h * 0.7);
        ctx.lineTo(x + w / 2, y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = D(to.moss, '#5fb85a'); // moss cap
        ctx.beginPath(); ctx.ellipse(x - w * 0.05, y - h * 0.9, w * 0.34, h * 0.28, 0, 0, 7); ctx.fill();
      } else if (kind === 'log') {        // jump over: fallen log
        const w = 78 * s, h = 30 * s;
        ctx.fillStyle = D(to.log, '#9c6b3f');
        this._roundRect(ctx, x - w / 2, y - h, w, h, h * 0.5, true, true);
        ctx.fillStyle = D(to.logEnd, '#c79a63');
        ctx.beginPath(); ctx.ellipse(x - w / 2 + h * 0.5, y - h * 0.5, h * 0.34, h * 0.42, 0, 0, 7); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = D(to.branch, '#7a5230');
        ctx.beginPath(); ctx.arc(x - w / 2 + h * 0.5, y - h * 0.5, h * 0.18, 0, 7); ctx.stroke();
      } else if (kind === 'branch') {     // slide under: low leafy branch
        const top = y - 162 * s, w = 80 * s;
        ctx.strokeStyle = D(to.branch, '#7a5230'); ctx.lineWidth = Math.max(2, 6 * s);
        ctx.beginPath(); ctx.moveTo(x - w * 0.7, top); ctx.lineTo(x + w * 0.7, top); ctx.stroke();
        ctx.fillStyle = D(to.leaf, '#3aa657');
        for (let i = -3; i <= 3; i++) {
          const lx = x + i * w * 0.2;
          ctx.beginPath(); ctx.ellipse(lx, top + 12 * s, 14 * s, 9 * s, 0.5, 0, 7); ctx.fill();
        }
      } else if (kind === 'arch') {       // slide under: flowering vine arch
        const top = y - 168 * s, w = 84 * s;
        ctx.strokeStyle = D(to.vine, '#2f8f48'); ctx.lineWidth = Math.max(2, 5 * s);
        for (const sx of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(x + sx * w / 2, y);
          ctx.quadraticCurveTo(x + sx * w * 0.7, top + 40 * s, x, top);
          ctx.stroke();
        }
        const cols = (window.BlobbieTheme && window.BlobbieTheme.world && window.BlobbieTheme.world.blossom) || ['#ff9ed1', '#ffe27a', '#bfe0ff'];
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = cols[i % cols.length];
          ctx.beginPath(); ctx.arc(x - w * 0.4 + i * w * 0.16, top + 8 * s + Math.sin(i) * 6 * s, 5 * s, 0, 7); ctx.fill();
        }
      } else if (kind === 'tree') {       // dodge: tall tree
        const h = 140 * s, w = 26 * s;
        ctx.fillStyle = D(to.treeTrunk, '#7a5230');
        ctx.fillRect(x - w / 2, y - h * 0.55, w, h * 0.55);
        const greens = D(to.treeCanopy, ['#2f8f48', '#3aa657', '#56c46a']);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = greens[i % greens.length];
          ctx.beginPath(); ctx.arc(x, y - h * (0.55 + i * 0.16), (46 - i * 8) * s, 0, 7); ctx.fill();
        }
      } else {                            // boulder: dodge, big mossy boulder
        const h = 120 * s, w = 92 * s;
        ctx.fillStyle = D(to.boulder, '#9a9ca3');
        ctx.beginPath();
        ctx.moveTo(x - w / 2, y);
        ctx.lineTo(x - w * 0.42, y - h * 0.7);
        ctx.lineTo(x - w * 0.05, y - h);
        ctx.lineTo(x + w * 0.4, y - h * 0.72);
        ctx.lineTo(x + w / 2, y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = D(to.moss, '#5fb85a');
        ctx.beginPath(); ctx.ellipse(x, y - h * 0.92, w * 0.36, h * 0.16, 0, 0, 7); ctx.fill();
      }
      ctx.restore();
    }

    _drawCoin(ctx, e, z) {
      const p = this._project(z, S.LANE_OFFSETS[e.lane], e.h);
      const r = 13 * p.scale;
      const t = this.time * 6 + e.id;
      const sx = Math.abs(Math.cos(t)) * 0.7 + 0.3; // spin
      const fog = this._fog(z);
      // tiny ground shadow under the floating coin
      if (e.h > 0) {
        const g0 = this._project(z, S.LANE_OFFSETS[e.lane], 0);
        ctx.save(); ctx.globalAlpha = fog * 0.25; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(g0.x, g0.y, 11 * p.scale, 4 * p.scale, 0, 0, 7); ctx.fill(); ctx.restore();
      }
      // custom coin sprite replaces the drawn coin, if configured
      const coinUrl = (window.BlobbieTheme && window.BlobbieTheme.sprites && window.BlobbieTheme.sprites.coin) || null;
      const cimg = coinUrl && window.BlobbieAssets ? window.BlobbieAssets.get(coinUrl) : null;
      if (cimg) {
        const ch = 30 * p.scale, cw = ch * ((cimg.naturalWidth / cimg.naturalHeight) || 1);
        ctx.save();
        ctx.globalAlpha = fog;
        ctx.translate(p.x, p.y);
        ctx.scale(Math.max(0.15, sx), 1); // spin
        ctx.drawImage(cimg, -cw / 2, -ch / 2, cw, ch);
        ctx.restore();
        return;
      }

      const tc = TCOIN();
      ctx.save();
      ctx.globalAlpha = fog;
      ctx.translate(p.x, p.y);
      // warm golden glow halo
      this._neon(ctx, D(tc.glow, '#ffcf4d'), 16);
      ctx.scale(sx, 1);
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
      g.addColorStop(0, D(tc.core, '#fff6cf'));
      g.addColorStop(0.55, D(tc.mid, '#ffd23f'));
      g.addColorStop(1, D(tc.edge, '#e0951f'));
      ctx.fillStyle = g;
      ctx.strokeStyle = D(tc.rim, '#b9731a'); ctx.lineWidth = Math.max(1, 2 * p.scale);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = D(tc.text, '#7a4d10');
      ctx.font = 'bold ' + Math.max(8, 15 * p.scale) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('B', 0, 1);
      ctx.restore();
    }

    _drawPlayer(ctx) {
      if (!this.alive) return; // loser character is removed (only the burst plays)
      // laneWorld goes -1 (left) .. 1 (right); this.lane is 0..2.
      const p = this._project(PLAYER_Z, this.lane - 1, this.air);
      const size = this.H * 0.2;
      let state = 'run';
      if (this.air > 0.02) state = 'jump';
      else if (this.sliding) state = 'slide';
      const frame = this.animator ? this.animator.currentFrame() : null;

      // --- juice: lane lean + jump squash/stretch + run bounce ---
      const lean = Math.max(-0.9, Math.min(0.9, this.laneShift)) * 0.22;
      let sx = 1, sy = 1;
      if (this.air > 0.001 || this.vy !== 0) {
        const v = Math.max(-1, Math.min(1, this.vy / JUMP_V));
        sy = 1 + v * 0.14; sx = 1 - v * 0.10;       // stretch up, pinch in while airborne
      } else if (this.landImpact > 0) {
        sy = 1 - this.landImpact * 0.22; sx = 1 + this.landImpact * 0.18; // squash on landing
      }
      const bob = (state === 'run' && this.air < 0.01)
        ? Math.abs(Math.sin(this.time * 9)) * size * 0.025 : 0;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(lean);
      ctx.scale(sx, sy);
      ctx.translate(-p.x, -p.y);
      window.Blobbie.draw(ctx, p.x, p.y - bob, size, { frame, state, time: this.time, alpha: 1 });
      ctx.restore();
    }

    _drawGhost(ctx, o) {
      // Live rival on the SAME track: positioned by their relative distance, in
      // their actual lane, with their real jump height & animation frame.
      if (!o || o.distance == null) return;
      const rel = o.distance - this.traveled;     // +ve = rival is ahead of me
      const zg = Math.max(PLAYER_Z + 0.4, Math.min(VIEW - 3, PLAYER_Z + rel));
      const laneWorld = (o.lane == null ? 1 : o.lane) - 1;
      const p = this._project(zg, laneWorld, o.air || 0);
      const playerScale = FOCAL / (FOCAL + PLAYER_Z);
      const size = this.H * 0.18 * (p.scale / playerScale);
      const frame = o.frame || (window.Character && window.Character.frameAtTime
        ? window.Character.frameAtTime('run', this.time) : null);
      const color = o.color || '#39ff9e';

      window.Blobbie.draw(ctx, p.x, p.y, size, {
        frame, state: 'run', time: this.time, alpha: 0.72, tint: color,
      });

      const gap = Math.round(rel);
      let label = o.name || 'Rival';
      if (gap > 1) label += ' • ' + gap + 'm ahead';
      else if (gap < -1) label += ' • ' + (-gap) + 'm behind';
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = 'bold ' + Math.max(10, 13 * p.scale) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = color; ctx.shadowBlur = 8;
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
