// IndexNow: avisa Bing, Yandex e Seznam de que as URLs mudaram, para elas entrarem na fila de
// rastreamento sem esperar o sitemap ser lido de novo. O Google não usa este aviso como sinal
// de indexação — para ele continuam valendo o sitemap e o Search Console.
//
// A chave é pública por design: ela precisa estar acessível em /<chave>.txt para o serviço
// provar que quem enviou o aviso controla o domínio. Não é segredo, mas só o dono do domínio
// consegue publicar esse arquivo.
import { randomBytes } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../src/assets/config.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const host = new URL(config.siteOrigin).host;

async function keyFile() {
  const found = (await readdir(srcDir)).filter(name => /^[0-9a-f]{32}\.txt$/.test(name));
  if (found.length > 1) throw new Error('há mais de uma chave IndexNow em src/: ' + found.join(', '));
  if (found.length) return found[0];
  const key = randomBytes(16).toString('hex');
  await writeFile(path.join(srcDir, `${key}.txt`), key + '\n');
  return `${key}.txt`;
}

const file = await keyFile();
const key = (await readFile(path.join(srcDir, file), 'utf8')).trim();

// Só o que o site realmente quer que rastreiem: as páginas indexáveis, exatamente como o sitemap.
const sitemap = await readFile(path.join(srcDir, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
if (!urls.length) throw new Error('o sitemap não tem URLs; rode o build antes de avisar o IndexNow');

if (process.argv.includes('--print')) {
  console.log(`chave: ${key}\narquivo: https://${host}/${file}\nurls: ${urls.length}`);
  process.exit(0);
}

const body = JSON.stringify({
  host,
  key,
  keyLocation: `https://${host}/${file}`,
  urlList: urls,
});

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body,
});
// 200 = aceito, 202 = recebido mas ainda não validado, 400 = payload errado, 422 = chave inacessível.
console.log(`IndexNow respondeu ${response.status} para ${urls.length} URLs.`);
if (response.status >= 300) {
  console.log((await response.text()).slice(0, 400));
  process.exit(1);
}
