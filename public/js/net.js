/* Network layer: REST helpers + Socket.IO wrapper for Blobbie Dash. */
(function () {
  'use strict';

  const STORE_KEY = 'blobbieDash.identity';

  const Net = {
    id: null,
    token: null,
    socket: null,
    _handlers: {},

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

    getConfig() { return this._fetch('/api/config'); },
    register(username) {
      return this._fetch('/api/register', { method: 'POST', body: JSON.stringify({ username }) });
    },
    me() { return this._fetch('/api/me'); },
    claimBonus() { return this._fetch('/api/claim-bonus', { method: 'POST', body: '{}' }); },
    leaderboard(scope) { return this._fetch('/api/leaderboard?scope=' + (scope || 'all')); },
    tournament() { return this._fetch('/api/tournament'); },

    // ---- socket ----
    connect() {
      if (this.socket) return;
      this.socket = io({ transports: ['websocket', 'polling'] });
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
