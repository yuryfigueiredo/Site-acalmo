// Auditoria de rastejamento local: o que um robô encontraria se começasse na página inicial.
// Roda sobre dist/ e não pede rede — serve para pegar página órfã, link quebrado e texto de
// âncora vazio antes de publicar, quando ainda dá para consertar de graça.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/assets/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const origin = config.siteOrigin;

// Âncoras que não dizem nada para quem lê a página em texto puro, nem para o buscador.
const WEAK_ANCHORS = ['aqui', 'clique aqui', 'leia mais', 'saiba mais', 'veja mais', 'ver mais',
  'link', 'veja aqui', 'confira', 'acesse', 'veja isso', 'this', 'read more', 'click here'];

async function htmlFiles(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...await htmlFiles(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    else if (entry.name.endsWith('.html')) {
      // Uma página por rota, do jeito que o navegador a pede: /sons/chuva/ e /404.
      found.push(entry.name === 'index.html'
        ? { route: `${prefix}/`, file: `${prefix}/index.html` }
        : { route: `${prefix}/${entry.name.replace(/\.html$/, '')}`, file: `${prefix}/${entry.name}` });
    }
  }
  return found;
}

// /sons/chuva/ e /sons/chuva/index.html são o mesmo documento: normaliza para não contar dois.
function normalizeRoute(href) {
  if (!href || href.startsWith('#')) return null;
  let target = href;
  try { target = new URL(href, origin).pathname; } catch { return null; }
  if (!new URL(href, origin).host.endsWith(new URL(origin).host)) return null;
  if (target.endsWith('/index.html')) target = target.slice(0, -'index.html'.length);
  else if (target.endsWith('.html')) target = target.slice(0, -'.html'.length);
  return target === '' ? '/' : (target.endsWith('/') ? target : target + '/');
}

const pages = new Map();
for (const { route, file } of await htmlFiles(root)) {
  const text = await readFile(path.join(root, file), 'utf8');
  const links = [];
  for (const m of text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attrs = m[1];
    if (/\bclass="[^"]*\bskip-link\b/.test(attrs)) continue;
    const href = attrs.match(/href="([^"]*)"/)?.[1];
    const label = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    links.push({ href, label, external: /^https?:|^mailto:/.test(href || '') && !href.startsWith(origin) });
  }
  pages.set(route, {
    text,
    links,
    canonical: text.match(/<link rel="canonical" href="([^"]*)"/)?.[1],
    ogUrl: text.match(/<meta property="og:url" content="([^"]*)"/)?.[1],
    title: text.match(/<title>([^<]*)<\/title>/)?.[1],
    robots: text.match(/<meta name="robots" content="([^"]*)"/)?.[1] || '',
    h1: (text.match(/<h1[\s>]/g) || []).length,
  });
}

const sitemapText = await readFile(path.join(root, 'sitemap.xml'), 'utf8').catch(() => '');
const sitemapRoutes = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map(m => normalizeRoute(m[1])).filter(Boolean);

// Alcance a partir da home: página que nenhum link interno alcança não é descoberta por crawling.
const seen = new Set(['/']);
const inbound = new Map([...pages.keys()].map(route => [route, []]));
const queue = ['/'];
while (queue.length) {
  const from = queue.shift();
  for (const link of pages.get(from)?.links || []) {
    if (link.external) continue;
    const to = normalizeRoute(link.href?.replace(/#.*$/, ''));
    if (!to || !pages.has(to)) continue;
    inbound.get(to).push({ from, label: link.label });
    if (!seen.has(to)) { seen.add(to); queue.push(to); }
  }
}

const problems = [];
const notes = [];

// Um link para um arquivo que existe em dist/ (feed.xml, sitemap.xml, um ícone) não é uma página:
// continuar chamando isso de quebrado faria o audit perder a credibilidade nos erros de verdade.
const arquivoReal = async route => {
  for (const candidato of [route, `${route}index.html`, `${route}.html`]) {
    try {
      if ((await stat(path.join(root, candidato.replace(/^\//, '')))).isFile()) return true;
    } catch {}
  }
  return false;
};

for (const route of pages.keys()) {
  const page = pages.get(route);
  if (route !== '/404' && !seen.has(route)) problems.push(`ÓRFÃ por crawling: ninguém aponta para ${route}`);
  if (page.h1 !== 1) problems.push(`${route} tem ${page.h1} h1 (precisa de exatamente 1)`);
  if (page.canonical && page.ogUrl && page.canonical !== page.ogUrl) problems.push(`${route}: canonical e og:url divergem`);
  if (page.canonical && !page.canonical.startsWith(origin + '/')) problems.push(`${route}: canonical fora de ${origin}`);
  const indexable = !/noindex/.test(page.robots);
  const inSitemap = sitemapRoutes.includes(route);
  if (indexable && !inSitemap) problems.push(`${route} está liberada para índice mas não no sitemap`);
  if (!indexable && inSitemap) problems.push(`${route} tem noindex mas aparece no sitemap`);
  for (const link of page.links) {
    if (link.external) continue;
    const to = normalizeRoute(link.href?.replace(/#.*$/, ''));
    if (!to) continue;
    if (!pages.has(to) && !/^\/assets\//.test(to) && !await arquivoReal(to)) problems.push(`LINK QUEBRADO ${route} → ${link.href}`);
    const words = link.label.toLowerCase().trim();
    if (!words) problems.push(`${route}: link sem texto para ${link.href}`);
    else if (WEAK_ANCHORS.includes(words)) problems.push(`ÂNCORA FRACA ${route} → ${link.href}: "${link.label}"`);
  }
}

for (const route of sitemapRoutes) if (!pages.has(route)) problems.push(`sitemap aponta para ${route}, que não existe em dist/`);

const ranking = [...pages.entries()]
  .map(([route, page]) => [route, inbound.get(route)?.length || 0, page.title])
  .sort((a, b) => b[1] - a[1]);

if (problems.length) {
  console.log('Problemas encontrados:\n' + [...new Set(problems)].map(p => '  - ' + p).join('\n') + '\n');
}
console.log('Links internos recebendo cada página (indexável primeiro):');
for (const [route, count, title] of ranking) {
  const indexed = !/noindex/.test(pages.get(route).robots);
  console.log(`  ${String(count).padStart(3)}  ${indexed ? 'índice' : 'sem índice'}  ${route}  ${(title || '').replace(' — Acalmo', '')}`);
}
const weak = [...new Set(problems.filter(p => p.startsWith('ÂNCORA')))].length;
console.log(`\n${pages.size} páginas, ${sitemapRoutes.length} no sitemap, ${pages.size - seen.size} não alcançáveis da home, ${weak} âncoras fracas.`);
process.exit(new Set(problems).size ? 1 : 0);
