// End-to-end motor check with a focused (visible) headless page so rAF runs.
import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VERIFY_PORT || 9345);
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking',
  '--enable-unsafe-swiftshader', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome nao respondeu');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const ready = new Promise((ok, err) => { ws.addEventListener('open', ok); ws.addEventListener('error', err); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); }
  });
  return { ready, send(method, params = {}) { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((ok, fail) => pending.set(i, { ok, fail })); }, close: () => ws.close() };
}

let ws, failures = 0;
const check = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`); if (!cond) failures++; };

try {
  ws = connect((await target()).webSocketDebuggerUrl);
  await ws.ready;
  const { send } = ws;
  await send('Page.enable'); await send('Runtime.enable');
  // Focus emulation makes the page report visible/focused so requestAnimationFrame ticks.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const goto = async url => { await send('Page.navigate', { url }); await sleep(1200); };

  // 1) Named breathing plan actually advances over time.
  await goto(`${BASE}/?resp=quadrada`);
  check('resp=quadrada abre dialogo', await evaluate(`document.getElementById('breath-dialog').open === true`));
  check('padrao selecionado', await evaluate(`document.getElementById('breath-pattern').value`) === 'quadrada');
  await evaluate(`document.getElementById('breath-start').click()`);
  await sleep(400);
  const early = await evaluate(`({phase:document.getElementById('breath-phase').textContent, n:document.getElementById('breath-number').textContent})`);
  await sleep(4200);
  const later = await evaluate(`({phase:document.getElementById('breath-phase').textContent, n:document.getElementById('breath-number').textContent, cycle:document.getElementById('breath-cycle').textContent})`);
  check('timer avanca (rAF ativo)', early.phase !== 'No seu tempo' && (later.n !== early.n || later.phase !== early.phase), `${JSON.stringify(early)} -> ${JSON.stringify(later)}`);
  check('fase quadrada coerente', ['Inspire','Segure o ar','Solte o ar','Segure sem ar'].includes(later.phase), later.phase);

  // 2) 4-7-8 plan has the long hold label.
  await goto(`${BASE}/?resp=4-7-8`);
  await evaluate(`document.getElementById('breath-start').click()`);
  await sleep(4500);
  const holdPhase = await evaluate(`document.getElementById('breath-phase').textContent`);
  check('4-7-8 entra na seguranca longa', holdPhase === 'Segure o ar', holdPhase);

  // 3) foco=50 opens focus dialog with the right length.
  await goto(`${BASE}/?foco=50`);
  const focus = await evaluate(`({open:document.getElementById('focus-dialog').open, len:document.getElementById('focus-length').value})`);
  check('foco=50 abre dialogo de foco', focus.open === true && focus.len === '50', JSON.stringify(focus));

  // 4) Invalid deep-links are ignored safely.
  await goto(`${BASE}/?resp=nope&mix=hack:999&foco=abc`);
  const safe = await evaluate(`({breath:document.getElementById('breath-dialog').open, mixPlay:document.getElementById('mix-play').hidden, focus:document.getElementById('focus-dialog').open})`);
  check('deep-links invalidos ignorados', safe.breath === false && safe.mixPlay === true && safe.focus === false, JSON.stringify(safe));

  console.log(failures ? `\n${failures} verificacao(oes) falharam.` : '\nMotor: respiracao nomeada avança, 4-7-8, foco e sanidade de URL verificados.');
} finally {
  ws?.close(); chrome.kill();
}
process.exit(failures ? 1 : 0);