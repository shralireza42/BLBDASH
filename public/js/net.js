/* Network layer: REST helpers + Socket.IO wrapper for Blobbie Dash. */
(function () {
  'use strict';

  const STORE_KEY = 'blobbieDash.identity';
  const LOCAL_KEY = 'blobbieDash.localPlayer';

  const Net = {
    id: null,
    token: null,
    socket: null,
    _handlers: {},

    // Is the realtime/REST backend reachable? (false on a static-only deploy.)
    isOnline() { return !!(this.socket && this.socket.connected); },

    _defaultConfig() { return { startingBalance: 1000, entryFee: 50, rake: 0.1, coinValue: 5 }; },
    _makeLocal(username) {
      const name = (String(username || 'Blobbie').trim().slice(0, 18).replace(/[^\w \-]/g, '') || 'Blobbie');
      const id = 'local-' + Math.random().toString(16).slice(2, 12);
      const token = Math.random().toString(16).slice(2);
      const player = { id, username: name, balance: 1000, games: 0, wins: 0, bestScore: 0, weeklyRank: null, local: true };
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(player)); } catch (e) {}
      return { id, token, player };
    },
    _localPlayer() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { return null; } },

    loadIdentity() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) { const o = JSON.parse(raw); this.id = o.id; this.token = o.token; }
      } catch (e) { /* ignore */ }
      return !!(this.id && this.token);
    },

    saveIdentity(id, token) {
      this.id = id; this.token = token;
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ id, token })); } catch (e) {}
    },

    clearIdentity() {
      this.id = null; this.token = null;
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    },

    async _fetch(url, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (this.id && this.token) {
        opts.headers['x-player-id'] = this.id;
        opts.headers['x-player-token'] = this.token;
      }
      const res = await fetch(url, opts);
      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch (e) {}
        throw Object.assign(new Error(body.error || ('HTTP ' + res.status)), { status: res.status, body });
      }
      return res.json();
    },

    // All REST calls degrade gracefully so the SOLO game + customization work
    // even with no backend (e.g. a static deploy on Vercel).
    getConfig() { return this._fetch('/api/config').catch(() => this._defaultConfig()); },
    register(username) {
      return this._fetch('/api/register', { method: 'POST', body: JSON.stringify({ username }) })
        .catch(() => this._makeLocal(username));
    },
    me() {
      return this._fetch('/api/me').catch(() => {
        const p = this._localPlayer();
        if (p) return { player: p };
        throw new Error('offline-no-local');
      });
    },
    claimBonus() { return this._fetch('/api/claim-bonus', { method: 'POST', body: '{}' }).catch(() => ({ player: this._localPlayer() })); },
    leaderboard(scope) { return this._fetch('/api/leaderboard?scope=' + (scope || 'all')).catch(() => ({ scope: scope || 'all', entries: [] })); },
    tournament() { return this._fetch('/api/tournament').catch(() => ({ week: '—', pool: 0, endsAt: Date.now(), prizeSplit: [], standings: [], recentlySettled: [] })); },

    // ---- socket ----
    connect() {
      if (this.socket) return;
      if (typeof io === 'undefined') return; // no realtime server (static host)
      try {
        this.socket = io({ transports: ['websocket', 'polling'], reconnectionAttempts: 3, timeout: 5000 });
      } catch (e) { return; }
      const events = [
        'auth:ok', 'auth:error', 'queue:waiting', 'queue:error', 'queue:left',
        'room:created', 'room:update', 'room:left', 'room:error',
        'match:found', 'match:start', 'match:cancelled',
        'opponent:progress', 'opponent:finished', 'match:result',
      ];
      events.forEach((ev) => {
        this.socket.on(ev, (data) => this._emit(ev, data));
      });
      this.socket.on('connect', () => {
        if (this.id && this.token) this.socket.emit('auth', { id: this.id, token: this.token });
        this._emit('connect');
      });
      this.socket.on('disconnect', () => this._emit('disconnect'));
    },

    on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    _emit(ev, data) { (this._handlers[ev] || []).forEach((fn) => fn(data)); },
    send(ev, data) { if (this.socket) this.socket.emit(ev, data); },
  };

  window.Net = Net;
})();
