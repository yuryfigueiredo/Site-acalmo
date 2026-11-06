import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const routes = ['/sons/ruido-marrom/', '/sons/chuva/', '/respiracao/quadrada/', '/respiracao/4-7-8/', '/foco/50-minutos/'];
const titles = new Set();
const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');

for (const route of routes) {
  const html = await readFile(path.join(root, route, 'index.html'), 'utf8');
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  const words = main.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 300, route + ' precisa de texto editorial com 300+ palavras, tem ' + words);
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(!titles.has(title), route + ' repete título de outra página');
  titles.add(title);
  assert.ok(html.includes('"@type":"WebApplication"'), route + ' precisa de schema WebApplication');
  assert.ok(html.includes('"@type":"BreadcrumbList"'), route + ' precisa de breadcrumb estruturado');
  assert.ok(html.includes('188') && html.includes('cvv.org.br'), route + ' precisa do aviso CVV 188');
  assert.ok(html.includes(`rel="canonical" href="https://www.acalmo.com.br${route}"`), route + ' canonical incorreto');
  assert.ok(sitemap.includes(`<loc>https://www.acalmo.com.br${route}</loc>`), route + ' ausente do sitemap');
  assert.ok(!/cura|garante|tratamento definitivo/i.test(main.replace(/não cura|não trata|não substitui|não garante/g, '')), route + ' faz promessa de cura');
}
console.log('Tools: 5 páginas com 300+ palavras, títulos únicos, WebApplication, breadcrumb, CVV 188, canonical e sitemap verificados.');