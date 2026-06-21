# Gameplay background images / GIFs

Drop a full-scene image or **animated GIF** here and reference it in
`public/theme.js`:

```js
gameplayBackground: 'assets/backgrounds/world.gif',
gameplayBackgroundMode: 'cover', // 'cover' (fill) or 'contain' (letterbox)
```

When set, your image/GIF is shown as the world backdrop behind the road, in
**both the menu and gameplay**. GIFs animate natively. The game still draws the
road/path + props on top so the runner keeps working — your image replaces the
painted sky/scenery only.

- Use a 16:9-ish image for best results with `cover`.
- Large GIFs can be heavy on mobile; keep file size reasonable.
