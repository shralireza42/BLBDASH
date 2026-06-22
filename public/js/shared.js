/*
 * Blobbie Dash - shared game logic.
 *
 * This module is loaded both in the browser (as `window.BlobbieShared`) and in
 * Node on the server (via require) so the procedurally generated course is
 * IDENTICAL for both players in a PvP match given the same seed. That keeps the
 * competition perfectly fair: same obstacles, same coins, same difficulty.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BlobbieShared = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Core tunables ------------------------------------------------------
  const LANES = 3;                 // 3-lane runner (Subway-Surfers style)
  const LANE_OFFSETS = [-1, 0, 1]; // logical lane positions
  const CHUNK_LEN = 26;            // world units between obstacle rows
  const WARMUP_CHUNKS = 4;         // empty chunks at the very start
  const COIN_VALUE = 5;            // $BLOBBIE per coin collected (in-run)

  const OBSTACLES = ['jump', 'slide', 'block'];

  // ---- Deterministic PRNG -------------------------------------------------
  // mulberry32 - tiny, fast, good enough for course gen.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(seed, index) {
    // Combine seed + chunk index into a fresh, order-independent PRNG seed so
    // both clients can lazily generate any chunk and always agree.
    let h = (seed ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function normalizeSeed(seed) {
    if (typeof seed === 'string') {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }
    return (seed >>> 0) || 1;
  }

  // Difficulty grows with distance: obstacles get denser & speed faster.
  function difficultyAt(distance) {
    // 0 .. 1 ramp over ~3500 units, then plateaus.
    return Math.min(1, distance / 3500);
  }

  function speedAt(distance) {
    const BASE = 18;   // world units / second at start
    const MAX = 46;
    return BASE + (MAX - BASE) * difficultyAt(distance);
  }

  /**
   * Generate the contents of a chunk. Pure function of (seed, index).
   * Returns array of entities: { dist, lane, type, h, id }
   *  - type: 'jump' (low hurdle), 'slide' (overhead), 'block' (full wall), 'coin'
   *  - h: height for floating coins (0 = ground)
   */
  function getChunk(seed, index) {
    const out = [];
    if (index < WARMUP_CHUNKS) {
      // gentle intro: just a few ground coins so the player learns to collect
      if (index >= 1) {
        const lane = (index % LANES);
        for (let k = 0; k < 4; k++) {
          out.push({
            id: index * 100 + k,
            dist: index * CHUNK_LEN + 6 + k * 4,
            lane, type: 'coin', h: 0,
          });
        }
      }
      return out;
    }

    const rng = mulberry32(hashSeed(seed, index));
    const baseDist = index * CHUNK_LEN;
    const diff = difficultyAt(baseDist);

    // How many obstacle lanes this row blocks (never all 3, always a path).
    const maxBlocked = diff > 0.55 ? 2 : 1;
    const blockCount = 1 + (rng() < (0.25 + diff * 0.45) ? 1 : 0);
    const blocked = Math.min(blockCount, maxBlocked);

    const laneOrder = [0, 1, 2].sort(() => rng() - 0.5);
    const usedLanes = laneOrder.slice(0, blocked);
    const freeLanes = laneOrder.slice(blocked);

    usedLanes.forEach((lane, i) => {
      const r = rng();
      let type;
      if (r < 0.4) type = 'jump';
      else if (r < 0.72) type = 'slide';
      else type = 'block';
      out.push({
        id: index * 100 + i,
        dist: baseDist + 13,
        lane, type, h: 0,
      });
    });

    // Coins: lay a line / small arc in a free lane.
    const coinLane = freeLanes.length ? freeLanes[(rng() * freeLanes.length) | 0] : laneOrder[0];
    const arc = rng() < 0.4; // arc coins reward jumping
    const count = 3 + ((rng() * 4) | 0);
    for (let k = 0; k < count; k++) {
      const t = k / Math.max(1, count - 1);
      out.push({
        id: index * 100 + 20 + k,
        dist: baseDist + 4 + k * 3,
        lane: coinLane,
        type: 'coin',
        h: arc ? Math.sin(t * Math.PI) * 2.4 : 0,
      });
    }
    return out;
  }

  function makeRandomSeed() {
    return (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0) || 1;
  }

  return {
    LANES, LANE_OFFSETS, CHUNK_LEN, WARMUP_CHUNKS, COIN_VALUE, OBSTACLES,
    mulberry32, normalizeSeed, difficultyAt, speedAt, getChunk, makeRandomSeed,
  };
});
