// Confirms the browser chrome colour follows the theme on generated pages.
import { spawn } from 'node:child_process';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VERIFY_PORT || 9347);
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
async function target() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p; } catch {} await sleep(250); } throw new Error('chrome nao respondeu'); }
function connect(u) { const ws = new WebSocket(u); let id = 0; const pending = new Map(); const ready = new Promise((ok, err) => { ws.addEventListener('open', ok); ws.addEventListener('error', err); }); ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); } }); return { ready, send(method, params = {}) { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((ok, fail) => pending.set(i, { ok, fail })); }, close: () => ws.close() }; }
let ws, failures = 0;
const check = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`); if (!cond) failures++; };
try {
  ws = connect((await target()).webSocketDebuggerUrl); await ws.ready;
  const { send } = ws; await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
  const meta = () => evaluate(`document.querySelector('meta[name=theme-color]').content`);
  for (const route of ['/respiracao/quadrada/', '/sons/ruido-marrom/', '/leituras/uma-pausa-entre-tarefas/', '/']) {
    // Dark via emulated preference, before any module runs.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await send('Page.navigate', { url: BASE + route }); await sleep(900);
    check('escuro: theme-color escura ' + route, await meta() === '#172a24', await meta());
    // Light via the visible toggle (page.js) or the stored preference.
    await evaluate(`localStorage.removeItem('acalmo:theme')`);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await send('Page.navigate', { url: BASE + route }); await sleep(900);
    const before = await meta();
    const toggled = await evaluate(`(()=>{const b=document.getElementById('page-theme')||document.getElementById('theme-toggle');if(!b)return 'no-button';b.click();return document.querySelector('meta[name=theme-color]').content;})()`);
    check('claro começa claro ' + route, before === '#f5f2e9', before);
    check('toggle escurece ' + route, toggled === '#172a24', toggled);
  }
  console.log(failures ? `\n${failures} falharam.` : '\nTema: cor da barra segue o modo escuro na carga e ao alternar, em ferramentas, artigos e home.');
} finally { ws?.close(); chrome.kill(); }
process.exit(failures ? 1 : 0);