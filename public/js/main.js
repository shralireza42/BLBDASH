/* Blobbie Dash - UI orchestration: screens, menus, matchmaking & game wiring. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const screens = ['loading', 'identity', 'menu', 'lobby', 'game', 'result'];

  const state = {
    player: null,
    config: { entryFee: 50, startingBalance: 1000, coinValue: 5 },
    game: null,
    mode: null,            // 'solo' | 'ranked' | 'friend'
    match: null,           // { matchId, seed, ranked, players:[{id,name}] }
    myId: null,            // my player id within the match roster
    opps: {},              // id -> live rival { id, name, score, alive }
    countTimer: null,
    finished: false,
    lastProgressSent: 0,
  };

  function showScreen(name) {
    screens.forEach((s) => $('screen-' + s).classList.toggle('active', s === name));
    // hide the top bar on immersive / pre-login screens
    $('topbar').classList.toggle('hidden', name === 'loading' || name === 'identity' || name === 'game');
    if (name === 'menu') requestAnimationFrame(() => drawCharCanvas($('menuAvatar'), 'avatar'));
    // pause the neon menu background while the game canvas is on screen
    if (window.Background) window.Background.setActive(name !== 'game');
  }

  function updateMuteBtn() {
    const b = $('btnMute');
    if (!b || !window.Sound) return;
    const m = window.Sound.isMuted();
    b.textContent = m ? '🔇' : '🔊';
    b.classList.toggle('off', m);
  }

  // Render a character role into a small canvas (avatar / result art), with a
  // graceful fallback to the classic mascot sprite if the piece is missing.
  function drawCharCanvas(canvas, role, opts) {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || canvas.width || 64;
    const cssH = canvas.clientHeight || canvas.height || 64;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (window.Character && window.Character.has(role)) {
      window.Character.drawContained(ctx, role, cssW / 2, cssH / 2, cssW * 0.98, cssH * 0.98, opts || {});
    } else if (window.Blobbie) {
      window.Blobbie.draw(ctx, cssW / 2, cssH * 0.96, cssH * 0.84, { state: 'run', time: performance.now() / 1000 });
    }
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }

  function setPlayer(p) {
    state.player = p;
    if (!p) return;
    $('walletBalance').textContent = p.balance;
    $('profileName').textContent = p.username;
    $('statRank').textContent = p.weeklyRank || '—';
    $('statWins').textContent = p.wins;
    $('statGames').textContent = p.games;
    $('statBest').textContent = p.bestScore;
  }

  async function refreshMe() {
    try { const r = await Net.me(); setPlayer(r.player); } catch (e) { /* ignore */ }
  }

  // ---------------- init ----------------
  async function init() {
    showScreen('loading');
    if (window.Character) Character.load();
    try { state.config = await Net.getConfig(); } catch (e) {}
    $('feeLabel').textContent = state.config.entryFee;
    Net.connect();
    wireEvents();
    wireSocket();
    wireAudio();

    if (Net.loadIdentity()) {
      try {
        const r = await Net.me();
        setPlayer(r.player);
        showScreen('menu');
        return;
      } catch (e) { Net.clearIdentity(); }
    }
    showScreen('identity');
  }

  function wireAudio() {
    if (!window.Sound) return;
    updateMuteBtn();
    // Unlock + start music on the first user interaction (autoplay policy).
    const unlock = () => {
      window.Sound.unlock();
      if (!window.Sound.isMuted()) window.Sound.startMusic();
      document.removeEventListener('pointerdown', unlock);
    };
    document.addEventListener('pointerdown', unlock);

    // Mute toggle
    $('btnMute').onclick = () => {
      const m = window.Sound.toggleMuted();
      if (!m) { window.Sound.unlock(); window.Sound.startMusic(); window.Sound.click(); }
      updateMuteBtn();
    };

    // UI click feedback (menu buttons / cards / tabs)
    document.addEventListener('click', (e) => {
      const el = e.target.closest('.btn, .mode-card, .lb-tab, .modal-close');
      if (el && !window.Sound.isMuted()) window.Sound.click();
    }, true);
  }

  // ---------------- identity ----------------
  async function doRegister() {
    const name = $('usernameInput').value.trim();
    if (name.length < 2) { $('identityHint').textContent = 'Pick a name with at least 2 characters.'; return; }
    $('btnRegister').disabled = true;
    try {
      const r = await Net.register(name);
      Net.saveIdentity(r.id, r.token);
      if (Net.socket && Net.socket.connected) Net.socket.emit('auth', { id: r.id, token: r.token });
      setPlayer(r.player);
      if (r.player.username !== name) toast('Name taken — you are "' + r.player.username + '"');
      showScreen('menu');
    } catch (e) {
      $('identityHint').textContent = 'Could not create player. Try again.';
    } finally { $('btnRegister').disabled = false; }
  }

  // ---------------- menus / modes ----------------
  async function chooseMode(mode) {
    state.mode = mode;
    if (mode === 'solo') return startGame({ solo: true, seed: BlobbieShared.makeRandomSeed() });
    if (mode === 'ranked') return startRanked();
    if (mode === 'friend') return openFriendLobby();
  }

  async function startRanked() {
    await refreshMe();
    if (state.player.balance < state.config.entryFee) {
      try {
        await Net.claimBonus();
        await refreshMe();
        toast('Low balance — added a demo top-up of $BLOBBIE!');
      } catch (e) {}
      if (state.player.balance < state.config.entryFee) {
        toast('Not enough $BLOBBIE to enter (need ' + state.config.entryFee + ').');
        return;
      }
    }
    showScreen('lobby');
    $('lobbyTitle').textContent = 'Finding a rival…';
    $('lobbyText').textContent = 'Staking ' + state.config.entryFee + ' $BLOBBIE · winner takes the pool.';
    $('roomCodeBox').classList.add('hidden');
    $('roomPanel').classList.add('hidden');
    $('joinRoomBox').classList.add('hidden');
    $('friendChoice').classList.add('hidden');
    Net.send('queue:join');
  }

  function openFriendLobby() {
    showScreen('lobby');
    $('lobbyTitle').textContent = 'Play with Friends';
    $('lobbyText').textContent = 'Up to 4 players. Create a room and share the code, or join one.';
    $('roomCodeBox').classList.add('hidden');
    $('roomPanel').classList.add('hidden');
    $('friendChoice').classList.remove('hidden');
    $('joinRoomBox').classList.remove('hidden');
  }

  function cancelLobby() {
    Net.send('queue:leave');
    Net.send('room:leave');
    showScreen('menu');
    refreshMe();
  }

  // ---------------- game flow ----------------
  function destroyGame() {
    if (state.game) { state.game.destroy(); state.game = null; }
  }

  function startGame(opts) {
    // opts: { solo, seed, ghost, match }
    destroyGame();
    state.finished = false;
    state.opps = {};
    showScreen('game');
    $('pauseOverlay').classList.add('hidden');
    $('btnPause').style.display = opts.solo ? '' : 'none'; // pause only in solo
    $('hudRivals').style.display = opts.solo ? 'none' : 'flex';
    $('hudRivals').innerHTML = '';
    $('hudScore').textContent = '0';
    $('hudCoins').textContent = '0';
    $('hudDist').textContent = '0';

    // pre-seed rival HUD from the match roster (everyone but me)
    if (!opts.solo && state.match && state.match.players) {
      state.match.players.forEach((pl) => {
        if (pl.id !== state.myId) state.opps[pl.id] = { id: pl.id, name: pl.name, score: 0, alive: true };
      });
      renderRivals();
    }

    // canvas needs layout to measure; build on next frame
    requestAnimationFrame(() => {
      const canvas = $('gameCanvas');
      state.game = new BlobbieGame(canvas, {
        seed: opts.seed,
        ghost: !opts.solo,
        onUpdate: onGameUpdate,
        onGameOver: onGameOver,
      });
      window.BlobbieGameInstance = state.game; // handy for debugging / embedders
      state.game.start(); // render the shared background right away (frozen until "GO")
      if (opts.solo) {
        runCountdown(3000, () => state.game.begin());
      } else {
        // PvP: tell server we're ready; wait for synced match:start
        Net.send('match:ready', { matchId: state.match.matchId });
        $('lobbyText').textContent = '';
      }
    });
  }

  function renderRivals() {
    const el = $('hudRivals');
    if (!el) return;
    const rivals = Object.keys(state.opps).map((id) => state.opps[id])
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    el.innerHTML = rivals.map((r) =>
      '<div class="rival' + (r.alive === false ? ' out' : '') + '">' +
      '<span class="rname">' + escapeHtml(r.name || 'Rival') + (r.alive === false ? ' • out' : '') + '</span>' +
      '<span class="rscore">' + (r.score || 0) + '</span></div>'
    ).join('');
  }

  function runCountdown(ms, done) {
    const cd = $('countdown');
    cd.classList.remove('hidden');
    const end = Date.now() + ms;
    const tick = () => {
      const remain = end - Date.now();
      if (remain <= 0) {
        clearInterval(state.countTimer);
        $('countNum').textContent = 'GO!';
        if (window.Sound) window.Sound.go();
        setTimeout(() => cd.classList.add('hidden'), 350);
        done();
        return;
      }
      const n = Math.ceil(remain / 1000);
      if ($('countNum').textContent !== String(n)) {
        $('countNum').textContent = n;
        if (window.Sound) window.Sound.count();
        $('countNum').style.animation = 'none';
        void $('countNum').offsetWidth;
        $('countNum').style.animation = '';
      }
    };
    clearInterval(state.countTimer);
    tick();
    state.countTimer = setInterval(tick, 80);
  }

  function onGameUpdate(s) {
    $('hudScore').textContent = s.score;
    $('hudCoins').textContent = s.coins;
    $('hudDist').textContent = s.distance;
    if (state.mode === 'ranked' || state.mode === 'friend') {
      const now = performance.now();
      if (now - state.lastProgressSent > 70 && state.match) {
        state.lastProgressSent = now;
        Net.send('match:progress', {
          matchId: state.match.matchId, score: s.score, distance: s.distance,
          coins: s.coins, lane: s.lane, air: s.air, sliding: s.sliding,
          frame: s.frame, alive: true,
        });
      }
    }
  }

  function onGameOver(result) {
    if (state.finished) return;
    state.finished = true;
    if (state.mode === 'solo') {
      showSoloResult(result);
    } else if (state.match) {
      Net.send('match:finish', {
        matchId: state.match.matchId, score: result.score,
        distance: result.distance, coins: result.coins,
      });
      // show waiting overlay until server result
      const cd = $('countdown');
      cd.classList.remove('hidden');
      $('countNum').textContent = '…';
      state._pendingResult = result;
    }
  }

  function renderStandings(standings, myId) {
    $('resultStandings').innerHTML = standings.map((s) => {
      const me = s.id === myId;
      const medal = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : '#' + s.rank;
      return '<div class="standing' + (me ? ' me' : '') + (s.forfeited ? ' out' : '') + '">' +
        '<span class="st-rank">' + medal + '</span>' +
        '<span class="st-name">' + escapeHtml(s.name || 'Player') + (me ? ' (you)' : '') + (s.forfeited ? ' • left' : '') + '</span>' +
        '<span class="st-score">' + (s.score || 0) + '<small> · ' + (s.coins || 0) + '🪙</small></span></div>';
    }).join('');
  }

  function showSoloResult(result) {
    destroyGame();
    showScreen('result');
    $('resultBanner').textContent = 'Run Complete!';
    $('resultBanner').className = 'result-banner win';
    if (window.Sound) window.Sound.win();
    requestAnimationFrame(() => drawCharCanvas($('resultBlob'), 'win'));
    renderStandings([{ rank: 1, name: 'You', score: result.score, coins: result.coins, distance: result.distance, id: '__me' }], '__me');
    $('resultPrize').classList.remove('hidden');
    $('resultPrize').innerHTML = 'Solo practice — not ranked. Try <b>Ranked PvP</b> to earn $BLOBBIE and climb the leaderboard!';
    refreshMe();
  }

  function showPvpResult(data) {
    destroyGame();
    state.countTimer && clearInterval(state.countTimer);
    $('countdown').classList.add('hidden');
    showScreen('result');
    const banner = $('resultBanner');
    if (data.outcome === 'win') { banner.textContent = 'You Win! 🎉'; banner.className = 'result-banner win'; }
    else if (data.outcome === 'lose') { banner.textContent = 'Defeat'; banner.className = 'result-banner lose'; }
    else { banner.textContent = "It's a Tie!"; banner.className = 'result-banner tie'; }
    const resultRole = data.outcome === 'lose' ? 'lose' : data.outcome === 'tie' ? 'idle' : 'win';
    if (window.Sound) { if (data.outcome === 'win') window.Sound.win(); else if (data.outcome === 'lose') window.Sound.lose(); }
    requestAnimationFrame(() => drawCharCanvas($('resultBlob'), resultRole));

    renderStandings(data.standings || [], state.myId);

    const prize = $('resultPrize');
    prize.classList.remove('hidden');
    if (data.ranked) {
      if (data.outcome === 'win') prize.innerHTML = '🪙 You won <b>' + data.prize + ' $BLOBBIE</b> from the ' + data.pool + ' pool!';
      else if (data.outcome === 'tie') prize.innerHTML = 'Tie — you got <b>' + data.prize + ' $BLOBBIE</b>.';
      else prize.innerHTML = 'You lost your entry fee. Your score still counts on the leaderboard!';
    } else {
      prize.innerHTML = 'Friendly match — no $BLOBBIE staked.';
    }
    if (data.player) setPlayer(data.player);
    else refreshMe();
  }

  function pauseGame() {
    if (!state.game || state.mode !== 'solo') return;
    if (state.game.frozen || !state.game.alive) return;
    state.game.setPaused(true);
    $('pauseOverlay').classList.remove('hidden');
  }
  function resumeGame() {
    if (!state.game) return;
    state.game.setPaused(false);
    $('pauseOverlay').classList.add('hidden');
  }

  function quitGame() {
    if (state.match) Net.send('match:forfeit', { matchId: state.match.matchId });
    $('pauseOverlay').classList.add('hidden');
    destroyGame();
    state.match = null;
    state.mode = null;
    showScreen('menu');
    refreshMe();
  }

  // ---------------- socket events ----------------
  function wireSocket() {
    Net.on('auth:ok', (d) => { if (d.player) setPlayer(d.player); });
    Net.on('queue:waiting', () => { $('lobbyTitle').textContent = 'Finding a rival…'; });
    Net.on('queue:error', (d) => {
      toast(d.error === 'insufficient_balance' ? 'Not enough $BLOBBIE.' : 'Matchmaking error.');
      showScreen('menu');
    });
    Net.on('room:created', (d) => {
      $('roomCode').textContent = d.code;
      $('roomCodeBox').classList.remove('hidden');
    });
    Net.on('room:update', (d) => renderRoom(d));
    Net.on('room:error', (d) => {
      const m = { not_found: 'Room not found.', room_full: 'Room is full (max 4).', not_host: 'Only the host can start.', need_players: 'Need at least 2 players.', player_gone: 'Host left.' };
      toast(m[d.error] || 'Room error.');
    });
    Net.on('match:found', (d) => {
      state.match = { matchId: d.matchId, seed: d.seed, ranked: d.ranked, players: d.players, pool: d.pool, fee: d.fee };
      state.myId = d.you && d.you.id;
      state.mode = d.ranked ? 'ranked' : 'friend';
      startGame({ solo: false, seed: d.seed, match: state.match });
      refreshMe();
    });
    Net.on('match:start', (d) => {
      const remain = Math.max(0, (d.startAt || Date.now()) - Date.now());
      runCountdown(remain || 3000, () => { if (state.game) state.game.begin(); });
    });
    Net.on('opponent:progress', (d) => {
      const id = d.id == null ? '_' : d.id;
      state.opps[id] = Object.assign(state.opps[id] || {}, d, { alive: d.alive });
      renderRivals();
      if (state.game) state.game.setOpponent(d);
    });
    Net.on('opponent:finished', (d) => {
      const id = d.id == null ? '_' : d.id;
      const prev = state.opps[id] || {};
      state.opps[id] = Object.assign({}, prev, d, { alive: false });
      renderRivals();
      // freeze their ghost in place and mark dead (it is then removed from the track)
      if (state.game) state.game.setOpponent(Object.assign({}, prev, d, { alive: false }));
    });
    Net.on('match:result', (d) => showPvpResult(d));
    Net.on('match:cancelled', (d) => {
      toast('Match cancelled' + (d && d.reason === 'disconnect' ? ' (a player left)' : '') + '.');
      destroyGame();
      state.match = null;
      showScreen('menu');
      refreshMe();
    });
  }

  function renderRoom(d) {
    // switch the lobby into "in room" view
    $('friendChoice').classList.add('hidden');
    $('joinRoomBox').classList.add('hidden');
    $('roomCode').textContent = d.code;
    $('roomCodeBox').classList.remove('hidden');
    $('roomPanel').classList.remove('hidden');
    $('lobbyTitle').textContent = 'Friend Lobby';
    $('lobbyText').textContent = d.members.length + '/' + (d.max || 4) + ' players';
    $('roomMembers').innerHTML = d.members.map((m) =>
      '<div class="room-member">' + escapeHtml(m.name) +
      (m.id === d.hostId ? ' <span class="host-tag">host</span>' : '') + '</div>'
    ).join('');
    const startBtn = $('btnStartRoom');
    if (d.isHost) {
      startBtn.classList.remove('hidden');
      startBtn.disabled = !d.canStart;
      startBtn.textContent = d.canStart ? 'Start Match (' + d.members.length + ')' : 'Waiting for players…';
      $('roomWait').textContent = '';
    } else {
      startBtn.classList.add('hidden');
      $('roomWait').textContent = 'Waiting for the host to start…';
    }
  }

  // ---------------- modals ----------------
  function openModal(html) {
    $('modalContent').innerHTML = html;
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  async function openLeaderboard(scope) {
    scope = scope || 'week';
    openModal('<h2>🏆 Leaderboard</h2><div class="lb-tabs"><button class="lb-tab" data-scope="week">This Week</button><button class="lb-tab" data-scope="all">All-time</button></div><div class="lb-list" id="lbList">Loading…</div>');
    const render = async (sc) => {
      Array.from(document.querySelectorAll('.lb-tab')).forEach((t) => t.classList.toggle('active', t.dataset.scope === sc));
      try {
        const r = await Net.leaderboard(sc);
        const list = $('lbList');
        if (!r.entries.length) { list.innerHTML = '<p class="subtitle">No ranked runs yet. Be the first — play Ranked PvP!</p>'; return; }
        list.innerHTML = r.entries.map((e, i) => {
          const me = state.player && e.player_id === state.player.id ? ' me' : '';
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
          return '<div class="lb-row' + me + '"><div class="lb-rank">' + medal + '</div>' +
            '<div class="lb-name">' + escapeHtml(e.username) + '</div>' +
            '<div><div class="lb-score">' + e.score + '</div><div class="lb-coins">' + (e.coins || 0) + ' 🪙</div></div></div>';
        }).join('');
      } catch (e) { $('lbList').innerHTML = '<p class="subtitle">Could not load leaderboard.</p>'; }
    };
    Array.from(document.querySelectorAll('.lb-tab')).forEach((t) => t.onclick = () => render(t.dataset.scope));
    render(scope);
  }

  async function openTournament() {
    openModal('<h2>🎟️ Weekly Tournament</h2><div id="tourBody">Loading…</div>');
    try {
      const t = await Net.tournament();
      const ms = Math.max(0, t.endsAt - Date.now());
      const splitRows = t.prizeSplit.map((p, i) => '<div class="pr"><span>#' + (i + 1) + '</span><span>' + Math.round(p * 100) + '% of pool</span></div>').join('');
      const standings = t.standings.length
        ? t.standings.map((e, i) => '<div class="lb-row"><div class="lb-rank">' + (i + 1) + '</div><div class="lb-name">' + escapeHtml(e.username) + '</div><div class="lb-score">' + e.score + '</div></div>').join('')
        : '<p class="subtitle">No entries yet this week.</p>';
      $('tourBody').innerHTML =
        '<div class="tour-pool"><div class="amt">' + t.pool + '</div><div class="wallet-unit" style="color:var(--gold)">$BLOBBIE PRIZE POOL</div>' +
        '<div class="tour-timer">Ends in ' + fmtDuration(ms) + ' (' + t.week + ')</div></div>' +
        '<div class="lb-list">' + standings + '</div>' +
        '<h3 style="margin:18px 0 4px">Prize split</h3><div class="prize-table">' + splitRows + '</div>' +
        '<p class="subtitle" style="margin-top:14px">Play <b>Ranked PvP</b> to post scores. 10% of every match pot feeds the pool. Top runners are paid out automatically when the week ends.</p>';
    } catch (e) { $('tourBody').innerHTML = '<p class="subtitle">Could not load tournament.</p>'; }
  }

  function openHowto() {
    openModal('<h2>❓ How to play</h2><ul class="howto-list">' +
      '<li><b>Move:</b> ◀ ▶ arrows / A·D / swipe to change lane.</li>' +
      '<li><b>Jump:</b> ▲ / W / Space / swipe up — clear low hurdles & grab arc coins.</li>' +
      '<li><b>Slide:</b> ▼ / S / swipe down — duck under bars.</li>' +
      '<li><b>Walls</b> can only be dodged by switching lanes.</li>' +
      '<li>Collect <b>$BLOBBIE coins</b> 🪙 — each adds to your score.</li>' +
      '<li><b>Ranked PvP:</b> both players race the exact same track. Highest score (distance + coins) wins the pool and posts to the leaderboard.</li>' +
      '<li><b>Friends:</b> create a room code for a free, casual race.</li>' +
      '</ul>');
  }

  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------------- DOM wiring ----------------
  function wireEvents() {
    $('btnRegister').onclick = doRegister;
    $('usernameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });

    Array.from(document.querySelectorAll('.mode-card')).forEach((c) => {
      c.onclick = () => chooseMode(c.dataset.mode);
    });

    $('btnLeaderboard').onclick = () => openLeaderboard('week');
    $('btnTournament').onclick = openTournament;
    $('btnHowto').onclick = openHowto;
    $('modalClose').onclick = closeModal;
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

    $('btnCancelLobby').onclick = cancelLobby;
    $('btnCreateRoom').onclick = () => { Net.send('room:create'); };
    $('btnJoinRoom').onclick = () => {
      const code = $('joinCodeInput').value.trim().toUpperCase();
      if (code.length !== 4) { toast('Enter a 4-letter code.'); return; }
      Net.send('room:join', { code });
    };
    $('btnStartRoom').onclick = () => { Net.send('room:start'); };

    $('btnQuit').onclick = quitGame;
    $('btnPause').onclick = pauseGame;
    $('btnResume').onclick = resumeGame;
    $('btnPauseQuit').onclick = quitGame;
    window.addEventListener('keydown', (e) => {
      if (!$('screen-game').classList.contains('active')) return;
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        if ($('pauseOverlay').classList.contains('hidden')) pauseGame(); else resumeGame();
      }
    });
    $('btnBackMenu').onclick = () => { state.match = null; state.mode = null; showScreen('menu'); refreshMe(); };
    $('btnPlayAgain').onclick = () => { const m = state.mode || 'solo'; state.match = null; chooseMode(m); };

    $('btnCopyCode').onclick = () => {
      const code = $('roomCode').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Code copied!'));
      else toast('Code: ' + code);
    };

    // on-screen touch buttons
    Array.from(document.querySelectorAll('.tc')).forEach((b) => {
      const act = b.dataset.act;
      b.addEventListener('click', (e) => { e.preventDefault(); if (state.game) state.game.action(act); });
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
