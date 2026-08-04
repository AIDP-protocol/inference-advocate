#!/usr/bin/env node
// One-shot rasteriser for the Inference Advocate app icon family.
// Source mark: packages/ui/src/icons/inference-advocate.svg on a solid background
// (readable at favicon sizes; transparent marks wash out on browser chrome).
// Writes web icons under packages/ui/public and a master PNG for Tauri.
//
// Needs @resvg/resvg-js, sharp, and png-to-ico resolvable from this file
// (e.g. npm install those into tools/, or NODE_PATH to a temp install).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const root = process.env.AIRP_REPO_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const uiPublic = join(root, 'packages/ui/public');
const desktopIcons = join(root, 'packages/desktop/src-tauri/icons');

// Dark cool charcoal from the instrument drawer family (oklch ~0.245 0.010 255).
// White strokes on this ground stay legible at 16px.
const BG = '#252a33';
const FG = '#ffffff';

const MARK_PATHS = `
  <path d="M3.6 3.4 H20.4 V12.8 C20.4 17.6 16.4 20.9 12 22.4 C7.6 20.9 3.6 17.6 3.6 12.8 Z"/>
  <path d="M12 2.9 V19.7" stroke-dasharray="4.2 2.1" stroke-linecap="butt"/>
`;

function appIconSvg(size, { padding = 0.18 } = {}) {
  const pad = size * padding;
  const scale = (size - pad * 2) / 24;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${pad} ${pad}) scale(${scale})"
     fill="none" stroke="${FG}" stroke-width="2.1"
     stroke-linecap="round" stroke-linejoin="round">
    ${MARK_PATHS}
  </g>
</svg>`;
}

function wideTileSvg(w, h, markSize) {
  const x = (w - markSize) / 2;
  const y = (h - markSize) / 2;
  const scale = markSize / 24;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <g transform="translate(${x} ${y}) scale(${scale})"
     fill="none" stroke="${FG}" stroke-width="2.1"
     stroke-linecap="round" stroke-linejoin="round">
    ${MARK_PATHS}
  </g>
</svg>`;
}

function raster(svg) {
  return Buffer.from(new Resvg(svg).render().asPng());
}

async function writePng(path, svg, labelW, labelH = labelW) {
  const png = await sharp(raster(svg)).png().toBuffer();
  writeFileSync(path, png);
  console.log('wrote', path.replace(root + '/', ''), `${labelW}x${labelH}`);
  return png;
}

mkdirSync(uiPublic, { recursive: true });
mkdirSync(desktopIcons, { recursive: true });

writeFileSync(join(uiPublic, 'favicon.svg'), appIconSvg(32, { padding: 0.14 }));

const pinned = readFileSync(join(root, 'packages/ui/src/icons/inference-advocate.svg'), 'utf8')
  .replace(/stroke="currentColor"/g, 'stroke="#000000"')
  .replace(/fill="currentColor"/g, 'fill="#000000"')
  .replace(/\s*<title>[\s\S]*?<\/title>/, '');
writeFileSync(join(uiPublic, 'safari-pinned-tab.svg'), pinned);

const sizes = {
  'favicon-16x16.png': { size: 16, padding: 0.12 },
  'favicon-32x32.png': { size: 32, padding: 0.14 },
  'apple-touch-icon.png': { size: 180, padding: 0.18 },
  'android-chrome-192x192.png': { size: 192, padding: 0.18 },
  'android-chrome-512x512.png': { size: 512, padding: 0.18 },
  'mstile-70x70.png': { size: 70, padding: 0.16 },
  'mstile-144x144.png': { size: 144, padding: 0.18 },
  'mstile-150x150.png': { size: 150, padding: 0.18 },
  'mstile-310x310.png': { size: 310, padding: 0.18 },
  'android-chrome-maskable-192x192.png': { size: 192, padding: 0.22 },
  'android-chrome-maskable-512x512.png': { size: 512, padding: 0.22 },
};

for (const [name, { size, padding }] of Object.entries(sizes)) {
  await writePng(join(uiPublic, name), appIconSvg(size, { padding }), size);
}

const icoBufs = [];
for (const s of [16, 32, 48]) {
  icoBufs.push(await sharp(raster(appIconSvg(s, { padding: 0.12 }))).png().toBuffer());
}
writeFileSync(join(uiPublic, 'favicon.ico'), await pngToIco(icoBufs));
console.log('wrote packages/ui/public/favicon.ico');

await writePng(join(uiPublic, 'mstile-310x150.png'), wideTileSvg(310, 150, 96), 310, 150);

writeFileSync(
  join(uiPublic, 'site.webmanifest'),
  JSON.stringify(
    {
      name: 'Inference Advocate',
      short_name: 'Advocate',
      description: 'Local inference advocate for the Accountable Inference Delivery Protocol',
      start_url: './',
      display: 'standalone',
      background_color: BG,
      theme_color: BG,
      icons: [
        {
          src: './android-chrome-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: './android-chrome-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: './android-chrome-maskable-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable',
        },
        {
          src: './android-chrome-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    null,
    2,
  ) + '\n',
);

writeFileSync(
  join(uiPublic, 'browserconfig.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square70x70logo src="./mstile-70x70.png"/>
      <square150x150logo src="./mstile-150x150.png"/>
      <square310x310logo src="./mstile-310x310.png"/>
      <wide310x150logo src="./mstile-310x150.png"/>
      <TileColor>${BG}</TileColor>
    </tile>
  </msapplication>
</browserconfig>
`,
);

const master = await writePng(
  join(uiPublic, 'app-icon-1024.png'),
  appIconSvg(1024, { padding: 0.18 }),
  1024,
);
writeFileSync(join(desktopIcons, 'icon.png'), await sharp(master).resize(512, 512).png().toBuffer());
console.log('wrote packages/desktop/src-tauri/icons/icon.png (512)');
console.log('done');
