'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const db = require('./db');

// ---- config ----
const PORT = process.env.PORT || 3000;
const STARTING_BALANCE = 1000;   // virtual $BLOBBIE granted to new players
const ENTRY_FEE = 50;            // ranked random match entry fee
const RAKE = 0.10;               // 10% of pool feeds the weekly tournament
const COUNTDOWN_MS = 3000;
const FINISH_TIMEOUT_MS = 120000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function auth(req, res, next) {
  const id = req.header('x-player-id');
  const token = req.header('x-player-token');
  const p = db.authPlayer(id, token);
  if (!p) return res.status(401).json({ error: 'unauthorized' });
  req.player = p;
  next();
}

// ---- REST API ----
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.get('/api/config', (req, res) => {
  res.json({ startingBalance: STARTING_BALANCE, entryFee: ENTRY_FEE, rake: RAKE, coinValue: 5 });
});

app.post('/api/register', (req, res) => {
  const p = db.createPlayer(req.body && req.body.username, STARTING_BALANCE);
  res.json({ id: p.id, token: p.token, player: db.publicPlayer(p) });
});

app.get('/api/me', auth, (req, res) => res.json({ player: db.publicPlayer(req.player) }));

app.post('/api/claim-bonus', auth, (req, res) => {
  // top players back up so they can keep playing the demo economy
  if (req.player.balance < ENTRY_FEE) {
    db.adjustBalance(req.player.id, 200);
  }
  res.json({ player: db.publicPlayer(db.getPlayer(req.player.id)) });
});

app.get('/api/leaderboard', (req, res) => {
  const scope = req.query.scope === 'week' ? 'week' : 'all';
  res.json({ scope, entries: db.topScores(scope, 50) });
});

app.get('/api/tournament', (req, res) => res.json(db.tournamentInfo()));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---- in-memory match state ----
const matches = new Map();     // matchId -> match
const rankedQueue = [];        // [{ socketId, playerId }]
const rooms = new Map();       // code -> { code, hostPlayer, members: [{playerId, socketId, name}] }
const socketsByPlayer = new Map();

function makeMatchId() { return crypto.randomBytes(8).toString('hex'); }
function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  do { c = Array.from({ length: 4 }, () => chars[(Math.random() * chars.length) | 0]).join(''); }
  while (rooms.has(c));
  return c;
}

function othersOf(match, playerId) {
  return match.players.filter((p) => p.id !== playerId);
}

// members: array of { playerId, socketId, name }  (2..4 players)
function createMatch(mode, members, ranked) {
  const id = makeMatchId();
  const matchSeed = (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0) || 1;
  const fee = ranked ? ENTRY_FEE : 0;
  const pool = fee * members.length;
  const match = {
    id, mode, ranked, seed: matchSeed, fee, pool,
    state: 'found',
    players: members.map((x) => ({
      id: x.playerId, name: x.name, socketId: x.socketId,
      ready: false, finished: false, alive: true, forfeited: false,
      result: { score: 0, distance: 0, coins: 0 },
    })),
    createdAt: Date.now(),
  };
  matches.set(id, match);
  const roster = match.players.map((q) => ({ id: q.id, name: q.name }));
  for (const pl of match.players) {
    const sock = io.sockets.sockets.get(pl.socketId);
    if (sock) sock.data.matchId = id;
    io.to(pl.socketId).emit('match:found', {
      matchId: id, seed: matchSeed, ranked, fee, pool,
      you: { id: pl.id, name: pl.name },
      players: roster,
    });
  }
  return match;
}

function tryStart(match) {
  if (match.state !== 'found') return;
  if (!match.players.every((p) => p.ready)) return;
  match.state = 'starting';
  const startAt = Date.now() + COUNTDOWN_MS;
  for (const pl of match.players) {
    io.to(pl.socketId).emit('match:start', { matchId: match.id, startAt, countdown: COUNTDOWN_MS });
  }
  match.state = 'running';
  match.finishTimer = setTimeout(() => settleMatch(match, 'timeout'), COUNTDOWN_MS + FINISH_TIMEOUT_MS);
}

