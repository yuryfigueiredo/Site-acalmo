import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.SHOOT_PORT || 9333);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const url = process.argv[2];
if (!url) {
  console.error('uso: node scripts/shoot.mjs <url> --out <arquivo.png> --width 390 --height 844 [--full] [--dpr 2] [--wait 1500]');
  process.exit(2);
}

const out = resolve(arg('out', 'shot.png'));
const width = Number(arg('width', 1440));
const height = Number(arg('height', 900));
const dpr = Number(arg('dpr', 1));
const full = process.argv.includes('--full');
// --format jpeg serve para os cartões de compartilhamento, que precisam de bytes pequenos e aceitação universal.
const format = arg('format', 'png');
const wait = Number(arg('wait', 1500));
const mobile = width < 900;

const chromeArgs = [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${width},${height}`,
  'about:blank',
];
// --autoplay permite fotografar estados que só existem com som tocando de verdade no headless.
if (process.argv.includes('--autoplay')) chromeArgs.push('--autoplay-policy=no-user-gesture-required');

const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targetList() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome nao respondeu no porte ' + PORT);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const ready = new Promise((ok, err) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', err);
  });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((ok, fail) => pending.set(id, { ok, fail }));
    },
    close: () => ws.close(),
  };
}

const write = async (data, label) => {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(data, 'base64'));
  console.log(`${label} -> ${out}`);
};

let ws;
try {
  const target = await targetList();
  ws = connect(target.webSocketDebuggerUrl);
  await ws.ready;
  const { send } = ws;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: arg('scheme', 'light') }],
  });
  // sem isto o Chrome headless reporta (pointer:fine) mesmo com mobile:true e o site mostra "Mova o mouse".
  if (process.argv.includes('--touch')) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  }

  await send('Page.navigate', { url });
  await send('Page.frameStoppedLoading').catch(() => {});
  await sleep(wait);

  // espera as fontes e as imagens terminarem
  await send('Runtime.evaluate', {
    expression: 'document.fonts ? document.fonts.ready.then(()=>1) : 1',
    awaitPromise: true,
  }).catch(() => {});
  await sleep(Number(arg('settle', 800)));

  // permite abrir um diálogo antes da captura: --eval "document.querySelector('#menu-open').click()"
  const evalExpr = arg('eval', '');
  if (evalExpr) {
    await send('Runtime.evaluate', { expression: evalExpr, awaitPromise: true }).catch(error => console.error('eval falhou:', error.message));
    await sleep(600);
  }

  if (full) {
    await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' });
    await sleep(300);
    const metrics = await send('Page.getLayoutMetrics');
    const content = metrics.cssContentSize || metrics.contentSize;
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: Math.ceil(content.height),
      deviceScaleFactor: dpr,
      mobile,
    });
    await sleep(500);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: {
        x: 0, y: 0, width, height: content.height, scale: 1,
      },
    });
    await write(data, `full ${width}x${Math.ceil(content.height)}@${dpr}x`);
  } else {
    const capture = { format };
    if (format === 'jpeg') capture.quality = Number(arg('quality', 82));
    const { data } = await send('Page.captureScreenshot', capture);
    await write(data, `viewport ${width}x${height}@${dpr}x ${format}`);
  }
} finally {
  ws?.close();
  chrome.kill();
}
