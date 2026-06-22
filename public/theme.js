/* ============================================================================
 * Blobbie Dash — THEME & ASSETS
 * ----------------------------------------------------------------------------
 * Edit this ONE file to restyle the whole game. Change colors here and the
 * UI (buttons / text / page background) and the canvas game world (sky, ground,
 * road/path, mountains, trees, coins, obstacles) update automatically.
 *
 * You can also drop in your own texture images and even an animated GIF as the
 * gameplay background (see `textures` and `gameplayBackground` below).
 *
 * Tips:
 *  - Colors are normal CSS color strings ('#rrggbb', 'rgba(...)', etc.).
 *  - Anything you leave out falls back to the built-in default.
 *  - Put image files under public/assets/textures/ and public/assets/backgrounds/
 *    then reference them with a path RELATIVE to /public, e.g.
 *    'assets/textures/road.png' or 'assets/backgrounds/world.gif'.
 * ==========================================================================*/
window.BlobbieTheme = {

  /* ---------------------------------------------------------------- UI ----
   * Buttons, text and page/menu background colors (HTML/CSS).
   */
  ui: {
    text:        '#f3fff0',   // main text color
    muted:       '#cfeecb',   // secondary / muted text
    ink:         '#143018',   // dark ink (primary button text)
    pageBgTop:   '#bfe9ff',   // page background gradient (top)
    pageBgBottom:'#7fc4ff',   // page background gradient (bottom)
    accentCyan:  '#34c2e6',   // primary accent (button gradient start, glows)
    accentCyanLight: '#bff0ff',
    accentPink:  '#ff8fb8',   // secondary accent (button gradient end)
    accentPinkDark: '#e76fa0',
    accentPurple:'#8a7bff',
    accentPurpleLight: '#b0a8ff',
    accentGreen: '#5fd06a',
    gold:        '#ffd23f',   // $BLOBBIE / coin accent
    cardBg:      'rgba(16, 38, 26, 0.42)',   // glass panel background
    cardBorder:  'rgba(140, 240, 170, 0.34)',// glass panel border

    // Optional BACKGROUND IMAGES/TEXTURES for the UI (PNG/JPG/SVG). Leave null
    // to use the colors above. Drop files in public/assets/ui/.
    buttonTexture: null, // image behind every button, e.g. 'assets/ui/button.png'
    cardTexture:   null, // image behind panels/cards, e.g. 'assets/ui/panel.png'
  },

  /* ------------------------------------------------------------- WORLD ----
   * The canvas game world (shared by menu + gameplay).
   * Arrays are gradients/layers ordered far -> near (top -> bottom).
   */
  world: {
    sky:           ['#3aa0ff', '#8fd0ff', '#e6f6ff'], // sky gradient (top..horizon)
    sunGlow:       '#ffeea0',
    sunCore:       '#fffce1',
    ground:        ['#7ed06a', '#56b256', '#2f8f43'], // grass gradient
    hill:          '#69c25f',
    mountainFar:   '#9fb8da',
    mountainSnow:  '#ffffff',
    mountainNear:  '#4f9e5a',
    path:          ['#cda978', '#dcbe8c', '#e9d2a4'], // tunnel FLOOR gradient (the running surface)
    pathBorder:    '#3f9a46',  // ground just outside the tunnel
    pathRim:       '#bdf0ff',  // bright rim line where the glass wall meets the floor
    fence:         '#9c6b3f',  // (legacy) side fences

    // Blur the whole BACKGROUND (outside world) so the tunnel interior stays in
    // focus. 0 = sharp; higher = blurrier. (Also blurs a GIF backdrop.)
    backgroundBlur: 5,

    // Liquid-glass TUNNEL the player runs inside (translucent — you see outside).
    tunnel: {
      glass:  'rgba(150, 225, 255, 0.12)', // translucent glass body (low alpha = see-through)
      glassTop:'rgba(120, 210, 255, 0.20)',// glass near the ceiling (slightly stronger)
      rib:    'rgba(190, 245, 255, 0.55)', // the tube "ribs" (glass rings)
      gloss:  'rgba(255, 255, 255, 0.6)',  // moving glass highlights / shine
      rim:    '#9fe9ff',                    // neon wall-base line along the floor edges
      height: 1.6,  // tunnel HEIGHT (taller arch). 1 = low, higher = taller.
      width:  1.0,  // tunnel WIDTH (relative to the road). >1 = wider than the road.
      texture: 'assets/textures/glass.png', // image tiled across the WHOLE tunnel glass (none if missing)
      textureAlpha: 0.5,
    },
    laneLine:      'rgba(120,90,50,0.35)', // lane divider color
    archVine:      '#2f8f48',  // overhead vine archway color
    blossom:       ['#ff9ed1', '#ffe27a', '#bfe0ff'], // flower colors
    treeTrunk:     '#7a5230',
    treeCanopy:    ['#2f8f48', '#3aa657', '#56c46a'],
    bird:          'rgba(40,55,80,0.8)',
    firefly:       'rgba(220,255,160,1)',
    pollen:        'rgba(255,250,210,0.7)',

    /* Optional TEXTURE IMAGES. Leave null to use the colors above.
     * Drop files in public/assets/textures/ and set the path here.
     * (sky/ground are stretched to fit; road is drawn over the path.)        */
    textures: {
      sky:    null, // e.g. 'assets/textures/sky.png'
      ground: null, // e.g. 'assets/textures/grass.png'
      road:   null, // e.g. 'assets/textures/road.png'
    },
  },

  /* -------------------------------------------------------------- COIN ----
   * The collectible $BLOBBIE coin colors.
   */
  coin: {
    core: '#fff6cf', mid: '#ffd23f', edge: '#e0951f',
    rim: '#b9731a', text: '#7a4d10', glow: '#ffcf4d',
  },

  /* --------------------------------------------------------- OBSTACLES ----
   * Colors used by the nature obstacles.
   */
  obstacles: {
    rock: '#8d8f97', moss: '#5fb85a',
    log: '#9c6b3f', logEnd: '#c79a63',
    branch: '#7a5230', leaf: '#3aa657', vine: '#2f8f48',
    treeTrunk: '#7a5230', treeCanopy: ['#2f8f48', '#3aa657', '#56c46a'],
    boulder: '#9a9ca3',
  },

  // Scrolling speed-lines on the road (motion feel). Set to null to hide them.
  speedLine: 'rgba(255,250,225,0.32)',

  /* ------------------------------------------------------------- CAMERA ----
   * How close the camera sits to Blobbie. 1 = default; higher = closer/zoomed-in
   * (Blobbie and obstacles look bigger), lower = pulled back. Range ~0.8–2.2.
   */
  camera: {
    zoom: 1.25,    // closeness to Blobbie (1 = default, higher = closer)
    // Camera angle / tilt: where the horizon sits (fraction of screen height).
    // LOWER = camera looks more DOWN (more floor / top-down), HIGHER = flatter.
    // Range ~0.15–0.55.
    horizon: 0.30,
  },

  /* ---------------------------------------------------------- CHARACTER ----
   * File format for the animated player frames in assets/character/.
   *   'svg' -> loads assets/character/svg/<frame>.svg   (default)
   *   'png' -> loads assets/character/png/<frame>.png
   * The other format is tried automatically if a file is missing, so you can
   * switch any time. (To swap the art itself, drop your files in the matching
   * folder using the same frame names — see CUSTOMIZE.md.)
   */
  character: {
    format: 'png', // 'svg' or 'png'
  },

  /* ------------------------------------------------------------ SPRITES ----
   * Replace the DRAWN coin / obstacles / player with your own images (PNG, JPG,
   * SVG or animated GIF). Leave a value null to keep the built-in drawn art.
   * Drop files in public/assets/sprites/ and use a path relative to /public.
   *
   * Sizing/placement is automatic: each image is scaled to a sensible height
   * for its slot, keeping your image's aspect ratio, centered on the lane.
   */
  sprites: {
    coin: null,   // e.g. 'assets/sprites/coin.png' (spins automatically)

    // OBSTACLES. Easiest: set by what the player must DO:
    obstacles: {
      jump:  'assets/sprites/jump.png',  // something to JUMP OVER  (sits on the path, low)
      slide: 'assets/sprites/slide.png', // something to SLIDE UNDER (hangs overhead)
      block: 'assets/sprites/block.png', // something to DODGE by switching lane (tall)
      // Optional finer control — these OVERRIDE the type above per variant:
      rock: null, log: null,      // (jump variants)
      branch: null, arch: null,   // (slide variants)
      tree: null, boulder: null,  // (block variants)
    },

    // Single image used for the player in ALL states (simple mode). For full
    // animation, replace the SVG frames in assets/character/ instead (see
    // CUSTOMIZE.md). Leave null to use the animation frames.
    player: null, // e.g. 'assets/sprites/player.png'
  },

  /* ------------------------------------------------------------- SOUNDS ----
   * Replace the built-in synthesized audio with your own files. Leave null to
   * keep the synth. Drop files in public/assets/sounds/.
   */
  sounds: {
    music: 'assets/sounds/music.mp3',  // looping background track (falls back to synth if missing)
    jump: null, slide: null, lane: null, coin: null, crash: null,
    win: null, lose: null, click: null, count: null, go: null,
    footstep: 'assets/sounds/footstep.mp3', // plays repeatedly while running (synth if missing)
    fence: null,    // plays when you bump a side fence
  },

  /* -------------------------------------------- GAMEPLAY BACKGROUND IMG ----
   * Set this to an image OR animated GIF to use as the world backdrop behind
   * the road (menu + gameplay). GIFs animate. When set, the canvas draws only
   * the road/path + props on top of your image, so the runner still works.
   * Example: gameplayBackground: 'assets/backgrounds/world.gif',
   */
  gameplayBackground: 'assets/backgrounds/world.gif', // image/GIF backdrop (falls back to the drawn scene if missing)
  gameplayBackgroundMode: 'cover', // 'cover' (fill) or 'contain' (letterbox)
};
