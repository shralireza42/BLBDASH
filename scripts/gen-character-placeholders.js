#!/usr/bin/env node
/*
 * Blobbie Dash — character asset generator.
 *
 * Defines the 5 frame-based animations the game uses and writes:
 *   - public/assets/character/manifest.json   (the list of every frame)
 *   - public/assets/character/svg/<frame>.svg (a labeled placeholder per frame)
 *
 * The placeholders are stand-ins so the game runs out of the box. Replace each
 * SVG in public/assets/character/svg/ with your own art OF THE SAME FILE NAME
 * and everything keeps working — the game loads strictly by these names.
 *
 * Usage:  node scripts/gen-character-placeholders.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'assets', 'character');
const SVG_DIR = path.join(ROOT, 'svg');

// ── The 5 animations (frame counts + base names exactly as required) ─────────
const ANIMATIONS = [
  { group: 'run',        base: 'run_back_frame_',                count: 8, size: [220, 340], color: '#ef7a8b' },
  { group: 'jump_back',  base: 'jump_back_frame_',               count: 6, size: [220, 360], color: '#7b4dff' },
  { group: 'jump_slide', base: 'jump_slide_sit_mix_back_frame_', count: 6, size: [264, 300], color: '#3ad0ff' },
  { group: 'move_left',  base: 'move_left_back_frame_',          count: 6, size: [240, 340], color: '#39d98a' },
  { group: 'move_right', base: 'move_right_back_frame_',         count: 6, size: [240, 340], color: '#ffd23f' },
];

const pad2 = (n) => String(n).padStart(2, '0');

// A simple BACK-VIEW runner placeholder whose pose changes per frame so the
// animation cycle is visibly animated (legs swing, body bobs / leans).
function frameSvg(item) {
  const [w, h] = item.export_size;
  const cx = w / 2;
  const n = item.frames, i = item.frame;
  const phase = (i - 1) / n;                 // 0 .. (n-1)/n
  const cyc = Math.sin(phase * Math.PI * 2); // -1 .. 1
  const bob = cyc * h * 0.035;
  const swing = Math.sin(phase * Math.PI * 2) * w * 0.10;
  let lean = 0;
  if (item.group === 'move_left') lean = -0.12 * Math.sin(phase * Math.PI);
  if (item.group === 'move_right') lean = 0.12 * Math.sin(phase * Math.PI);
  if (item.group === 'jump_back') lean = -0.05;

  const bodyTop = h * 0.16 + bob;
  const bodyH = h * (item.group === 'jump_slide' ? 0.5 : 0.62);
  const bodyW = w * 0.5;
  const legY = bodyTop + bodyH;
  const legW = w * 0.13, legH = h * 0.16;
  const ink = '#1d1d28';

  const leftLegY = legY - Math.max(0, swing);
  const rightLegY = legY - Math.max(0, -swing);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <g transform="rotate(${(lean * 57).toFixed(2)} ${cx} ${legY})">
    <!-- legs -->
    <rect x="${cx - bodyW * 0.32 - legW / 2}" y="${leftLegY}" width="${legW}" height="${legH}" rx="${legW / 2}" fill="${item.color}" stroke="${ink}" stroke-width="3"/>
    <rect x="${cx + bodyW * 0.32 - legW / 2}" y="${rightLegY}" width="${legW}" height="${legH}" rx="${legW / 2}" fill="${item.color}" stroke="${ink}" stroke-width="3"/>
    <!-- body (back view: no face) -->
    <rect x="${cx - bodyW / 2}" y="${bodyTop}" width="${bodyW}" height="${bodyH}" rx="${bodyW * 0.45}" fill="${item.color}" stroke="${ink}" stroke-width="3"/>
    <ellipse cx="${cx}" cy="${bodyTop + bodyH * 0.18}" rx="${bodyW * 0.30}" ry="${bodyH * 0.12}" fill="#ffffff" fill-opacity="0.18"/>
  </g>
  <text x="${cx}" y="${h * 0.5}" font-family="system-ui, sans-serif" font-weight="900"
        font-size="${Math.min(w, h) * 0.34}" fill="${ink}" fill-opacity="0.22" text-anchor="middle" dominant-baseline="middle">${i}</text>
  <text x="${cx}" y="${h - 8}" font-family="system-ui, sans-serif" font-weight="700"
        font-size="${Math.max(8, Math.min(w * 0.075, 13))}" fill="${item.color}" text-anchor="middle">${item.group} ${pad2(i)}</text>
</svg>`;
}

fs.mkdirSync(SVG_DIR, { recursive: true });
const manifest = [];
let n = 0;
for (const anim of ANIMATIONS) {
  for (let i = 1; i <= anim.count; i++) {
    const name = anim.base + pad2(i);
    const item = {
      name, group: anim.group, frame: i, frames: anim.count,
      export_size: anim.size, svg: 'svg/' + name + '.svg',
    };
    fs.writeFileSync(path.join(SVG_DIR, name + '.svg'), frameSvg(Object.assign({ color: anim.color }, item)));
    manifest.push(item);
    n++;
  }
}
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote manifest.json (${manifest.length} frames) and ${n} placeholder SVGs.`);
