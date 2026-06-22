'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'blobbie.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id          TEXT PRIMARY KEY,
    token       TEXT NOT NULL,
    username    TEXT UNIQUE NOT NULL,
    balance     INTEGER NOT NULL DEFAULT 0,
    games       INTEGER NOT NULL DEFAULT 0,
    wins        INTEGER NOT NULL DEFAULT 0,
    best_score  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  TEXT NOT NULL,
    username   TEXT NOT NULL,
    score      INTEGER NOT NULL,
    distance   INTEGER NOT NULL,
    coins      INTEGER NOT NULL,
    week       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scores_week ON scores(week, score DESC);
  CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);

  CREATE TABLE IF NOT EXISTS matches (
    id         TEXT PRIMARY KEY,
    mode       TEXT NOT NULL,
    seed       INTEGER NOT NULL,
    p1_id      TEXT, p1_name TEXT, p1_score INTEGER,
    p2_id      TEXT, p2_name TEXT, p2_score INTEGER,
    winner_id  TEXT,
    pool       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    week       TEXT PRIMARY KEY,
    pool       INTEGER NOT NULL DEFAULT 0,
    settled    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

// ---- helpers ----
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}
function currentWeek() { return isoWeek(new Date()); }

function weekEndTs(weekKey) {
  // end of the ISO week (next Monday 00:00 UTC) for the given week of "now".
  const now = new Date();
  const day = now.getUTCDay() || 7; // 1..7, Mon..Sun
  const daysUntilNextMon = 8 - day;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilNextMon));
  return end.getTime();
}

const BASE_TOURNAMENT_POOL = 5000;

function ensureTournament(week) {
  let t = db.prepare('SELECT * FROM tournaments WHERE week = ?').get(week);
  if (!t) {
    db.prepare('INSERT INTO tournaments (week, pool, settled, created_at) VALUES (?,?,0,?)')
      .run(week, BASE_TOURNAMENT_POOL, Date.now());
    t = db.prepare('SELECT * FROM tournaments WHERE week = ?').get(week);
  }
  return t;
}

// ---- players ----
function genId() { return crypto.randomBytes(9).toString('hex'); }
function genToken() { return crypto.randomBytes(24).toString('hex'); }

function createPlayer(username, startingBalance) {
  username = String(username || '').trim().slice(0, 18).replace(/[^\w \-]/g, '') || 'Blobbie';
  // ensure uniqueness with numeric suffix
  let name = username, n = 1;
  while (db.prepare('SELECT 1 FROM players WHERE username = ?').get(name)) {
    n++; name = username.slice(0, 14) + n;
  }
  const id = genId(), token = genToken();
  db.prepare('INSERT INTO players (id, token, username, balance, created_at) VALUES (?,?,?,?,?)')
    .run(id, token, name, startingBalance, Date.now());
  return getPlayer(id);
}

function getPlayer(id) { return db.prepare('SELECT * FROM players WHERE id = ?').get(id); }

function authPlayer(id, token) {
  const p = getPlayer(id);
  if (!p || p.token !== token) return null;
  return p;
}

function publicPlayer(p) {
  if (!p) return null;
  const week = currentWeek();
  const rankRow = db.prepare(
    'SELECT COUNT(*)+1 AS r FROM (SELECT player_id, MAX(score) ms FROM scores WHERE week = ? GROUP BY player_id) WHERE ms > (SELECT COALESCE(MAX(score),0) FROM scores WHERE week = ? AND player_id = ?)'
  ).get(week, week, p.id);
  return {
    id: p.id, username: p.username, balance: p.balance,
    games: p.games, wins: p.wins, bestScore: p.best_score,
    weeklyRank: rankRow ? rankRow.r : null,
  };
}

function adjustBalance(id, delta) {
  db.prepare('UPDATE players SET balance = MAX(0, balance + ?) WHERE id = ?').run(delta, id);
}

function recordGame(id, won, score) {
  db.prepare('UPDATE players SET games = games + 1, wins = wins + ?, best_score = MAX(best_score, ?) WHERE id = ?')
    .run(won ? 1 : 0, score, id);
}

// ---- scores / leaderboard ----
function submitScore(player, score, distance, coins) {
  const week = currentWeek();
  ensureTournament(week);
  db.prepare('INSERT INTO scores (player_id, username, score, distance, coins, week, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(player.id, player.username, score, distance, coins, week, Date.now());
}

function topScores(scope, limit) {
  limit = limit || 50;
  // best score per player
  if (scope === 'week') {
    const week = currentWeek();
    return db.prepare(`
      SELECT username, MAX(score) AS score, MAX(distance) AS distance, SUM(coins) AS coins, player_id
      FROM scores WHERE week = ? GROUP BY player_id ORDER BY score DESC LIMIT ?
    `).all(week, limit);
  }
  return db.prepare(`
    SELECT username, MAX(score) AS score, MAX(distance) AS distance, SUM(coins) AS coins, player_id
    FROM scores GROUP BY player_id ORDER BY score DESC LIMIT ?
  `).all(limit);
}

function addToTournamentPool(week, amount) {
  ensureTournament(week);
  db.prepare('UPDATE tournaments SET pool = pool + ? WHERE week = ?').run(amount, week);
}

// Distribute prize pool of any finished, unsettled past weeks among top players.
const PRIZE_SPLIT = [0.5, 0.25, 0.125, 0.075, 0.05]; // top 5
function settleFinishedTournaments() {
  const week = currentWeek();
  const rows = db.prepare('SELECT * FROM tournaments WHERE settled = 0 AND week <> ?').all(week);
  const results = [];
  for (const t of rows) {
    const top = db.prepare(`
      SELECT player_id, username, MAX(score) AS score FROM scores WHERE week = ?
      GROUP BY player_id ORDER BY score DESC LIMIT 5
    `).all(t.week);
    const payouts = [];
    top.forEach((row, i) => {
      const amount = Math.floor(t.pool * (PRIZE_SPLIT[i] || 0));
      if (amount > 0) { adjustBalance(row.player_id, amount); payouts.push({ username: row.username, amount }); }
    });
    db.prepare('UPDATE tournaments SET settled = 1 WHERE week = ?').run(t.week);
    results.push({ week: t.week, pool: t.pool, payouts });
  }
  return results;
}

function tournamentInfo() {
  settleFinishedTournaments();
  const week = currentWeek();
  const t = ensureTournament(week);
  const standings = topScores('week', 10);
  const settled = db.prepare('SELECT week, pool FROM tournaments WHERE settled = 1 ORDER BY week DESC LIMIT 5').all();
  return {
    week, pool: t.pool, endsAt: weekEndTs(week),
    prizeSplit: PRIZE_SPLIT, standings, recentlySettled: settled,
  };
}

function recordMatch(m) {
  db.prepare(`INSERT INTO matches
    (id, mode, seed, p1_id, p1_name, p1_score, p2_id, p2_name, p2_score, winner_id, pool, created_at)
    VALUES (@id,@mode,@seed,@p1_id,@p1_name,@p1_score,@p2_id,@p2_name,@p2_score,@winner_id,@pool,@createdAt)`)
    .run({ createdAt: Date.now(), ...m });
}

module.exports = {
  db, currentWeek, isoWeek, weekEndTs, BASE_TOURNAMENT_POOL,
  createPlayer, getPlayer, authPlayer, publicPlayer, adjustBalance, recordGame,
  submitScore, topScores, addToTournamentPool, tournamentInfo,
  settleFinishedTournaments, recordMatch, ensureTournament,
};