function settleMatch(match, reason) {
  if (match.state === 'done') return;
  match.state = 'done';
  if (match.finishTimer) clearTimeout(match.finishTimer);
  const week = db.currentWeek();

  // rank by score (forfeiters sink to the bottom and can't win)
  const eff = (p) => (p.forfeited ? -1 : p.result.score);
  const order = [...match.players].sort((a, b) => eff(b) - eff(a));
  const topEff = eff(order[0]);
  const winners = order.filter((p) => !p.forfeited && eff(p) === topEff && topEff >= 0);
  const tie = winners.length > 1;
  const noWinner = winners.length === 0;
  const winnerId = (!tie && !noWinner) ? winners[0].id : null;

  let prize = 0, rakeAmt = 0, tieShare = 0;
  if (match.ranked) {
    for (const pl of match.players) {
      if (pl.forfeited) continue;
      const pdata = db.getPlayer(pl.id);
      if (pdata) db.submitScore(pdata, pl.result.score, pl.result.distance, pl.result.coins);
    }
    if (noWinner) {
      for (const pl of match.players) db.adjustBalance(pl.id, match.fee); // refund
    } else if (tie) {
      tieShare = Math.floor(match.pool / winners.length);
      for (const w of winners) db.adjustBalance(w.id, tieShare);
    } else {
      rakeAmt = Math.floor(match.pool * RAKE);
      prize = match.pool - rakeAmt;
      db.adjustBalance(winnerId, prize);
      db.addToTournamentPool(week, rakeAmt);
    }
  }

  for (const pl of match.players) db.recordGame(pl.id, pl.id === winnerId, pl.result.score);

  const p1 = match.players[0], p2 = match.players[1] || { id: null, name: null, result: {} };
  db.recordMatch({
    id: match.id, mode: match.mode, seed: match.seed,
    p1_id: p1.id, p1_name: p1.name, p1_score: p1.result.score,
    p2_id: p2.id, p2_name: p2.name, p2_score: p2.result.score || 0,
    winner_id: winnerId, pool: match.pool,
  });

  const standings = order.map((p, i) => ({
    rank: i + 1, id: p.id, name: p.name,
    score: p.result.score, distance: p.result.distance, coins: p.result.coins,
    forfeited: p.forfeited,
  }));

  for (const pl of match.players) {
    let outcome;
    if (tie && winners.some((w) => w.id === pl.id)) outcome = 'tie';
    else if (pl.id === winnerId) outcome = 'win';
    else outcome = 'lose';
    const fresh = db.getPlayer(pl.id);
    io.to(pl.socketId).emit('match:result', {
      matchId: match.id, outcome, reason: reason || 'finished',
      ranked: match.ranked, pool: match.pool,
      prize: outcome === 'win' ? prize : (outcome === 'tie' && match.ranked ? tieShare : 0),
      rake: rakeAmt,
      you: pl.result, standings,
      player: db.publicPlayer(fresh),
    });
    const sock = io.sockets.sockets.get(pl.socketId);
    if (sock) sock.data.matchId = null;
  }
  matches.delete(match.id);
}

function removeFromQueue(socketId) {
  const i = rankedQueue.findIndex((q) => q.socketId === socketId);
  if (i >= 0) rankedQueue.splice(i, 1);
}

