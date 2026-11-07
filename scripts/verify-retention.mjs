// Retention checks in a real Chrome (CDP): R1 soft sleep fade, R2 journal prompts + local history, R3 time-of-day default.
// Same pattern as verify-motor/verify-tools: focused headless page, trusted mouse gestures for audio, deterministic clocks.
import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VERIFY_PORT || 9347);
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FADE_TEXT = 'Os sons vão terminar suavemente.';
const BASE_LABEL = 'Uma sugestão para este momento';
const requests = [];
// Confirmations are answered on purpose: a destructive button that never asks is a defect, so one check declines.
const dialogSeen = [];
let dialogAnswer = true;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking',
  '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,1400', 'about:blank',
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = list.find(t => t.type === 'page'); if (p) return p; } catch {}
    await sleep(250);
  }
  throw new Error('chrome nao respondeu');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((ok, err) => { ws.addEventListener('open', ok); ws.addEventListener('error', err); });
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((ok, fail) => pending.set(i, { ok, fail })); };
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Network.requestWillBeSent') { requests.push(m.params.request.url); return; }
    if (m.method === 'Page.javascriptDialogOpening') { dialogSeen.push(m.params.message); send('Page.handleJavaScriptDialog', { accept: dialogAnswer }).catch(() => {}); return; }
    if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); }
  });
  return { ready, send, close: () => ws.close() };
}

