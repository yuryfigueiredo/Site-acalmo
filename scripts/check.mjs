import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { SourceTextModule } from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const files=[];
async function walk(dir) { for(const entry of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await walk(p);else files.push(p);} }
await walk(root);
let pages=0,modules=0;
for(const file of files){
  const text=await readFile(file,'utf8');
  if(file.endsWith('.js')){new SourceTextModule(text,{identifier:file});modules++;assert.ok(!text.includes('__PRECACHE_FILES__'),'Worker precisa ser preparado');}
  if(file.endsWith('.html')){
    pages++;assert.ok(/<html[^>]*lang="pt-BR"/.test(text),file+' precisa de idioma');assert.equal([...text.matchAll(/<h1[ >]/g)].length,1,file+' precisa de um h1');
    const ids=[...text.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,file+' tem IDs duplicados');
    assert.ok(!/\$\{[A-Za-z_]/.test(text),file+' saiu do build com placeholder não interpolado');
    for(const match of text.matchAll(/\b(?:href|src)="(\/[^"#]*)(?:#[^"]*)?"/g)){let target=path.join(root,decodeURIComponent(match[1]).split('?')[0]);try{if((await stat(target)).isDirectory())target=path.join(target,'index.html');await stat(target);}catch{throw new Error(file+' aponta para recurso ausente: '+match[1]);}}
  }
}
const home=await readFile(path.join(root,'index.html'),'utf8');
for(const match of home.matchAll(/href="(https:\/\/www\.amazon\.com\.br[^" ]+)"/g)){assert.equal(new URL(match[1].replaceAll('&amp;','&')).searchParams.get('tag'),'abcinvestimen-20');}
const manifest=JSON.parse(await readFile(path.join(root,'manifest.webmanifest'),'utf8'));assert.deepEqual(manifest.icons.map(i=>i.sizes),['192x192','512x512']);
assert.ok(home.includes('Como participante do Programa de Associados da Amazon'));

// Cartões de compartilhamento: cada página indexável precisa de uma imagem que exista,
// com texto alternativo, e as ferramentas e leituras têm de usar o próprio cartão.
// A 404 fica fora: ninguém compartilha uma página de erro.
const indexable = await Promise.all(files.filter(f => f.endsWith('.html') && !f.endsWith('404.html')).map(async f => [f, await readFile(f, 'utf8')]));
let cards = 0, readings = 0;
const ORIGIN = 'https://www.acalmo.com.br';
for (const [file, text] of indexable) {
  const image = text.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  assert.ok(image, file + ' precisa de og:image');
  assert.ok(/https:\/\/www\.acalmo\.com\.br\/assets\/og-[a-z0-9-]+\.jpg$/.test(image), file + ' tem og:image fora do padrão: ' + image);
  await stat(path.join(root, 'assets', path.basename(image)));
  assert.ok(text.match(/<meta property="og:image:alt" content="[^"]{12,}"/), file + ' precisa de og:image:alt descritivo');
  const own = path.basename(image) !== 'og-cover.jpg';
  if (own) cards++;
  const url = text.match(/<meta property="og:url" content="([^"]*)"/)?.[1] || '';
  if (/^https:\/\/www\.acalmo\.com\.br\/(sons|respiracao|foco|leituras)\//.test(url)) {
    assert.ok(own, file + ' deveria apontar para um cartão próprio, não para a capa do site');
  }
  // O feed só traz leituras, então só o hub e os textos podem anunciá-lo como alternativa.
  const article = /"@type":"Article"/.test(text);
  if (article || url === ORIGIN + '/blog/') {
    assert.ok(text.includes(`<link rel="alternate" type="application/atom+xml" title="Acalmo — Leituras para desacelerar" href="${ORIGIN}/feed.xml">`), file + ' deveria anunciar o feed Atom no <head>');
  }
  if (article) readings++;
}
assert.equal(cards, 8, 'a espera eram 8 cartões próprios');

// Feed Atom: o leitor não executa nada do site, então cada endereço precisa sair absoluto e
// cada entrada precisa ter o mínimo para abrir sozinha (título, link, id e data).
const feed = await readFile(path.join(root, 'feed.xml'), 'utf8');
assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'feed.xml precisa começar pela declaração xml');
assert.ok(feed.includes('xmlns="http://www.w3.org/2005/Atom"'), 'feed.xml não está no namespace do Atom');
assert.equal((feed.match(/<entry>/g) || []).length, readings, `o feed tem outra quantidade de entradas para ${readings} leituras indexáveis`);
for (const entry of feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  assert.ok(/<title>[^<]{4,}<\/title>/.test(entry[1]), 'entrada do feed sem título');
  assert.ok(/<link href="https:\/\/www\.acalmo\.com\.br\/[^"]+"\/>/.test(entry[1]), 'entrada do feed sem link absoluto');
  assert.ok(/<id>https:\/\/www\.acalmo\.com\.br\/[^<]+<\/id>/.test(entry[1]), 'entrada do feed sem id');
  assert.ok(/<updated>\d{4}-\d{2}-\d{2}T/.test(entry[1]), 'entrada do feed sem data');
}
const resolved = feed.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
assert.ok(!/(?:href|src)="\/(?!\/)/.test(resolved), 'o feed deixou um caminho relativo: dentro do leitor isso vira link quebrado');
assert.ok(!/href="https?:\/\/[^"]*\.html"/.test(resolved), 'o feed aponta para um arquivo .html em vez de uma rota');

// IndexNow: a chave é pública e mora no raiz do site com o próprio nome — é assim que o serviço
// prova que quem avisou controla o domínio.
const keys = files.filter(f => /^[0-9a-f]{32}\.txt$/.test(path.basename(f)));
assert.equal(keys.length, 1, 'precisa de exatamente uma chave IndexNow no raiz do site');
assert.equal((await readFile(keys[0], 'utf8')).trim(), path.basename(keys[0], '.txt'), 'o arquivo da chave IndexNow precisa conter a própria chave');
console.log(`${pages} páginas e ${modules} módulos verificados: sintaxe, recursos, IDs, metadados básicos, manifesto, tag Amazon, ${cards} cartões de compartilhamento, feed Atom com ${readings} leituras e chave IndexNow.`);
