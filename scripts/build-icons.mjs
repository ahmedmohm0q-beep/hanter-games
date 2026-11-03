// Renders PNG app icons from public/icons/logo.svg (requires `sharp`: npm i -D sharp)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/logo.svg', import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
for (const size of [192, 512]) await sharp(svg).resize(size, size).png().toFile(out(`icon-${size}.png`));
// maskable: logo inside an 80% safe zone on a solid background
const inner = await sharp(svg).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#15181B' } })
  .composite([{ input: inner, gravity: 'center' }]).png().toFile(out('maskable-512.png'));
await sharp(svg).resize(180, 180).flatten({ background: '#15181B' }).png().toFile(out('apple-touch-icon.png'));
console.log('icons written');
