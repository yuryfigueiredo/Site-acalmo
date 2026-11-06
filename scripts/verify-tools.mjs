// End-to-end check of the five tool pages with trusted gestures and a focused page.
import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VERIFY_PORT || 9346);
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking',
  '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = list.find(t => t.type === 'page'); if (p) return p; } catch {}
    await sleep(250);
  }
  throw new Error('chrome nao respondeu');
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  const ready = new Promise((ok, err) => { ws.addEventListener('open', ok); ws.addEventListener('error', err); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); } });
  return { ready, send(method, params = {}) { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((ok, fail) => pending.set(i, { ok, fail })); }, close: () => ws.close() };
}

let ws, failures = 0;
const check = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`); if (!cond) failures++; };

try {
  ws = connect((await target()).webSocketDebuggerUrl); await ws.ready;
  const { send } = ws;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const goto = async url => { await send('Page.navigate', { url }); await sleep(1200); };
  async function click(sel) {
    const r = await evaluate(`(()=>{const b=document.querySelector('${sel}').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }

  for (const [route, label] of [['/sons/ruido-marrom/', 'ruído marrom'], ['/sons/chuva/', 'chuva']]) {
    await goto(BASE + route);
    await click('#tool-play'); await sleep(500);
    const on = await evaluate(`({pressed:document.getElementById('tool-play').getAttribute('aria-pressed'),status:document.getElementById('tool-status').textContent})`);
    check(label + ' toca com gesto', on.pressed === 'true', JSON.stringify(on));
    await click('#tool-play'); await sleep(300);
    check(label + ' pausa', await evaluate(`document.getElementById('tool-play').getAttribute('aria-pressed')`) === 'false');
  }

  await goto(BASE + '/respiracao/quadrada/');
  await click('#tool-start'); await sleep(400);
  const early = await evaluate(`({p:document.getElementById('tool-phase').textContent,n:document.getElementById('tool-count').textContent})`);
  await sleep(4200);
  const later = await evaluate(`({p:document.getElementById('tool-phase').textContent,n:document.getElementById('tool-count').textContent})`);
  check('quadrada avança', early.p !== 'No seu tempo' && (later.p !== early.p || later.n !== early.n), `${JSON.stringify(early)} -> ${JSON.stringify(later)}`);

  await goto(BASE + '/respiracao/4-7-8/');
  await click('#tool-start'); await sleep(4500);
  check('4-7-8 retenção longa', await evaluate(`document.getElementById('tool-phase').textContent`) === 'Segure o ar');

  await goto(BASE + '/foco/50-minutos/');
  await click('#tool-start'); await sleep(1600);
  const clock = await evaluate(`document.getElementById('tool-clock').textContent`);
  check('foco conta o bloco', clock !== '50:00', clock);
  await sleep(6500);
  check('UI descansa após quietude', await evaluate(`document.body.classList.contains('tool-idle')`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 400 });
  await sleep(200);
  check('UI volta ao interagir', await evaluate(`!document.body.classList.contains('tool-idle')`));

  console.log(failures ? `\n${failures} verificacao(oes) falharam.` : '\nTools: som, respiração, foco e UI que descansa verificados com gesto real.');
} finally { ws?.close(); chrome.kill(); }
process.exit(failures ? 1 : 0);