let ws, send, failures = 0;
const check = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`); if (!cond) failures++; };
const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
const goto = async url => { await send('Page.navigate', { url }); await sleep(1400); };
async function click(selector) {
  // Rolagem suave é o padrão do site: instant + uma pausa para a caixa já estar onde o mouse vai cair.
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center',behavior:'instant'});return true;})()`);
  await sleep(220);
  const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,inView:r.top>=0&&r.bottom<=innerHeight};})()`);
  if (!point || !point.inView) throw new Error('alvo fora da tela: ' + selector + ' ' + JSON.stringify(point));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(120);
}
const field = (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));return el.value;})()`);
const pick = (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;})()`);
const soundState = () => evaluate(`({
  fadeStatus: document.getElementById('sound-status').textContent,
  timerStatus: document.getElementById('sound-timer-status').textContent,
  stopped: document.getElementById('audio-stop').disabled,
  announcements: window.__fadeAnnouncements ?? -1
})`);
const moduleOf = name => `(async () => { const src = document.querySelector('script[src*="/assets/app.js"]').src; return import(${JSON.stringify(name)} + new URL(src).search); })()`;

try {
  ws = connect((await target()).webSocketDebuggerUrl);
  await ws.ready;
  ({ send } = ws);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  // Focus emulation keeps requestAnimationFrame and the audio timeline running.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const seed = await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.clear();localStorage.setItem('acalmo:sound-preference','false');localStorage.setItem('acalmo:theme','light');}catch(e){}" });

  // ---------- R1: fadeOut really lowers the master gain in Web Audio ----------
  await goto(BASE + '/');
  check('R1: nada toca sozinho na abertura', await evaluate(`document.getElementById('audio-stop').disabled === true`));
  const ramp = await evaluate(`(async () => {
    const mod = await ${moduleOf('/assets/audio.js')};
    const instance = new mod.default();
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    try {
      await instance.set('rain', 0.4);
      await wait(1500);
      const master = instance._master.gain;
      out.playing = instance.playing;
      out.start = master.value;
      out.clockStart = instance._context.currentTime;
      out.fadeRequested = await instance.fadeOut(2);
      out.fading = instance.fading;
      await wait(700);
      out.middle = master.value;
      await wait(1700);
      out.end = master.value;
      out.clockEnd = instance._context.currentTime;
      out.mixKept = instance.volumes.rain;
      await instance.stopAll();
      await wait(300);
      out.channelsAfterStop = instance._channels.size;
      out.fadingAfterStop = instance.fading;
    } catch (error) { out.error = String(error?.message || error); }
    await instance.destroy();
    return out;
  })()`);
  check('R1: audio.js toca de verdade no navegador', !ramp.error && ramp.playing === true, JSON.stringify(ramp).slice(0, 200));
  check('R1: fadeOut leva o master ao silêncio', ramp.fadeRequested === true && ramp.fading === true && ramp.start > 0.6 && ramp.middle < ramp.start - 0.05 && ramp.end <= 0.01, JSON.stringify({ start: ramp.start, middle: ramp.middle, end: ramp.end, clock: [ramp.clockStart, ramp.clockEnd] }));
  check('R1: a descida mantém a mixagem e para limpa', ramp.mixKept === 0.4 && ramp.channelsAfterStop === 0 && ramp.fadingAfterStop === false);

  // ---------- R1: the sound timer drives the soft ending ----------
  await goto(BASE + '/');
  await pick('#sound-timer', '5');
  await click('[data-sound="ocean"]');
  await sleep(900);
  check('R1: som ligado com limite de 5 minutos', await evaluate(`document.getElementById('audio-stop').disabled === false`));
  await evaluate(`(() => {
    window.__fadeAnnouncements = 0;
    const node = document.getElementById('sound-status');
    new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) if (n.textContent === ${JSON.stringify(FADE_TEXT)}) window.__fadeAnnouncements++; }).observe(node, { childList: true });
    window.__realNow = Date.now.bind(Date);
    window.__offset = 0;
    Date.now = () => window.__realNow() + window.__offset;
    return true;
  })()`);
  await evaluate('window.__offset = 245000');
  await sleep(2600);
  let timer = await soundState();
  check('R1: o último minuto anuncia o fim suave', timer.fadeStatus === FADE_TEXT, timer.fadeStatus);
  check('R1: avisa uma única vez', timer.announcements === 1, 'avisos=' + timer.announcements);
  check('R1: a contagem segue e o som continua tocando', timer.timerStatus.startsWith('Restam 00:5') && timer.stopped === false, JSON.stringify(timer));
  await field('#volume-ocean', '55');
  await sleep(300);
  timer = await soundState();
  check('R1: mexer no volume devolve o som', timer.fadeStatus !== FADE_TEXT && timer.stopped === false);
  await sleep(2300);
  timer = await soundState();
  check('R1: a descida é rearmada no tempo que sobra', timer.fadeStatus === FADE_TEXT && timer.announcements === 2, JSON.stringify(timer));
  await pick('#sound-timer', '0');
  await sleep(500);
  timer = await soundState();
  check('R1: “Sem limite” cancela a descida e mantém o som', timer.fadeStatus === '' && timer.timerStatus === '' && timer.stopped === false, JSON.stringify(timer));
  await pick('#sound-timer', '5');
  // O novo limite foi armado com o deslocamento já ativo: 485s coloca a contagem nos últimos sessenta segundos.
  await evaluate('window.__offset = 485000');
  await sleep(2600);
  timer = await soundState();
  check('R1: um novo limite volta a terminar suavemente', timer.fadeStatus === FADE_TEXT && timer.timerStatus.startsWith('Restam 00:5'), JSON.stringify(timer));
  await evaluate('window.__offset = 550000');
  await sleep(2600);
  timer = await soundState();
  const toggles = await evaluate(`[...document.querySelectorAll('.sound-toggle')].map(b => b.getAttribute('aria-pressed')).join()`);
  check('R1: na hora marcada o silêncio já chegou e tudo para', timer.fadeStatus.startsWith('O tempo escolhido terminou') && timer.stopped === true && timer.timerStatus === '' && toggles === 'false,false,false,false', JSON.stringify({ ...timer, toggles }));
  await evaluate('Date.now = window.__realNow');

  // ---------- R2: the prompts of the day ----------
  await goto(BASE + '/');
  const modulePrompts = await evaluate(`(async () => { const core = await ${moduleOf('/assets/core.js')}; return { prompts: core.dailyPrompts(), sets: core.journalPrompts.length }; })()`);
  const questions = await evaluate(`['#journal-label-one','#journal-label-two','#journal-label-three'].map(s => document.querySelector(s).textContent)`);
  check('R2: o diário mostra as três perguntas do dia', questions.length === 3 && questions.every((text, i) => text === modulePrompts.prompts[i] && text.trim().endsWith('?')), JSON.stringify(questions));
  check('R2: perguntas distintas, em conjuntos suficientes', new Set(questions).size === 3 && modulePrompts.sets >= 6, 'conjuntos=' + modulePrompts.sets);
  await click('#journal-open');
  await sleep(400);
  check('R2: diálogo de escrita abre', await evaluate(`document.getElementById('journal-dialog').open === true`));

  // ---------- R2: history only when the visitor chooses to save ----------
  await field('#journal-one', 'Uma coisa solta hoje');
  await field('#journal-two', 'Algo que pode esperar');
  await click('#journal-form button[type="submit"]');
  await sleep(500);
  const off = await evaluate(`({
    hidden: document.getElementById('journal-history').hidden,
    rows: document.querySelectorAll('.journal-history-row').length,
    history: localStorage.getItem('acalmo:journal-history'),
    draft: localStorage.getItem('acalmo:journal')
  })`);
  check('R2: sem a opção de guardar nada é persistido', off.hidden === true && off.rows === 0 && off.history === null && off.draft === null, JSON.stringify(off));
  await click('#journal-persist');
  await sleep(300);
  check('R2: guardar ligado', await evaluate(`document.getElementById('journal-persist').checked === true`));
  await click('#journal-form button[type="submit"]');
  await sleep(600);
  const on = await evaluate(`({
    hidden: document.getElementById('journal-history').hidden,
    rows: document.querySelectorAll('.journal-history-row').length,
    history: JSON.parse(localStorage.getItem('acalmo:journal-history') || '[]'),
    status: document.getElementById('journal-status').textContent
  })`);
  check('R2: guardar cria o histórico local', on.hidden === false && on.rows === 1 && on.history.length === 1 && on.history[0].answers[0] === 'Uma coisa solta hoje', JSON.stringify(on).slice(0, 200));
  check('R2: a entrada traz data ISO e três respostas', typeof on.history[0].date === 'string' && Number.isFinite(Date.parse(on.history[0].date)) && on.history[0].answers.length === 3);
  await click('#journal-form button[type="submit"]');
  await sleep(600);
  check('R2: repetir o mesmo texto não dobra a lista', await evaluate(`document.querySelectorAll('.journal-history-row').length`) === 1);
  await click('.journal-history-row .journal-history-open');
  await sleep(400);
  const view = await evaluate(`({
    hidden: document.getElementById('journal-history-view').hidden,
    text: document.getElementById('journal-history-view').textContent,
    expanded: document.querySelector('.journal-history-open').getAttribute('aria-expanded'),
    question: document.querySelector('.journal-history-question')?.textContent
  })`);
  check('R2: ver uma escrita mostra as respostas', view.hidden === false && view.text.includes('Uma coisa solta hoje') && view.expanded === 'true' && view.question === modulePrompts.prompts[0], JSON.stringify(view).slice(0, 200));
  await click('#journal-history-view .text-button');
  await sleep(300);
  check('R2: fechar a escrita volta para a lista', await evaluate(`document.getElementById('journal-history-view').hidden === true && document.querySelectorAll('.journal-history-row').length === 1`));
  await field('#journal-one', 'Segunda escrita guardada');
  await click('#journal-form button[type="submit"]');
  await sleep(600);
  const two = await evaluate(`({ rows: document.querySelectorAll('.journal-history-row').length, first: JSON.parse(localStorage.getItem('acalmo:journal-history'))[0].answers[0] })`);
  check('R2: uma escrita nova entra no topo da lista', two.rows === 2 && two.first === 'Segunda escrita guardada', JSON.stringify(two));
  await click('.journal-history-row .journal-history-remove');
  await sleep(500);
  const one = await evaluate(`({ rows: document.querySelectorAll('.journal-history-row').length, left: JSON.parse(localStorage.getItem('acalmo:journal-history')).map(e => e.answers[0]) })`);
  check('R2: apagar uma escrita remove só ela', one.rows === 1 && one.left.join() === 'Uma coisa solta hoje', JSON.stringify(one));
  const beforeClear = await evaluate(`document.querySelectorAll('.journal-history-row').length`);
  dialogAnswer = false;
  await click('#journal-history-clear');
  await sleep(500);
  const refused = await evaluate(`({ rows: document.querySelectorAll('.journal-history-row').length, history: JSON.parse(localStorage.getItem('acalmo:journal-history') || '[]').length })`);
  check('R2: recusar a confirmacao mantem as escritas guardadas', refused.rows === beforeClear && refused.history === beforeClear, JSON.stringify({ beforeClear, ...refused }));
  dialogAnswer = true;
  await click('#journal-history-clear');
  await sleep(500);
  const cleared = await evaluate(`({ hidden: document.getElementById('journal-history').hidden, rows: document.querySelectorAll('.journal-history-row').length, history: localStorage.getItem('acalmo:journal-history') })`);
  check('R2: aceitar o "apagar todas" limpa o navegador', cleared.hidden === true && cleared.rows === 0 && cleared.history === null, JSON.stringify(cleared));
  check('R2: apagar todas pede confirmacao', dialogSeen.some(texto => /todas as escritas/.test(texto)));

  // ---------- R2b: a writing saved on another day must stay reachable ----------
  const yesterday = await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('acalmo:journal',JSON.stringify({answers:['Escrita de ontem, uma.','Escrita de ontem, duas.','Escrita de ontem, tres.'],date:new Date(Date.now()-86400000).toISOString()}))}catch(e){}" });
  await goto(BASE + '/');
  const moved = await evaluate(`({
    rows: document.querySelectorAll('.journal-history-row').length,
    hidden: document.getElementById('journal-history').hidden,
    first: JSON.parse(localStorage.getItem('acalmo:journal-history') || '[]')[0]?.answers?.[0],
    draft: localStorage.getItem('acalmo:journal'),
    persist: document.getElementById('journal-persist').checked,
    field: document.getElementById('journal-one').value
  })`);
  check('R2b: a escrita de outro dia entra na lista', moved.hidden === false && moved.rows === 1 && moved.first === 'Escrita de ontem, uma.', JSON.stringify(moved));
  check('R2b: nada fica escondido atras de um rascunho vazio', moved.draft === null && moved.persist === false && moved.field === '', JSON.stringify(moved));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: yesterday.identifier });

  // ---------- R2c: deleting the text also reaches the saved copy of the same text ----------
  await click('#journal-open');
  await sleep(400);
  await field('#journal-one', 'Para apagar por inteiro');
  await click('#journal-persist');
  await sleep(300);
  await click('#journal-form button[type="submit"]');
  await sleep(600);
  const both = await evaluate(`({ rows: document.querySelectorAll('.journal-history-row').length, draft: JSON.parse(localStorage.getItem('acalmo:journal') || 'null')?.answers?.[0] })`);
  check('R2c: guardar escreve no rascunho e na lista', both.rows === 2 && both.draft === 'Para apagar por inteiro', JSON.stringify(both));
  await click('#journal-delete');
  await sleep(500);
  const gone = await evaluate(`({
    rows: document.querySelectorAll('.journal-history-row').length,
    kept: JSON.parse(localStorage.getItem('acalmo:journal-history') || '[]').map(entry => entry.answers[0]),
    draft: localStorage.getItem('acalmo:journal'),
    field: document.getElementById('journal-one').value
  })`);
  check('R2c: apagar o texto apaga tambem a copia identica', gone.rows === 1 && gone.kept.join() === 'Escrita de ontem, uma.' && gone.draft === null && gone.field === '', JSON.stringify(gone));

  // ---------- R3: a soft default for the time of day ----------
  const periods = [
    { hour: 8, intent: 'calm', label: 'começar o dia' },
    { hour: 14, intent: 'focus', label: 'para a tarde' },
    { hour: 19, intent: 'rest', label: 'fim do dia' },
    { hour: 23, intent: 'write', label: 'para a noite' }
  ];
  for (const period of periods) {
    const mock = await send('Page.addScriptToEvaluateOnNewDocument', { source: `Date.prototype.getHours = function () { return ${period.hour}; };` });
    await goto(BASE + '/');
    const seen = await evaluate(`({
      label: document.getElementById('recommendation-label').textContent,
      title: document.getElementById('recommendation-title').textContent,
      text: document.getElementById('recommendation-text').textContent,
      action: document.getElementById('recommendation-start').textContent,
      intent: document.querySelector('.intention[aria-pressed="true"]').dataset.intent,
      selected: document.querySelectorAll('.intention.selected').length
    })`);
    check(`R3: ${period.hour}h sugere "${period.intent}" com calma`, seen.intent === period.intent && seen.label.includes(period.label) && seen.selected === 1, JSON.stringify(seen));
    check(`R3: ${period.hour}h tem convite completo e sem cobrança`, seen.title.length > 6 && seen.text.length > 20 && seen.action.length > 3 && !/dias seguidos|meta|sequência|streak|garante/i.test(seen.title + ' ' + seen.text), seen.action);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: mock.identifier });
  }
  const night = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Date.prototype.getHours = function () { return 23; };' });
  await goto(BASE + '/');
  const nightDefault = await evaluate(`document.querySelector('.intention[aria-pressed="true"]').dataset.intent`);
  check('R3: de madrugada a página já sugere escrever', nightDefault === 'write', nightDefault);
  await click('[data-intent="rest"]');
  await sleep(400);
  const chosen = await evaluate(`({
    intent: document.querySelector('.intention[aria-pressed="true"]').dataset.intent,
    label: document.getElementById('recommendation-label').textContent,
    title: document.getElementById('recommendation-title').textContent
  })`);
  check('R3: escolher uma intenção vence o horário', chosen.intent === 'rest' && chosen.label === BASE_LABEL, JSON.stringify(chosen));
  await click('#recommendation-start');
  await sleep(600);
  check('R3: o botão leva para os sons', await evaluate(`document.getElementById('audio-stop') !== null && !document.getElementById('journal-dialog').open && !document.getElementById('breath-dialog').open && !document.getElementById('focus-dialog').open`));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: night.identifier });
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });

  // ---------- nothing leaves the browser ----------
  // data: e blob: já são bytes dentro do navegador, não uma ida a outra máquina. A regra é sobre
  // rede: se fosse qualquer URL, um filtro de grão em SVG contaria como envio para fora do site.
  const network = requests.filter(url => /^https?:/i.test(url));
  const external = network.filter(url => !url.startsWith(BASE));
  check('Local: nenhuma requisição fora do site', external.length === 0, external.slice(0, 3).join(' '));
  check('Local: o histórico nunca foi enviado', !network.some(url => /journal|history/i.test(url)));

  console.log(failures ? `\n${failures} verificacao(oes) falharam.` : '\nRetencao: fade suave do temporizador, perguntas do dia com historico local e sugestao por periodo verificados no navegador.');
} finally {
  ws?.close();
  chrome.kill();
}
process.exit(failures ? 1 : 0);