function tryMatchmake() {
  while (rankedQueue.length >= 2) {
    const a = rankedQueue.shift();
    const b = rankedQueue.shift();
    const pa = db.getPlayer(a.playerId), pb = db.getPlayer(b.playerId);
    if (!pa || !pb) continue;
    if (pa.balance < ENTRY_FEE) { io.to(a.socketId).emit('queue:error', { error: 'insufficient_balance' }); rankedQueue.unshift(b); continue; }
    if (pb.balance < ENTRY_FEE) { io.to(b.socketId).emit('queue:error', { error: 'insufficient_balance' }); rankedQueue.unshift(a); continue; }
    // escrow fees
    db.adjustBalance(pa.id, -ENTRY_FEE);
    db.adjustBalance(pb.id, -ENTRY_FEE);
    createMatch('ranked', [
      { playerId: pa.id, socketId: a.socketId, name: pa.username },
      { playerId: pb.id, socketId: b.socketId, name: pb.username },
    ], true);
  }
}

const MAX_ROOM = 4;

function broadcastRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  const members = room.members.map((m) => ({ id: m.playerId, name: m.name }));
  for (const m of room.members) {
    io.to(m.socketId).emit('room:update', {
      code, members, hostId: room.hostPlayer,
      isHost: m.playerId === room.hostPlayer,
      canStart: room.members.length >= 2,
      max: MAX_ROOM,
    });
  }
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  socket.data.roomCode = null;
  const room = rooms.get(code);
  if (!room) return;
  room.members = room.members.filter((m) => m.socketId !== socket.id);
  if (room.members.length === 0) { rooms.delete(code); return; }
  if (room.hostPlayer === socket.data.playerId) room.hostPlayer = room.members[0].playerId;
  broadcastRoom(code);
}

