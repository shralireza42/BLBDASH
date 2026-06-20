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
const rooms = new Map();       // code -> { matchId }
const socketsByPlayer = new Map();

function makeMatchId() { return crypto.randomBytes(8).toString('hex'); }
function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  do { c = Array.from({ length: 4 }, () => chars[(Math.random() * chars.length) | 0]).join(''); }
  while (rooms.has(c));
  return c;
}

function opponentOf(match, playerId) {
  return match.players.find((p) => p.id !== playerId);
}

function createMatch(mode, a, b, ranked) {
  const id = makeMatchId();
  const matchSeed = (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0) || 1;
  const fee = ranked ? ENTRY_FEE : 0;
  const pool = fee * 2;
  const match = {
    id, mode, ranked, seed: matchSeed, fee, pool,
    state: 'found',
    players: [a, b].map((x) => ({
      id: x.playerId, name: x.name, socketId: x.socketId,
      ready: false, finished: false, alive: true,
      result: { score: 0, distance: 0, coins: 0 },
    })),
    createdAt: Date.now(),
  };
  matches.set(id, match);
  for (const pl of match.players) {
    const sock = io.sockets.sockets.get(pl.socketId);
    if (sock) sock.data.matchId = id;
    const opp = opponentOf(match, pl.id);
    io.to(pl.socketId).emit('match:found', {
      matchId: id, seed: matchSeed, ranked, fee, pool,
      opponent: { name: opp.name },
      you: { name: pl.name },
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

  const [p1, p2] = match.players;
  const week = db.currentWeek();

  // determine winner by score (already = distance + coins*value)
  let winner = null, tie = false;
  if (p1.result.score > p2.result.score) winner = p1;
  else if (p2.result.score > p1.result.score) winner = p2;
  else tie = true;

  let prize = 0, rakeAmt = 0;
  if (match.ranked) {
    // both ranked scores count toward the leaderboard / tournament
    for (const pl of match.players) {
      const pdata = db.getPlayer(pl.id);
      if (pdata) db.submitScore(pdata, pl.result.score, pl.result.distance, pl.result.coins);
    }
    if (tie) {
      // refund entry fees
      for (const pl of match.players) db.adjustBalance(pl.id, match.fee);
    } else {
      rakeAmt = Math.floor(match.pool * RAKE);
      prize = match.pool - rakeAmt;
      db.adjustBalance(winner.id, prize);
      db.addToTournamentPool(week, rakeAmt);
    }
  }

  for (const pl of match.players) {
    db.recordGame(pl.id, winner === pl, pl.result.score);
  }
  db.recordMatch({
    id: match.id, mode: match.mode, seed: match.seed,
    p1_id: p1.id, p1_name: p1.name, p1_score: p1.result.score,
    p2_id: p2.id, p2_name: p2.name, p2_score: p2.result.score,
    winner_id: winner ? winner.id : null, pool: match.pool,
  });

  for (const pl of match.players) {
    const opp = opponentOf(match, pl.id);
    const outcome = tie ? 'tie' : (winner === pl ? 'win' : 'lose');
    const fresh = db.getPlayer(pl.id);
    io.to(pl.socketId).emit('match:result', {
      matchId: match.id, outcome, reason: reason || 'finished',
      ranked: match.ranked, pool: match.pool,
      prize: outcome === 'win' ? prize : (tie && match.ranked ? match.fee : 0),
      rake: rakeAmt,
      you: pl.result, opponent: { name: opp.name, ...opp.result, alive: opp.alive },
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
    createMatch('ranked', { ...a, name: pa.username }, { ...b, name: pb.username }, true);
  }
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

  // ---- private friend rooms ----
  socket.on('room:create', () => {
    if (!socket.data.playerId) return socket.emit('room:error', { error: 'not_authed' });
    const code = makeRoomCode();
    rooms.set(code, { hostSocket: socket.id, hostPlayer: socket.data.playerId, hostName: socket.data.name });
    socket.data.roomCode = code;
    socket.emit('room:created', { code });
  });
  socket.on('room:join', (msg) => {
    if (!socket.data.playerId) return socket.emit('room:error', { error: 'not_authed' });
    const code = String((msg && msg.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit('room:error', { error: 'not_found' });
    if (room.hostPlayer === socket.data.playerId) return socket.emit('room:error', { error: 'cannot_join_self' });
    if (room.guestPlayer) return socket.emit('room:error', { error: 'room_full' });
    const host = db.getPlayer(room.hostPlayer);
    const guest = db.getPlayer(socket.data.playerId);
    if (!host || !guest) return socket.emit('room:error', { error: 'player_gone' });
    rooms.delete(code);
    createMatch('friend',
      { socketId: room.hostSocket, playerId: host.id, name: host.username },
      { socketId: socket.id, playerId: guest.id, name: guest.username },
      false);
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
    const opp = opponentOf(match, socket.data.playerId);
    io.to(opp.socketId).emit('opponent:progress', {
      name: pl.name, score: pl.result.score, distance: pl.result.distance,
      coins: pl.result.coins, alive: pl.alive,
      // live pose so the rival can be rendered moving on the same track
      lane: typeof msg.lane === 'number' ? msg.lane : 1,
      air: typeof msg.air === 'number' ? msg.air : 0,
      sliding: !!msg.sliding,
      frame: typeof msg.frame === 'string' ? msg.frame : null,
    });
  });

  socket.on('match:finish', (msg) => {
    const match = matches.get(msg && msg.matchId);
    if (!match || match.state === 'done') return;
    const pl = match.players.find((p) => p.id === socket.data.playerId);
    if (!pl) return;
    pl.result = { score: msg.score | 0, distance: msg.distance | 0, coins: msg.coins | 0 };
    pl.alive = false;
    pl.finished = true;
    const opp = opponentOf(match, socket.data.playerId);
    io.to(opp.socketId).emit('opponent:finished', { name: pl.name, ...pl.result });
    if (match.players.every((p) => p.finished)) settleMatch(match, 'finished');
  });

  socket.on('match:forfeit', (msg) => {
    const match = matches.get(msg && msg.matchId);
    if (match) handleLeaveMatch(socket, match, 'forfeit');
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    if (socket.data.roomCode) rooms.delete(socket.data.roomCode);
    const mid = socket.data.matchId;
    if (mid && matches.has(mid)) handleLeaveMatch(socket, matches.get(mid), 'disconnect');
    if (socket.data.playerId) socketsByPlayer.delete(socket.data.playerId);
  });
});

function handleLeaveMatch(socket, match, reason) {
  if (!match || match.state === 'done') return;
  const pl = match.players.find((p) => p.id === socket.data.playerId);
  if (!pl) return;
  // leaver forfeits: their current score stands, opponent is marked alive-winner
  pl.finished = true;
  pl.alive = false;
  if (match.state === 'running') {
    const opp = opponentOf(match, pl.id);
    // ensure opponent outscores the forfeiter so they win the pool
    opp.result.score = Math.max(opp.result.score, pl.result.score + 1);
    opp.finished = true;
    settleMatch(match, reason);
  } else {
    // match not yet running -> just cancel and refund any escrow
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
