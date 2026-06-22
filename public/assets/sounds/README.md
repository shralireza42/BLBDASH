# Sound files (SFX + music)

Drop your own audio here (MP3/OGG/WAV) and reference them in `public/theme.js`
under `sounds`. Leave a value `null` to keep the built-in synthesized sound.

By default `music` points to `music.mp3` and `footstep` to `footstep.mp3` in this
folder. If a file is missing the game automatically falls back to the built-in
synthesized sound (it only tries each missing file once), so audio always works —
just drop your files in to use them.

```js
sounds: {
  music: 'assets/sounds/music.mp3', // looping background track
  jump:  'assets/sounds/jump.mp3',
  coin:  'assets/sounds/coin.mp3',
  crash: 'assets/sounds/crash.mp3',
  footstep: 'assets/sounds/footstep.mp3', // repeats while running (keep it very short)
  // also: slide, lane, win, lose, click, count, go
},
```

Notes:
- Keep SFX short; keep file sizes small for mobile.
- Audio only starts after the first tap/click (browser autoplay policy).
