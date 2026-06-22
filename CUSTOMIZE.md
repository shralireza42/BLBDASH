# Customizing Blobbie Dash

**Everything visual and audible is replaceable from one file: [`public/theme.js`](public/theme.js).**
Edit it, refresh the page — done. No build step. Anything you leave `null` keeps the
built-in default, so you can change one thing at a time.

Put your media in these folders (paths in `theme.js` are relative to `/public`):

| Folder | For |
| --- | --- |
| `public/assets/sprites/` | coin, obstacle and player images |
| `public/assets/textures/` | sky / ground / road textures |
| `public/assets/backgrounds/` | full-scene image or animated GIF backdrop |
| `public/assets/sounds/` | music + sound-effect files |
| `public/assets/character/` | the animated player (SVG frames) |

Supported image formats: **PNG, JPG, SVG, and animated GIF**. Audio: **MP3/OGG/WAV**.

---

## 1. UI colors (buttons, text, page background)

`theme.ui.*` — these map to the whole interface.

| Key | Affects |
| --- | --- |
| `text`, `muted` | text colors |
| `ink` | dark text on bright buttons |
| `pageBgTop`, `pageBgBottom` | page/menu background gradient (behind the game) |
| `accentCyan`, `accentCyanLight` | primary accent, button gradient start, glows |
| `accentPink`, `accentPinkDark` | secondary accent, button gradient end |
| `accentPurple`, `accentPurpleLight` | extra accent |
| `accentGreen` | success / leaf accent |
| `gold` | coin / $BLOBBIE accent |
| `cardBg`, `cardBorder` | glass panels (menu cards, HUD, modals) |

```js
ui: { accentCyan: '#ff7a59', accentPink: '#ffd23f', text: '#fff', /* ... */ }
```

## 2. Game world colors (sky, mountains, road, trees…)

`theme.world.*`. Arrays are gradients/layers (top → bottom / far → near).

`sky`, `sunGlow`, `sunCore`, `ground`, `hill`, `mountainFar`, `mountainSnow`,
`mountainNear`, `path`, `pathBorder`, `pathRim`, `fence` (side fences), `laneLine`,
`archVine`, `blossom`, `treeTrunk`, `treeCanopy`, `bird`, `firefly`, `pollen`.

> Gameplay note: the road has side **fences**. Bumping a fence (pressing toward the
> edge while already in the outer lane) once shows a warning; a **second** bump ends
> the run. The bump uses `theme.sounds.fence` (or the built-in synth).

```js
world: { sky: ['#1b1033', '#3a1d6e', '#6a2fb0'], path: ['#3a2a55', '#4a356e', '#5a4080'] }
```

## 3. Textures (images over sky / ground / road)

`theme.world.textures` — drop files in `public/assets/textures/`.

```js
world: { textures: {
  sky:    'assets/textures/sky.png',
  ground: 'assets/textures/grass.png',
  road:   'assets/textures/road.png',
} }
```

## 4. Coin

Color it via `theme.coin.{core,mid,edge,rim,text,glow}`, **or** replace it entirely
with your own image/GIF (it auto-spins):

```js
sprites: { coin: 'assets/sprites/coin.png' }
```

## 5. Obstacles

Re-color via `theme.obstacles.*`, **or** replace with your own images. Easiest is by
**what the player must do**:

```js
sprites: { obstacles: {
  jump:  'assets/sprites/jump.png',   // sits on the path  -> JUMP OVER
  slide: 'assets/sprites/slide.png',  // hangs overhead    -> SLIDE UNDER
  block: 'assets/sprites/wall.png',   // tall              -> DODGE (change lane)
} }
```

Finer control (these override the type above): `rock`, `log` (jump variants),
`branch`, `arch` (slide variants), `tree`, `boulder` (block variants).

Images are auto-sized for their slot and centered on the lane; aspect ratio is kept.

## 6. Player (Blobbie)

Two options:

**A. Single image (simplest):**
```js
sprites: { player: 'assets/sprites/player.png' }
```

**B. Full animation (recommended):** replace the character frames keeping the same
file names. The 5 animations are run / jump / slide / move-left / move-right. Open
`/assets/character/preview.html` to see every frame and the input→animation map.

Choose the **file format** in `theme.js`:
```js
character: { format: 'svg' } // or 'png'
```
- `svg` (default) → frames load from `public/assets/character/svg/<frame>.svg`
- `png`           → frames load from `public/assets/character/png/<frame>.png`

The other format is tried automatically if a file is missing, so you can switch any
time or even mix. To change frame counts/timing, edit `ANIM` in
[`public/js/character.js`](public/js/character.js). Final fallback if a frame is
absent: `assets/blobbie.svg` (or `assets/blobbie.png`).

## 7. Sounds & music

Replace the built-in synthesized audio with your own files (`theme.sounds.*`):

```js
sounds: {
  music: 'assets/sounds/music.mp3',  // loops
  jump: 'assets/sounds/jump.mp3', coin: 'assets/sounds/coin.mp3', crash: 'assets/sounds/crash.mp3',
  footstep: 'assets/sounds/footstep.mp3', // plays repeatedly while running
  // also: slide, lane, win, lose, click, count, go
}
```

`footstep` plays on a cadence while Blobbie runs on the ground (the rhythm speeds up
with the game). It's a soft synth tap by default — set a file to replace it.

## 8. Gameplay background (image or animated GIF)

Use a full scene / GIF as the backdrop behind the road (menu + gameplay). It
animates; the engine draws the road + props on top so the runner still works.

```js
gameplayBackground: 'assets/backgrounds/world.gif',
gameplayBackgroundMode: 'cover', // or 'contain'
```

## 9. Speed lines & effects

- `theme.speedLine` — the scrolling motion lines on the road (a color, or `null` to hide).
- Coin-pickup sparks / crash particles use the coin & obstacle colors above.

---

### Tips
- Keep transparent PNG/SVG for clean sprite edges.
- Keep GIF/audio file sizes small for smooth mobile play.
- Mix and match: e.g. keep the drawn world but swap only the coin and music.
