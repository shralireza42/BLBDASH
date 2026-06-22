# Sprite images (coin / obstacles / player)

Drop your own images here (PNG, JPG, SVG or **animated GIF**) and reference them
in `public/theme.js` under `sprites`. Leave a value `null` to keep the built-in
drawn art.

By default the obstacle slots point to `jump.png`, `slide.png` and `block.png` in
this folder. If a file is missing the game automatically falls back to the
built-in drawn obstacle, so it always works — just drop your files in to use them.

```js
sprites: {
  coin: 'assets/sprites/coin.png',     // spins automatically
  obstacles: {
    jump:  'assets/sprites/jump.png',  // something to JUMP OVER  (low)
    slide: 'assets/sprites/slide.png', // something to SLIDE UNDER (overhead)
    block: 'assets/sprites/wall.png',  // something to DODGE       (tall)
    // optional per-variant overrides: rock, log, branch, arch, tree, boulder
  },
  player: 'assets/sprites/player.png', // optional single-image player
},
```

Notes:
- Each image is auto-scaled to a sensible height for its slot and centered on the
  lane (aspect ratio preserved). Use transparent PNG/SVG for clean edges.
- For a fully animated player, replace the SVG frames in `assets/character/`
  instead (see `CUSTOMIZE.md`).
