# UI background textures (buttons & panels)

Drop your own images here (PNG, JPG or SVG) and reference them in
`public/theme.js` under `ui`:

```js
ui: {
  buttonTexture: 'assets/ui/button.png', // shows behind every button
  cardTexture:   'assets/ui/panel.png',  // shows behind menu/result panels & mode cards
}
```

Leave a value `null` to keep the painted color/gradient. Images are scaled to
**cover** each element (so use a roughly button/panel-shaped or tileable image).
The button text color still comes from `ui.ink` / `ui.text`, so pick a texture
with enough contrast.
