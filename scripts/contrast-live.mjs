// Measures the contrast of the pixels the browser actually paints.
// Each page is captured in bands, twice per band: once as the visitor sees it and once with every
// glyph made transparent. Reading the second image inside the box of each text element gives the
// ground that is really behind it - photograph, water canvas, glow gradient or flat token - and the
// glyph's own anti-aliased edges can never enter the sample. A CSS walk cannot do this: the hero
// text has no background of its own, so the only honest answer is to look at the screen.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CONTRAST_PORT || 9341);
const base = process.argv[2] || 'http://127.0.0.1:4173';
const scheme = process.argv[3] || 'light';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const WIDTH = Number(process.env.CONTRAST_WIDTH || 1280);
const BAND = Number(process.env.CONTRAST_BAND || 2400);
const OVERLAP = 300;
const SETTLE = Number(process.env.CONTRAST_SETTLE || 500);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every html file becomes a URL the static server really answers: directories go to their
// trailing-slash form, and a loose file keeps its extension because /404 would 404.
async function routes(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...await routes(p, `${prefix}/${entry.name}`));
    } else if (entry.name.endsWith('.html')) {
      found.push(entry.name === 'index.html' ? `${prefix}/` : `${prefix}/${entry.name}`);
    }
  }
  return found;
}

// Uma tinta opaca sobre um fundo e a propria tinta; com alpha zero e o fundo. Escrito ao contrario
// isso devolve o fundo para todo texto opaco, cada razao sai 1:1 e o site inteiro "passa".
const RULER = '0,0,0 | 255,255,255';

const measure = async (shotFg, shotBg, ultima) => {
  const inkOver = (ink, ground, alpha) => ({
    r: ground.r + (ink.r - ground.r) * alpha,
    g: ground.g + (ink.g - ground.g) * alpha,
    b: ground.b + (ink.b - ground.b) * alpha,
  });
  const srgb = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = c => 0.2126 * srgb(c.r / 255) + 0.7152 * srgb(c.g / 255) + 0.0722 * srgb(c.b / 255);
  const ratio = (a, b) => {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // getComputedStyle devolve oklch quando a paleta e oklch. O canvas resolve qualquer sintaxe
  // aceita para os sRGB que o navegador pinta, entao a regua nao depende de parser feito a mao.
  const resolver = document.createElement('canvas');
  resolver.width = resolver.height = 1;
  const rx = resolver.getContext('2d', { willReadFrequently: true });
  const parse = value => {
    rx.fillStyle = '#ff00fe';
    rx.fillStyle = value;
    if (rx.fillStyle === '#ff00fe') return null;
    rx.clearRect(0, 0, 1, 1);
    rx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = rx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const decode = async b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    img.close();
    return { data: cx.getImageData(0, 0, cv.width, cv.height).data, width: cv.width, height: cv.height };
  };
  const fg = await decode(shotFg);
  const bg = await decode(shotBg);
  const pixel = (src, x, y) => {
    const i = (y * src.width + x) * 4;
    return { r: src.data[i], g: src.data[i + 1], b: src.data[i + 2] };
  };
  const opacityOf = el => {
    let total = 1;
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      total *= Number(getComputedStyle(node).opacity) || 1;
    }
    return total;
  };

  const out = {
    fail: [], varia: [], hidden: [], dim: [], pass: 0, medidos: 0, isento: 0, espera: 0, fora: 0, painted: 0, top: 0,
    ruler: [inkOver({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 1),
      inkOver({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0)]
      .map(c => `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`).join(' | '),
    href: location.href, view: innerWidth + 'x' + innerHeight, shot: fg.width + 'x' + fg.height,
  };
  // Se as duas capturas forem pixel a pixel iguais, apagar a tinta falhou e todo numero abaixo seria ruido.
  // Amostra a foto inteira (de 4 em 4 pixels), nao so o topo: uma faixa que comeca em margem em branco
  // daria diferenca zero por cima e uma pagina inteira ficaria cega, como aconteceu nas ferramentas.
  for (let i = 0; i < fg.data.length; i += 16) out.painted += Math.abs(fg.data[i] - bg.data[i]);

  const scale = fg.width / innerWidth;
  for (const el of document.querySelectorAll('body *')) {
    if (el.dataset.cmMedido) continue;
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim();
    if (!text || el.closest('[aria-hidden=true]')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    // 1px por 1px com clip-path e texto para leitor de tela (.skip-link, .sr-only): ninguem o le na tela.
    if (rect.width < 3 || rect.height < 3 || parseFloat(style.opacity) < 0.05) continue;
    // Componente inativo: a WCAG exclui o que nao se pode acionar, e o .45 do botao desabilitado nao e
    // uma tinta escolhida - e o sinal de que aquilo ainda nao serve para nada.
    if (el.disabled === true) { out.isento++; continue; }
    // Um texto que atravessa a borda da faixa sera medido inteiro na proxima; na ultima faixa nao ha
    // para onde adiar, e medir o pedaco visivel e melhor que ter uma pagina cega.
    if (!ultima && (rect.top < 0 || rect.bottom > innerHeight)) { out.espera++; continue; }

    const x0 = Math.max(0, Math.floor(rect.left * scale));
    const y0 = Math.max(0, Math.floor(rect.top * scale));
    const x1 = Math.min(fg.width - 1, Math.ceil(rect.right * scale) - 1);
    const y1 = Math.min(fg.height - 1, Math.ceil(rect.bottom * scale) - 1);
    if (x1 <= x0 || y1 <= y0) { out.fora++; continue; }

    const colour = parse(style.color);
    if (!colour) continue;
    const opa = opacityOf(el);
    const alpha = Math.min(1, colour.a * opa);
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
    el.dataset.cmMedido = '1';

    const w = x1 - x0, h = y1 - y0;
    const step = Math.max(1, Math.round(Math.sqrt((w * h) / 900)));
    const valores = [];
    let tinta = 0, pior = null, piorV = Infinity;
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const fundo = pixel(bg, x, y);
        const visto = pixel(fg, x, y);
        // Onde a captura com texto e identica a sem texto nao ha traco de tinta: sao o canto redondo de
        // uma pilula (que mostra a cena atras) ou a margem de um paragrafo. Julgar esses pixels
        // inventaria um contraste que ninguem esta lendo.
        if (Math.abs(visto.r - fundo.r) + Math.abs(visto.g - fundo.g) + Math.abs(visto.b - fundo.b) <= 30) continue;
        tinta++;
        const v = ratio(inkOver(colour, fundo, alpha), fundo);
        valores.push(v);
        if (v < piorV) { piorV = v; pior = fundo; }
      }
    }
    if (!valores.length) continue;
    out.medidos++;
    const record = {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      class: (el.className || '').toString().split(' ')[0] || undefined,
      text: text.slice(0, 46),
      px: Math.round(size),
      need,
      alpha: +alpha.toFixed(2),
      tintaPx: tinta,
    };
    if (!tinta) { out.hidden.push(record); continue; }
    valores.sort((a, b) => a - b);
    const at = f => valores[Math.min(valores.length - 1, Math.floor(f * valores.length))];
    record.median = +at(0.5).toFixed(2);
    record.p10 = +at(0.1).toFixed(2);
    record.pior = `${pior.r},${pior.g},${pior.b}`;
    out.top = Math.max(out.top, record.median);
    const folga = valores.filter(v => v < need).length / valores.length;
    // Translucencia de verdade (cor com alpha) e decisao de design e continua sendo julgada. Alpha de
    // ancestral e outro caso: a chrome das ferramentas some quando a pagina entra em repouso, e um
    // quadro no meio do fade nao diz nada sobre o contraste com que a pessoa vai ler.
    if (opa < 0.98 && colour.a >= 0.98) { out.dim.push({ ...record, opa: +opa.toFixed(2) }); continue; }
    if (record.median < need) out.fail.push(record);
    else if (record.p10 < need && folga > 0.15) out.varia.push({ ...record, folga: +folga.toFixed(2) });
    else out.pass++;
  }
  return out;
};

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--hide-scrollbars', `--window-size=${WIDTH},900`, 'about:blank',
], { stdio: 'ignore' });

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome nao respondeu no porte ' + PORT);
}

