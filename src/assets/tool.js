import AmbientAudio from './audio.js';
import { createNamedPlan, breathAt, formatClock } from './core.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${name === 'pause' ? '<path d="M8 5v14M16 5v14"/>' : '<path d="m8 4 12 8-12 8V4Z"/>'}</svg>`;
const reduced = matchMedia('(prefers-reduced-motion:reduce)');
const body = document.body;
const kind = body.dataset.tool;

// Chrome rests after a quiet moment and returns on any interaction.
let idleTimer;
function wake() {
  body.classList.remove('tool-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => body.classList.add('tool-idle'), 6000);
}
for (const event of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) document.addEventListener(event, wake, { passive: true });
wake();

if (kind === 'sound') {
  const channel = body.dataset.channel;
  const audio = new AmbientAudio();
  const play = $('#tool-play');
  const volume = $('#tool-volume');
  const volumeValue = $('#tool-volume-value');
  const timer = $('#tool-timer');
  const status = $('#tool-status');
  let playing = false, deadline = 0;
  function render() {
    play.setAttribute('aria-pressed', String(playing));
    play.setAttribute('aria-label', (playing ? 'Pausar ' : 'Tocar ') + play.dataset.label);
    play.innerHTML = icon(playing ? 'pause' : 'play');
  }
  async function setPlaying(next) {
    try {
      await audio.set(channel, next ? Number(volume.value) / 100 : 0);
      playing = next;
      status.textContent = next ? 'Tocando. Ajuste o volume ao seu conforto.' : '';
      if (next && !deadline && Number(timer.value)) deadline = Date.now() + Number(timer.value) * 60000;
      if (!next) deadline = 0;
    } catch {
      status.textContent = 'Não foi possível iniciar o áudio. Toque novamente para tentar.';
    }
    render();
  }
  play.addEventListener('click', () => setPlaying(!playing));
  volume.addEventListener('input', () => { volumeValue.textContent = volume.value + '%'; if (playing) audio.set(channel, Number(volume.value) / 100).catch(() => {}); });
  timer.addEventListener('change', () => { deadline = Number(timer.value) && playing ? Date.now() + Number(timer.value) * 60000 : 0; tickTimer(); });
  function tickTimer() {
    if (!deadline) { $('#tool-timer-status').textContent = ''; return; }
    const remaining = deadline - Date.now();
    if (remaining <= 0) { setPlaying(false); status.textContent = 'O tempo escolhido terminou. O som foi encerrado.'; }
    else $('#tool-timer-status').textContent = 'Restam ' + formatClock(remaining);
  }
  setInterval(tickTimer, 1000);
  render();
}

if (kind === 'breath') {
  const plan = createNamedPlan(body.dataset.pattern);
  const start = $('#tool-start'), stop = $('#tool-stop');
  const phase = $('#tool-phase'), count = $('#tool-count'), cycle = $('#tool-cycle'), status = $('#tool-status'), orb = $('#tool-orb');
  let state = 'idle', elapsed = 0, started = 0, frame = 0, lastKey = '';
  function controls(locked) { start.textContent = state === 'running' ? 'Pausar' : state === 'paused' ? 'Continuar' : state === 'complete' ? 'Fazer outra pausa' : 'Começar'; stop.hidden = !locked; }
  function reset() { cancelAnimationFrame(frame); state = 'idle'; elapsed = 0; lastKey = ''; controls(false); phase.textContent = 'No seu tempo'; count.textContent = '—'; cycle.textContent = `${plan.cycles} ciclos, sem pressa`; orb.style.transform = 'scale(1)'; }
  function tick(now) {
    if (state !== 'running') return;
    const step = breathAt(plan, elapsed + now - started);
    if (step.complete) { state = 'complete'; controls(false); phase.textContent = 'Completa'; count.textContent = '✓'; cycle.textContent = 'Sua pausa está completa.'; status.textContent = 'Sua pausa está completa.'; orb.style.transform = 'scale(1)'; return; }
    const key = step.cycle + step.type;
    if (key !== lastKey) { lastKey = key; phase.textContent = step.label; cycle.textContent = `Ciclo ${step.cycle} de ${plan.cycles}`; status.textContent = `${step.label}. Ciclo ${step.cycle} de ${plan.cycles}.`; }
    count.textContent = step.remaining;
    const ease = .5 - .5 * Math.cos(Math.PI * step.progress);
    const scale = step.type === 'in' ? .82 + .38 * ease : step.type === 'hold' ? 1.2 : step.type === 'hold-empty' ? .82 : 1.2 - .38 * ease;
    orb.style.transform = reduced.matches ? 'scale(1)' : `scale(${scale})`;
    frame = requestAnimationFrame(tick);
  }
  start.addEventListener('click', () => {
    if (state === 'running') { elapsed += performance.now() - started; state = 'paused'; cancelAnimationFrame(frame); controls(true); phase.textContent = 'Sua pausa'; status.textContent = 'Sessão pausada. Continue quando quiser.'; }
    else { if (state !== 'paused') { elapsed = 0; lastKey = ''; } state = 'running'; started = performance.now(); controls(true); frame = requestAnimationFrame(tick); }
  });
  stop.addEventListener('click', () => { reset(); status.textContent = 'Sessão encerrada.'; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'running') start.click(); });
  reset();
}

if (kind === 'focus') {
  const total = Number(body.dataset.minutes) * 60000;
  const start = $('#tool-start'), resetButton = $('#tool-reset');
  const clock = $('#tool-clock'), phase = $('#tool-focus-phase'), status = $('#tool-status');
  let state = 'idle', elapsed = 0, started = 0, frame = 0;
  function controls() { start.textContent = state === 'running' ? 'Pausar' : state === 'paused' ? 'Continuar' : state === 'complete' ? 'Começar outro bloco' : 'Começar bloco'; resetButton.hidden = state === 'idle'; }
  function paint(remaining) { clock.textContent = formatClock(remaining); }
  function reset() { cancelAnimationFrame(frame); state = 'idle'; elapsed = 0; controls(); paint(total); phase.textContent = 'Um bloco, uma coisa'; status.textContent = ''; }
  function tick(now) {
    if (state !== 'running') return;
    const remaining = total - (elapsed + now - started);
    if (remaining <= 0) { state = 'complete'; controls(); paint(0); phase.textContent = 'Bloco completo'; status.textContent = 'Bloco completo. Descansar também faz parte.'; return; }
    paint(remaining);
    frame = requestAnimationFrame(tick);
  }
  start.addEventListener('click', () => {
    if (state === 'running') { elapsed += performance.now() - started; state = 'paused'; cancelAnimationFrame(frame); controls(); phase.textContent = 'Sua pausa'; status.textContent = 'Bloco pausado. Continue quando quiser.'; }
    else { if (state === 'complete' || state === 'idle') elapsed = 0; state = 'running'; started = performance.now(); controls(); phase.textContent = 'Atenção em uma coisa'; frame = requestAnimationFrame(tick); }
  });
  resetButton.addEventListener('click', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'running') start.click(); });
  reset();
}