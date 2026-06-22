# Character frames — PNG version

By default the game uses the **SVG** frames in `../svg/`. To use **PNG** instead,
set this in `public/theme.js`:

```js
character: { format: 'png' }
```

Then drop your PNG frames in **this folder** using the **same names** as the SVG
frames (see `../svg/` and `../manifest.json`), e.g.:

```
run_back_frame_01.png ... run_back_frame_08.png
jump_back_frame_01.png ... jump_back_frame_06.png
jump_slide_sit_mix_back_frame_01.png ... _06.png
move_left_back_frame_01.png ... _06.png
move_right_back_frame_01.png ... _06.png
```

Notes:
- Use transparent PNGs.
- If a PNG is missing, the game falls back to the matching SVG automatically (and
  finally to `assets/blobbie.svg`), so nothing breaks while you swap.
- Open `/assets/character/preview.html` to see the frame names.