const ws = new WebSocket((await targets()).webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.addEventListener('open', ok); ws.addEventListener('error', err); });
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, fail } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
  }
});
const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = ++nextId;
  pending.set(id, { ok, fail });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, { awaitPromise = false } = {}) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });

const filtro = process.argv[4];
const list = [...new Set(await routes(root))].filter(route => !filtro || route.includes(filtro)).sort();
console.log(`${list.length} paginas em dist/ | ${scheme} | ${WIDTH}px | faixas de ${BAND}px com ${OVERLAP}px de sobreposta`);
let fails = 0, passes = 0, varia = 0, ocultos = 0, repouso = 0, ruins = 0;
for (const route of list) {
  await send('Page.navigate', { url: base + route });
  await sleep(1600);
  const total = Number(await evaluate('Math.ceil(document.documentElement.scrollHeight)')) || 900;
  const view = Math.min(Math.max(total, 900), BAND);
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: view, deviceScaleFactor: 1, mobile: false });
  // Scroll suave atrasaria cada faixa: a captura precisa pegar o topo ja parado.
  await evaluate(`document.documentElement.style.scrollBehavior='auto'`);
  // Congela transicao e animacao na pagina inteira. As duas capturas de uma faixa tem que mostrar o
  // mesmo quadro: sem isso o fundo por baixo da letra viria de um instante diferente do quadro pintado,
  // e um fade de repouso das ferramentas seria lido como uma tinta que nao existe.
  await evaluate(`(()=>{const s=document.createElement('style');s.id='__congelado';
    s.textContent='*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.append(s)})()`);
  const degraus = [];
  for (let topo = 0; topo < total; topo += BAND - OVERLAP) degraus.push(Math.min(topo, Math.max(0, total - view)));
  const acc = { medidos: 0, pass: 0, fail: [], varia: [], hidden: [], dim: [], isento: 0, fora: 0, espera: 0, painted: 0, top: 0, shot: '' };
  let erro = null;
  for (let i = 0; i < degraus.length; i++) {
    await evaluate(`window.scrollTo(0,${degraus[i]})`);
    await sleep(SETTLE);
    const shotFg = (await send('Page.captureScreenshot', { format: 'png' })).data;
    // Apaga so a tinta: fundos, fotos e gradientes continuam exatamente onde estavam.
    await evaluate(`(()=>{const s=document.createElement('style');s.id='__semtexto';
      s.textContent='*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}';
      document.head.append(s)})()`);
    await sleep(150);
    const shotBg = (await send('Page.captureScreenshot', { format: 'png' })).data;
    await evaluate('document.getElementById("__semtexto").remove()');
    let value;
    try {
      value = await evaluate(`(${measure.toString()})(${JSON.stringify(shotFg)},${JSON.stringify(shotBg)},${i === degraus.length - 1})`, { awaitPromise: true });
    } catch (error) {
      erro = error.message;
      break;
    }
    if (value.ruler !== RULER) { erro = `regua invertida: ${value.ruler}`; break; }
    // Diferenca zero entre as duas capturas = a tinta nunca foi apagada: nao e site aprovado, e regua quebrada.
    if (!value.painted) { erro = `capturas identicas na faixa ${i} (nenhum pixel mudou ao apagar o texto)`; break; }
    acc.medidos += value.medidos;
    acc.pass += value.pass;
    acc.fail.push(...value.fail);
    acc.varia.push(...value.varia);
    acc.hidden.push(...value.hidden);
    acc.dim.push(...value.dim);
    acc.isento += value.isento;
    acc.fora += value.fora;
    acc.espera += value.espera;
    acc.painted = Math.min(acc.painted || Infinity, value.painted);
    acc.top = Math.max(acc.top, value.top);
    acc.shot = value.shot;
  }
  if (erro || !acc.medidos) {
    ruins++;
    console.log(`VAZIA ${route}: ${acc.medidos} textos medidos${erro ? ' | ' + erro : ''}`);
    continue;
  }
  // Toda a pagina em 1:1 so acontece se a tinta for o proprio fundo: a conta, nao o site.
  if (acc.top <= 1) {
    ruins++;
    console.log(`VAZIA ${route}: nenhuma medicao passou de 1:1 (a conta de sobreposicao esta errada)`);
    continue;
  }
  passes += acc.pass;
  varia += acc.varia.length;
  ocultos += acc.hidden.length;
  repouso += acc.dim.length;
  fails += acc.fail.length;
  console.log(`  ${route}  ${total}px em ${degraus.length} faixa(s), foto ${acc.shot} | ${acc.medidos} medidos, ${acc.pass} ok, `
    + `${acc.fail.length} reprovados, ${acc.varia.length} variam, ${acc.dim.length} em repouso, `
    + `${acc.isento} desabilitados, ${acc.hidden.length} sem tinta, ${acc.fora} fora`);
  for (const item of acc.dim.slice(0, 4)) {
    console.log(`REPOUSO  ${route}  opacidade ${item.opa}  <${item.tag}${item.id ? '#' + item.id : ''}${item.class ? '.' + item.class : ''}>  "${item.text}"`);
  }
  for (const item of acc.varia.slice(0, 6)) {
    console.log(`VARIA    ${route}  mediana ${item.median}:1, 10% pior ${item.p10}:1 (precisa ${item.need})  `
      + `${item.px}px  ${Math.round(item.folga * 100)}% abaixo  fundo rgb(${item.pior})  `
      + `<${item.tag}${item.id ? '#' + item.id : ''}${item.class ? '.' + item.class : ''}>  "${item.text}"`);
  }
  for (const item of acc.hidden.slice(0, 4)) {
    console.log(`SINTINTA ${route}  alpha ${item.alpha}  <${item.tag}${item.id ? '#' + item.id : ''}${item.class ? '.' + item.class : ''}>  "${item.text}"`);
  }
  for (const item of acc.fail) {
    console.log(`REPROVADO ${route}  mediana ${item.median}:1 (precisa ${item.need})  ${item.px}px  alpha ${item.alpha}  `
      + `pior fundo rgb(${item.pior})  <${item.tag}${item.id ? '#' + item.id : ''}${item.class ? '.' + item.class : ''}>  "${item.text}"`);
  }
}
console.log(`\nContraste ${scheme}: ${passes} textos aprovados, ${fails} reprovados, ${varia} com fundo que varia `
  + `(julgar no frame), ${ocultos} sem tinta visivel, ${repouso} esvanecidos pelo repouso das ferramentas, `
  + `${ruins} pagina(s) nao medida(s).`);
ws.close();
chrome.kill('SIGKILL');
process.exit(fails || ruins ? 1 : 0);
