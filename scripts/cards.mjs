// Share cards: one 1200x630 og:image per indexable tool and reading page.
// Copy is read back from the built page, so a card can never drift from its text.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shareImageFile, COVER_IMAGE } from './share-image.mjs';

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
// Leituras não têm cena própria: emprestam a mesma máquina de brilho, nas cores do sistema aprovado
// (bruma e brasa) em vez de um cinza inventado para o cartão.
const paperGlow = '--glow-a:#6f8c8f4d;--glow-b:#e0b85938';

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
</style></head><body><div class="card"><div class="tool-scene ${scene}" ${scene ? '' : `style="${paperGlow};background:var(--paper)"`} aria-hidden="true"></div><p class="card-kicker">${kicker}</p><h1 class="card-title">${title}</h1><p class="card-sub">${description}</p><p class="card-mark"><span>acalmo.</span><span>um lugar para desacelerar</span></p></div></body></html>`;
}

// A capa é o próprio hero: a lagoa, a tinta de noite que já existe na página e as palavras da
// página inicial. Vira horizontal porque um cartão 1200x630 não tem altura para a sombra vertical.
function coverDocument({ kicker, title, sub }) {
  return `<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><title>capa</title>
<link rel="preload" href="/assets/acalmo-serif-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/lagoon-1536.webp" as="image">
<link rel="stylesheet" href="/assets/style.css">
<style>
html,body{width:1200px;height:630px;margin:0;padding:0;overflow:hidden}
.cover{position:relative;isolation:isolate;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;padding:0 88px;box-sizing:border-box;overflow:hidden;background:var(--noite)}
.cover-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 58%}
.cover-shade{position:absolute;inset:0;background:linear-gradient(90deg,oklch(20% .05 250/.86),oklch(22% .05 250/.62) 38%,oklch(23% .048 250/.12) 72%,oklch(23% .048 250/0))}
.cover-kicker,.cover-title,.cover-sub{position:relative;z-index:2}
.cover-kicker{margin:0 0 22px;font-size:20px;letter-spacing:.09em;color:#add3d3;color:oklch(84% .04 196)}
.cover-title{margin:0;max-width:900px;font-family:var(--serif);font-weight:400;font-size:88px;line-height:1.02;letter-spacing:-.022em;color:#e8f5f4;color:oklch(96% .014 194)}
.cover-sub{margin:26px 0 0;max-width:660px;font-size:25px;line-height:1.6;color:#e1eeee;color:oklch(94% .014 198)}
.cover-mark{position:absolute;z-index:2;left:88px;bottom:52px;display:flex;align-items:baseline;gap:16px}
.cover-mark span:first-child{font-family:var(--serif);font-size:34px;letter-spacing:-3px;color:#e8f5f4;color:oklch(96% .014 194)}
</style></head><body><div class="cover"><img class="cover-photo" src="/assets/lagoon-1536.webp" alt=""><div class="cover-shade"></div><p class="cover-kicker">${kicker}</p><h1 class="cover-title">${title}</h1><p class="cover-sub">${sub}</p><p class="cover-mark"><span>acalmo.</span></p></div></body></html>`;
}

const strip = value => value.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]*>/g, '').trim();

await mkdir(join(dist, 'cards'), { recursive: true });
await mkdir(assets, { recursive: true });

const shoot = (page, out) => spawnSync(process.execPath, [
  join(root, 'scripts', 'shoot.mjs'), `${base}/cards/${basename(page, '.html')}.html`,
  '--out', out, '--width', '1200', '--height', '630', '--dpr', '1',
  '--format', 'jpeg', '--quality', '88', '--wait', '1800', '--settle', '700',
], { stdio: 'inherit' });

const made = [];

// A capa fecha o conjunto dos nove: é a nona imagem e a única que não pertence a uma rota.
const home = await readFile(join(dist, 'index.html'), 'utf8');
const cover = {
  kicker: strip(home.match(/class="hero-intro">([\s\S]*?)<\/p>/)?.[1] || ''),
  title: strip(home.match(/id="hero-title">([\s\S]*?)<\/h1>/)?.[1] || ''),
  sub: strip(home.match(/id="hero-title">[\s\S]*?<\/h1><p>([\s\S]*?)<\/p>/)?.[1] || ''),
};
if (!cover.title || !cover.sub) throw new Error('sem texto do hero em dist/index.html');
const coverPage = join(dist, 'cards', 'cover.html');
await writeFile(coverPage, coverDocument(cover));
const coverRun = shoot(coverPage, join(assets, COVER_IMAGE));
if (coverRun.status !== 0) throw new Error('cartao falhou: cover');
made.push(COVER_IMAGE);

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
    const run = shoot(page, out);
    if (run.status !== 0) throw new Error(`cartao falhou: ${slug}`);
    made.push(basename(out));
  }
}

await rm(join(dist, 'cards'), { recursive: true, force: true });
console.log(`Cartões de compartilhamento: ${made.length} gerados (${made.join(', ')}).`);
