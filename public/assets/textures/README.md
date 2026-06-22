# Texture images

Drop your own texture images here and reference them in `public/theme.js`
under `world.textures`:

```js
world: {
  textures: {
    sky:    'assets/textures/sky.png',     // stretched across the sky
    ground: 'assets/textures/grass.png',   // stretched across the grass
    road:   'assets/textures/road.png',    // drawn over the path/road
  },
}
```

The glass **tunnel** texture is configured separately under `world.tunnel.texture`
(default `assets/textures/glass.png`). It is tiled across the whole tunnel glass.

- PNG or JPG both work (PNG if you need transparency).
- Any size; images are scaled to fill their area (cover).
- Leave a value `null` in the theme to keep the painted color instead.
- If a texture file is missing the game keeps the painted look (no texture).
