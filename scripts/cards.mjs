// Share cards: one 1200x630 og:image per indexable tool and reading page.
// Copy is read back from the built page, so a card can never drift from its text.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shareImageFile } from './share-image.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const assets = join(root, 'src', 'assets');
const base = process.argv[2] || 'http://127.0.0.1:4173';

const groups = ['sons', 'respiracao', 'foco', 'leituras'];
const meta = (html, property) => html.match(new RegExp(`<meta property="og:${property}" content="([^"]*)"`))?.[1] || '';
const unescape = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const kickerOf = html => html.match(/class="tool-kicker">([^<]*)</)?.[1] || html.match(/class="section-kicker"[^>]*>([^<]*)</)?.[1] || 'Acalmo';
const sceneOf = html => html.match(/class="tool-scene ([a-z0-9 -]+)"/)?.[1] || '';

// Readings have no scene of their own: they borrow the same glow machinery in paper tones.
const paperGlow = '--glow-a:rgba(126,146,140,.30);--glow-b:rgba(130,116,72,.22)';

function cardDocument({ title, description, kicker, scene }) {
  return `<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><title>cartao</title>
<link rel="preload" href="/assets/acalmo-serif-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/style.css">
<link rel="stylesheet" href="/assets/tools.css">
<style>
html,body{width:1200px;height:630px;margin:0;padding:0;overflow:hidden;background:var(--surface)}
.card{position:relative;isolation:isolate;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;padding:0 88px;box-sizing:border-box}
.card .tool-scene{animation:none}
.card .tool-scene::before,.card .tool-scene::after{animation:none}
.card-kicker{margin:0 0 20px;font-size:20px;letter-spacing:.09em;color:var(--muted)}
.card-title{margin:0;max-width:940px;font-family:var(--serif);font-weight:400;font-size:78px;line-height:1.04;color:var(--ink);letter-spacing:-.01em}
.card-sub{margin:24px 0 0;max-width:780px;font-size:27px;line-height:1.5;color:var(--muted)}
.card-mark{position:absolute;left:88px;bottom:52px;display:flex;align-items:baseline;gap:16px}
.card-mark span:first-child{font-family:var(--serif);font-size:34px;color:var(--green)}
.card-mark span:last-child{font-size:17px;color:var(--muted)}
/* On the page the shape sits centered behind the widget; here the text owns the left
   column, so the geometry moves to the empty right third and never crosses a word. */
.card .scene-box::after,.card .scene-focus::after{inset:115px 120px auto auto;margin:0;width:400px;height:400px;opacity:.8}
/* Two brown glows at page intensity read as dirt in a wide, flat frame. */
.card .scene-brown{--glow-a:rgba(122,92,60,.20);--glow-b:rgba(64,46,30,.18)}
</style></head><body><div class="card"><div class="tool-scene ${scene}" ${scene ? '' : `style="${paperGlow};background:var(--paper)"`} aria-hidden="true"></div><p class="card-kicker">${kicker}</p><h1 class="card-title">${title}</h1><p class="card-sub">${description}</p><p class="card-mark"><span>acalmo.</span><span>um lugar para desacelerar</span></p></div></body></html>`;
}

await mkdir(join(dist, 'cards'), { recursive: true });
await mkdir(assets, { recursive: true });

const made = [];
for (const group of groups) {
  const dir = join(dist, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'index.html');
    if (!existsSync(file)) continue;
    const html = await readFile(file, 'utf8');
    const title = unescape(meta(html, 'title')).replace(/ — Acalmo$/, '');
    const description = unescape(meta(html, 'description'));
    if (!title || !description) { console.error(`sem og em ${group}/${name}`); continue; }
    const slug = `${group}-${name}`;
    const page = join(dist, 'cards', `${slug}.html`);
    await writeFile(page, cardDocument({ title, description, kicker: unescape(kickerOf(html)), scene: sceneOf(html) }));
    // The same mapping the page generators use, so a card can never be written under one
    // name and referenced under another.
    const out = join(assets, shareImageFile(`/${group}/${name}/`));
    const run = spawnSync(process.execPath, [
      join(root, 'scripts', 'shoot.mjs'), `${base}/cards/${slug}.html`,
      '--out', out, '--width', '1200', '--height', '630', '--dpr', '1',
      '--format', 'jpeg', '--quality', '88', '--wait', '1800', '--settle', '700',
    ], { stdio: 'inherit' });
    if (run.status !== 0) throw new Error(`cartao falhou: ${slug}`);
    made.push(basename(out));
  }
}

await rm(join(dist, 'cards'), { recursive: true, force: true });
console.log(`Cartões de compartilhamento: ${made.length} gerados (${made.join(', ')}).`);
