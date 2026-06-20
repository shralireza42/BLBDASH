#!/usr/bin/env node
/*
 * Generates placeholder SVG art for every entry in
 * public/assets/character/manifest.json, at the exact `export_size` of each
 * piece. These are stand-ins so the game runs out of the box — replace the
 * files in public/assets/character/svg with your own SVG exports of the same
 * name + size and everything keeps working.
 *
 * This project is SVG-only (vector art scales crisply at any size and supports
 * full alpha). Usage:  node scripts/gen-character-placeholders.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'assets', 'character');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const GROUP = {
  top_full_body: { fill: '#ef7a8b', label: '#7a1f2b', kind: 'body' },
  middle_pose:   { fill: '#7b4dff', label: '#22104f', kind: 'body' },
  middle_head:   { fill: '#ffd23f', label: '#7a5800', kind: 'head' },
  bottom_asset:  { fill: '#39d98a', label: '#0b4d31', kind: 'gem' },
};

function esc(s) { return String(s).replace(/_/g, ' '); }

function bodySvg(w, h, g, name) {
  const cx = w / 2;
  return `
  <path d="M ${cx} ${h*0.06}
           C ${w*0.97} ${h*0.04}, ${w*1.02} ${h*0.62}, ${w*0.8} ${h*0.9}
           C ${w*0.64} ${h*1.0}, ${w*0.36} ${h*1.0}, ${w*0.2} ${h*0.9}
           C ${w*-0.02} ${h*0.62}, ${w*0.03} ${h*0.04}, ${cx} ${h*0.06} Z"
        fill="${g.fill}" stroke="#1d1d28" stroke-width="${Math.max(2, w*0.018)}"/>
  <ellipse cx="${cx - w*0.16}" cy="${h*0.34}" rx="${w*0.1}" ry="${h*0.07}" fill="#fff" stroke="#1d1d28" stroke-width="2"/>
  <ellipse cx="${cx + w*0.16}" cy="${h*0.34}" rx="${w*0.1}" ry="${h*0.07}" fill="#fff" stroke="#1d1d28" stroke-width="2"/>
  <circle cx="${cx - w*0.14}" cy="${h*0.35}" r="${w*0.045}" fill="#1d1d28"/>
  <circle cx="${cx + w*0.18}" cy="${h*0.35}" r="${w*0.045}" fill="#1d1d28"/>
  <path d="M ${cx - w*0.14} ${h*0.5} Q ${cx} ${h*0.58} ${cx + w*0.14} ${h*0.5}"
        fill="none" stroke="${g.label}" stroke-width="${Math.max(3, w*0.03)}" stroke-linecap="round"/>`;
}

function headSvg(w, h, g) {
  const cx = w / 2, cy = h / 2;
  return `
  <ellipse cx="${cx}" cy="${cy}" rx="${w*0.44}" ry="${h*0.42}" fill="${g.fill}" stroke="#1d1d28" stroke-width="3"/>
  <circle cx="${cx - w*0.16}" cy="${cy - h*0.05}" r="${w*0.08}" fill="#fff" stroke="#1d1d28" stroke-width="2"/>
  <circle cx="${cx + w*0.16}" cy="${cy - h*0.05}" r="${w*0.08}" fill="#fff" stroke="#1d1d28" stroke-width="2"/>
  <circle cx="${cx - w*0.14}" cy="${cy - h*0.04}" r="${w*0.035}" fill="#1d1d28"/>
  <circle cx="${cx + w*0.18}" cy="${cy - h*0.04}" r="${w*0.035}" fill="#1d1d28"/>
  <path d="M ${cx - w*0.13} ${cy + h*0.16} Q ${cx} ${cy + h*0.26} ${cx + w*0.13} ${cy + h*0.16}"
        fill="none" stroke="${g.label}" stroke-width="3" stroke-linecap="round"/>`;
}

function gemSvg(w, h, g) {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.4;
  return `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${g.fill}" stroke="#1d1d28" stroke-width="3"/>
  <text x="${cx}" y="${cy + r*0.32}" font-family="system-ui, sans-serif" font-weight="800"
        font-size="${r}" fill="${g.label}" text-anchor="middle">B</text>`;
}

function buildSvg(item) {
  const [w, h] = item.export_size;
  const g = GROUP[item.group] || GROUP.bottom_asset;
  let inner;
  if (g.kind === 'head') inner = headSvg(w, h, g);
  else if (g.kind === 'gem') inner = gemSvg(w, h, g);
  else inner = bodySvg(w, h, g, item.name);
  const fontSize = Math.max(8, Math.min(w * 0.11, 16));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${Math.min(w, h) * 0.08}"
        fill="${g.fill}" fill-opacity="0.10" stroke="${g.fill}" stroke-opacity="0.6"
        stroke-width="2" stroke-dasharray="6 5"/>
  ${inner}
  <text x="${w / 2}" y="${h - 6}" font-family="system-ui, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="${g.label}" text-anchor="middle">${esc(item.name)}</text>
</svg>`;
}

let svgN = 0;
for (const item of manifest) {
  const svg = buildSvg(item);
  const svgPath = path.join(ROOT, item.svg);
  fs.mkdirSync(path.dirname(svgPath), { recursive: true });
  fs.writeFileSync(svgPath, svg);
  svgN++;
}
console.log(`Wrote ${svgN} SVG placeholders.`);
