// O :root declara cada cor duas vezes: um hex para o Android antigo e um oklch por cima.
// Se os dois não forem a mesma cor, o visitante de WebView antiga vê outro site. Este script
// converte cada oklch de volta para sRGB e exige que bata com o hex que está ao lado dele.
// O hex é a especificação (foi nele que o contraste foi medido); `--fix` reajusta o oklch.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/assets/style.css');
let css = await readFile(cssPath, 'utf8');

const toLinear = x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
const toGamma = x => x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
const scale = v => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255);

function oklchToRgb(l, c, h) {
  const a = Math.cos(h * Math.PI / 180) * c;
  const b = Math.sin(h * Math.PI / 180) * c;
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309660800 * S,
    -1.2684380046 * L + 2.6097572791 * M - 0.3413193963 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S,
  ].map(scale);
}

function hexToOklch(hex) {
  const rgb = [1, 3, 5].map(i => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const [l, m, s] = rgb.map((v, i) => Math.cbrt([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
  ][i].reduce((sum, k, j) => sum + k * rgb[j], 0)));
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757873 * s;
  const H = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  return [L, Math.hypot(A, B), H];
}

// Régua: sem isso aqui, qualquer conclusão sobre "a mesma cor" está errada por construção.
assert.deepEqual(oklchToRgb(...hexToOklch('#808080')).map(v => v.toString(16)), ['80', '80', '80'], 'a conversão precisa voltar em si mesma');
assert.deepEqual(oklchToRgb(1, 0, 0), [255, 255, 255], 'oklch 100% sem croma é branco');
assert.deepEqual(oklchToRgb(0, 0, 0), [0, 0, 0], 'oklch 0% é preto');

const blocks = [...css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)].filter(([, sel]) => /^:root(\[data-theme=dark\])?$/.test(sel.trim()));
assert.ok(blocks.length >= 2, 'esperava os blocos :root claro e escuro');

let compared = 0, fixed = 0;
const drifted = [];
for (const [, selector, body] of blocks) {
  const theme = selector.includes('dark') ? 'escuro' : 'claro';
  const pairs = new Map();
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6}|oklch\([^)]*\))/g)) {
    const [, token, value] = m;
    const slot = pairs.get(token) || {};
    if (value.startsWith('#')) slot.hex = value.toLowerCase(); else slot.ok = value;
    pairs.set(token, slot);
  }
  for (const [token, slot] of pairs) {
    if (!slot.hex || !slot.ok) { drifted.push(`${theme} --${token}: só tem ${slot.hex ? 'hex' : 'oklch'}, a outra declaração falta`); continue; }
    compared++;
    const parse = text => text.match(/oklch\(([^)]+)\)/)[1].split(/\s+/).map(v => v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
    const rgb = oklchToRgb(...parse(slot.ok));
    const near = rgb.map((v, i) => Math.abs(v - parseInt(slot.hex.slice(1 + i * 2, 3 + i * 2), 16)));
    if (!near.some(d => d > 1)) continue;
    // Tolerância de 1 por canal: arredondamento do navegador, não decisão de design.
    const [l, c, h] = hexToOklch(slot.hex);
    const exact = `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(1)})`;
    drifted.push(`${theme} --${token}: hex ${slot.hex} mas oklch dá #${rgb.map(v => v.toString(16).padStart(2, '0')).join('')} (diferença ${near.join('/')})`);
    if (process.argv.includes('--fix') && !oklchToRgb(...parse(exact)).some((v, i) => Math.abs(v - parseInt(slot.hex.slice(1 + i * 2, 3 + i * 2), 16)) > 0)) {
      css = css.replaceAll(`${token}:${slot.ok}`, `${token}:${exact}`);
      fixed++;
    }
  }
}
if (process.argv.includes('--fix')) {
  await writeFile(cssPath, css);
  console.log(`${fixed} tokens reajustados para reproduzir o hex exato.`);
  process.exit(0);
}
if (drifted.length) {
  console.log('Tokens divergentes:\n' + drifted.map(d => '  - ' + d).join('\n') + '\n\nRode: node scripts/verify-tokens.mjs --fix');
  process.exit(1);
}
console.log(`Tokens de cor fiéis nos dois temas: ${compared} pares hex/oklch batendo em 1 nível por canal.`);