io.on('connection', (socket) => {
  socket.on('auth', (msg) => {
    const p = db.authPlayer(msg && msg.id, msg && msg.token);
    if (!p) { socket.emit('auth:error', { error: 'unauthorized' }); return; }
    socket.data.playerId = p.id;
    socket.data.name = p.username;
    socketsByPlayer.set(p.id, socket.id);
    socket.emit('auth:ok', { player: db.publicPlayer(p) });
  });

  // ---- ranked random matchmaking ----
  socket.on('queue:join', () => {
    if (!socket.data.playerId) return socket.emit('queue:error', { error: 'not_authed' });
    const p = db.getPlayer(socket.data.playerId);
    if (!p) return;
    if (p.balance < ENTRY_FEE) return socket.emit('queue:error', { error: 'insufficient_balance', fee: ENTRY_FEE });
    removeFromQueue(socket.id);
    rankedQueue.push({ socketId: socket.id, playerId: p.id, name: p.username });
    socket.emit('queue:waiting', { position: rankedQueue.length });
    tryMatchmake();
  });
  socket.on('queue:leave', () => { removeFromQueue(socket.id); socket.emit('queue:left', {}); });

  // ---- private friend rooms (up to 4 players) ----
  socket.on('room:create', () => {
    if (!socket.data.playerId) return socket.emit('room:error', { error: 'not_authed' });
    leaveRoom(socket);
    const code = makeRoomCode();
    rooms.set(code, {
      code, hostPlayer: socket.data.playerId,
      members: [{ playerId: socket.data.playerId, socketId: socket.id, name: socket.data.name }],
    });
    socket.data.roomCode = code;
    socket.emit('room:created', { code });
    broadcastRoom(code);
  });
  socket.on('room:join', (msg) => {
    if (!socket.data.playerId) return socket.emit('room:error', { error: 'not_authed' });
    const code = String((msg && msg.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit('room:error', { error: 'not_found' });
    if (room.members.some((m) => m.playerId === socket.data.playerId)) return; // already in
    if (room.members.length >= MAX_ROOM) return socket.emit('room:error', { error: 'room_full' });
    leaveRoom(socket);
    room.members.push({ playerId: socket.data.playerId, socketId: socket.id, name: socket.data.name });
    socket.data.roomCode = code;
    broadcastRoom(code);
  });
  socket.on('room:leave', () => { leaveRoom(socket); socket.emit('room:left', {}); });
  socket.on('room:start', () => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room) return socket.emit('room:error', { error: 'not_found' });
    if (room.hostPlayer !== socket.data.playerId) return socket.emit('room:error', { error: 'not_host' });
    const members = room.members.filter((m) => io.sockets.sockets.get(m.socketId) && db.getPlayer(m.playerId));
    if (members.length < 2) return socket.emit('room:error', { error: 'need_players' });
    rooms.delete(code);
    for (const m of members) { const s = io.sockets.sockets.get(m.socketId); if (s) s.data.roomCode = null; }
    createMatch('friend', members, false);
  });

  // ---- match flow ----
  socket.on('match:ready', (msg) => {
    const match = matches.get(msg && msg.matchId);
    if (!match) return;
    const pl = match.players.find((p) => p.id === socket.data.playerId);
    if (pl) pl.ready = true;
    tryStart(match);
  });

  socket.on('match:progress', (msg) => {
    const match = matches.get(msg && msg.matchId);
    if (!match || match.state !== 'running') return;
    const pl = match.players.find((p) => p.id === socket.data.playerId);
    if (!pl) return;
    pl.result = { score: msg.score | 0, distance: msg.distance | 0, coins: msg.coins | 0 };
    pl.alive = msg.alive !== false;
    const payload = {
      id: pl.id, name: pl.name, score: pl.result.score, distance: pl.result.distance,
      coins: pl.result.coins, alive: pl.alive,
      // live pose so each rival can be rendered moving on the same track
      lane: typeof msg.lane === 'number' ? msg.lane : 1,
      air: typeof msg.air === 'number' ? msg.air : 0,
      sliding: !!msg.sliding,
      frame: typeof msg.frame === 'string' ? msg.frame : null,
    };
    for (const o of othersOf(match, socket.data.playerId)) io.to(o.socketId).emit('opponent:progress', payload);
  });

  socket.on('match:finish', (msg) => {
    const match = matches.get(msg && msg.matchId);
    if (!match || match.state === 'done') return;
    const pl = match.players.find((p) => p.id === socket.data.playerId);
    if (!pl) return;
    pl.result = { score: msg.score | 0, distance: msg.distance | 0, coins: msg.coins | 0 };
    pl.alive = false;
    pl.finished = true;
    const fin = { id: pl.id, name: pl.name, ...pl.result };
    for (const o of othersOf(match, socket.data.playerId)) io.to(o.socketId).emit('opponent:finished', fin);
    if (match.players.every((p) => p.finished)) settleMatch(match, 'finished');
  });

  socket.on('match:forfeit', (msg) => {
    const match = matches.get(msg && msg.matchId);
    if (match) handleLeaveMatch(socket, match, 'forfeit');
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    leaveRoom(socket);
    const mid = socket.data.matchId;
    if (mid && matches.has(mid)) handleLeaveMatch(socket, matches.get(mid), 'disconnect');
    if (socket.data.playerId) socketsByPlayer.delete(socket.data.playerId);
  });
});

function handleLeaveMatch(socket, match, reason) {
  if (!match || match.state === 'done') return;
  const pl = match.players.find((p) => p.id === socket.data.playerId);
  if (!pl) return;
  // the leaver forfeits (can't win); remaining players keep racing
  pl.finished = true;
  pl.alive = false;
  pl.forfeited = true;
  if (match.state === 'running') {
    const fin = { id: pl.id, name: pl.name, ...pl.result, left: true };
    for (const o of othersOf(match, pl.id)) io.to(o.socketId).emit('opponent:finished', fin);
    if (match.players.every((p) => p.finished)) settleMatch(match, reason);
  } else {
    // pre-start: cancel & refund any escrow
    if (match.ranked) for (const p of match.players) db.adjustBalance(p.id, match.fee);
    for (const p of match.players) io.to(p.socketId).emit('match:cancelled', { reason });
    if (match.finishTimer) clearTimeout(match.finishTimer);
    matches.delete(match.id);
  }
}

server.listen(PORT, () => {
  console.log(`Blobbie Dash server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
