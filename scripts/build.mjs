import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('./content.mjs');
await import('./tools.mjs');
// Um dist/ acumulado publicaria para sempre o arquivo que saiu do src/ — e o service worker o guardaria junto.
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
await cp(path.join(root, 'src'), path.join(root, 'dist'), { recursive: true });
const files = [];
async function walk(dir, relative='') { for (const entry of await readdir(dir, { withFileTypes:true })) { const rel=relative+'/'+entry.name; if(entry.isDirectory()) await walk(path.join(dir,entry.name),rel); else if(entry.name!=='sw.js') files.push(rel); } }
await walk(path.join(root,'src'));
files.sort();
const hash=createHash('sha256');
for (const file of files) { hash.update(file); hash.update(await readFile(path.join(root,'src',file))); }
const releaseHash=hash.digest('hex').slice(0,12);
// Fingerprint the entry files and relative module imports as one coherent release.
// This also prevents an older local HTTP/service-worker cache from mixing effects.
for(const file of files){
  if(file.endsWith('.html')){
    const target=path.join(root,'dist',file);
    const source=await readFile(target,'utf8');
    await writeFile(target,source.replace(/(\/(?:assets)\/[\w.-]+\.(?:js|css))(\")/g,`$1?v=${releaseHash}$2`));
  }else if(file.endsWith('.js')){
    const target=path.join(root,'dist',file);
    const source=await readFile(target,'utf8');
    await writeFile(target,source.replace(/from\s+(['"])(\.\/[\w.-]+\.js)\1/g,`from '$2?v=${releaseHash}'`));
  }
}
const precache=files.filter(file=>!['/_headers','/robots.txt','/sitemap.xml','/404.html'].includes(file)).map(file=>file.endsWith('/index.html')?file.slice(0,-10):file);
const worker=(await readFile(path.join(root,'src/sw.js'),'utf8')).replace('__BUILD_HASH__',releaseHash).replace('__PRECACHE_FILES__',JSON.stringify(precache));
await writeFile(path.join(root,'dist/sw.js'),worker);
console.log('Site estático preparado em dist/.');
