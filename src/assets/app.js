import AmbientAudio from './audio.js';
import { config } from './config.js';
import { createBreathPlan, createNamedPlan, breathPatterns, breathAt, formatClock, dailyQuote, makeStore, affiliateUrl, parseMix, mixParam } from './core.js';
import { imagePlacement, waterOutline, waterExclusions, isInsideWater } from './water-mask.js';
import WaterRenderer from './water-renderer.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const shapes = {
  moon:'<path d="M20.7 13.4A8.4 8.4 0 0 1 10.6 3.3 8.5 8.5 0 1 0 20.7 13.4Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  down:'<path d="M12 4v16m-6-6 6 6 6-6"/>',
  sparkle:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/>',
  ripple:'<ellipse cx="12" cy="15" rx="9" ry="5"/><ellipse cx="12" cy="15" rx="5" ry="2.5"/><path d="M12 3v6"/>',
  pen:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
  leaf:'<path d="M20 3S7 1 4 9s6 14 12 8S20 3 20 3ZM4 21 15 10"/>',
  rain:'<path d="M5 13a5 5 0 0 1 1-10 7 7 0 0 1 12 3 4 4 0 0 1 0 8M7 16l-1 4m6-4-1 5m6-5-1 4"/>',
  waves:'<path d="M2 7c3-4 7 4 10 0s7 4 10 0M2 12c3-4 7 4 10 0s7 4 10 0M2 17c3-4 7 4 10 0s7 4 10 0"/>',
  trees:'<path d="m8 3-5 7h3l-4 6h12l-4-6h3L8 3Zm0 13v5m8-15 3 4h-2l4 7h-6m1 0v4"/>',
  fire:'<path d="M12 2c1 5 7 7 7 13a7 7 0 0 1-14 0c0-3 2-5 4-7-1 5 2 5 2 5s3-5 1-11Z"/>',
  play:'<path d="m8 4 12 8-12 8V4Z"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  share:'<path d="M12 16V3m-5 5 5-5 5 5M5 12H3v9h18v-9h-2"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>'
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${shapes[name] || shapes.leaf}</svg>`; }
function renderIcons(parent = document) { $$('[data-icon]', parent).forEach(node => { node.innerHTML = icon(node.dataset.icon); }); }
renderIcons();
let local;
try { local = window.localStorage; } catch { local = null; }
const store = makeStore(local);
const audio = new AmbientAudio();
const soundNames = { rain: 'Chuva mansa', ocean: 'Mar tranquilo', forest: 'Brisa na mata', fire: 'Lareira acesa', brown: 'Ruído marrom', white: 'Ruído branco', pink: 'Ruído rosa' };
let toastTimer;
function toast(text) { const node = $('#toast'); node.textContent = text; node.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 4200); }

// Native dialogs keep keyboard focus inside the current experience.
const triggers = new Map();
function openDialog(id, trigger = document.activeElement) { const dialog = $('#' + id); if (dialog.open) return; triggers.set(dialog, trigger); dialog.showModal(); }
function closeDialog(dialog) { dialog.close(); }
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog($('#' + button.dataset.close))));
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { const trigger = triggers.get(dialog); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
});

// Abaixo de 800px a navegação vive neste diálogo; âncoras precisam fechá-lo antes de rolar.
const menuOpen = $('#menu-open');
if (menuOpen) { const menuDialog = $('#menu-dialog'); menuOpen.addEventListener('click', event => openDialog('menu-dialog', event.currentTarget)); $$('a', menuDialog).forEach(link => link.addEventListener('click', () => menuDialog.close())); }

// Theme choice is local; no server-side profile is needed.
const themeButton = $('#theme-toggle');
function renderTheme() { const dark = document.documentElement.dataset.theme === 'dark'; themeButton.setAttribute('aria-pressed', String(dark)); themeButton.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo noturno'); themeButton.innerHTML = icon(dark ? 'sun' : 'moon'); $('meta[name="theme-color"]').content = dark ? '#172a24' : '#f5f2e9'; }
themeButton.addEventListener('click', () => { const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { local?.setItem('acalmo:theme', dark ? 'dark' : 'light'); } catch { /* Theme still works for this visit. */ } renderTheme(); });
renderTheme();
$('#year').textContent = new Date().getFullYear();

// One full-image GPU surface keeps the photograph aligned; the shore fades inward.
const waterCanvas = $('#hero-water');
const hero = $('#hero-surface');
const landscape = $('.hero-image');
const waterScene = new WaterRenderer(waterCanvas,landscape);
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
let waterWidth = 0, waterHeight = 0, waterFrame = 0, lastPaint = 0, visible = true, motionPaused = reducedMotion.matches;
let ripples = [], lastRipple = 0;
let waterPolygon = [], waterHoles = [], waterPlacement;
const motionButton = document.createElement('button');
motionButton.className = 'hero-motion';
$('.hero-bottom').insertBefore(motionButton, $('.hero-bottom a'));
function motionState() { motionButton.innerHTML = icon(motionPaused ? 'play' : 'pause') + `<span>${motionPaused ? 'Animar água' : 'Pausar animação'}</span>`; motionButton.setAttribute('aria-pressed', String(!motionPaused)); }
motionState();
motionButton.addEventListener('click', () => { motionPaused = !motionPaused; ripples = []; motionState(); if (motionPaused) { cancelAnimationFrame(waterFrame); waterFrame = 0; waterScene.clear(); } else requestWater(); });
function requestWater() { if (!waterFrame && !motionPaused && visible && !document.hidden && waterCanvas.dataset.waterRenderer!=='static') waterFrame = requestAnimationFrame(paintWater); }
function sizeWater() {
  const r = hero.getBoundingClientRect();
  const position=getComputedStyle(landscape).objectPosition.split(' ').map(value=>parseFloat(value)/100);
  waterWidth=r.width;waterHeight=r.height;
  waterPlacement=imagePlacement(r.width,r.height,landscape.naturalWidth||1536,landscape.naturalHeight||1024,Number.isFinite(position[0])?position[0]:.5,Number.isFinite(position[1])?position[1]:.5);
  waterPolygon=waterOutline(waterPlacement);
  waterHoles=waterExclusions(waterPlacement);
  waterScene.resize({width:waterWidth,height:waterHeight,placement:waterPlacement});
  requestWater();
}
function paintWater(now) {
  waterFrame = 0;
  if (motionPaused || !visible || document.hidden) return;
  if (now - lastPaint < 32) { requestWater(); return; }
  lastPaint = now;
  ripples = ripples.filter(r => now - r.born < 3500);
  waterScene.render(now,ripples);
  requestWater();
}
function waterPointer(event) { if (motionPaused || event.target.closest('button,a')) return; const now = performance.now(); if (now - lastRipple < 130) return; const r = hero.getBoundingClientRect(); const x=event.clientX-r.left,y=event.clientY-r.top; if (!isInsideWater(x,y,waterPolygon,waterHoles)) return; ripples.push({ x, y, born: now }); ripples = ripples.slice(-6); lastRipple = now; requestWater(); }
hero.addEventListener('pointermove', waterPointer);
hero.addEventListener('pointerdown', waterPointer);
new ResizeObserver(sizeWater).observe(hero);
new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) requestWater(); else { cancelAnimationFrame(waterFrame); waterFrame = 0; } }).observe(hero);
landscape.addEventListener('load', sizeWater);
reducedMotion.addEventListener('change', event => { motionPaused = event.matches; motionState(); if (motionPaused) { cancelAnimationFrame(waterFrame); waterFrame = 0; waterScene.clear(); } else requestWater(); });
sizeWater();

// Breath timing uses elapsed active time, not a drifting decrementing counter.
let breathPlan = createBreathPlan(), breathState = 'idle', breathElapsed = 0, breathStarted = 0, breathFrame = 0, lastBreathPhase = '';
const breathDialog = $('#breath-dialog'), breathStart = $('#breath-start'), breathSelection = $('#breath-duration'), breathHold = $('#breath-hold'), breathPattern = $('#breath-pattern');
function currentBreathPlan() { return breathPattern.value === 'free' ? createBreathPlan(breathSelection.value, breathHold.checked) : createNamedPlan(breathPattern.value); }
function breathPreview() { const hold = breathHold.checked; breathSelection.options[0].textContent = `3 ciclos · ${hold ? 39 : 30} segundos`; breathSelection.options[1].textContent = `5 ciclos · ${hold ? 65 : 50} segundos`; }
breathHold.addEventListener('change', breathPreview);
breathPattern.addEventListener('change', () => { if (breathState === 'idle') { breathPlan = currentBreathPlan(); resetBreath(); } else breathControls(true); });
function breathControls(locked) { const named = breathPattern.value !== 'free'; breathSelection.disabled = locked || named; breathHold.disabled = locked || named; breathPattern.disabled = locked; $('#breath-stop').hidden = !locked; }
function openBreath(selection = 'cycles5', trigger, pattern = 'free') { if (!['running', 'paused'].includes(breathState)) { breathPattern.value = Object.hasOwn(breathPatterns, pattern) ? pattern : 'free'; breathSelection.value = selection; breathPlan = currentBreathPlan(); resetBreath(); } openDialog('breath-dialog', trigger); }
function resetBreath() { cancelAnimationFrame(breathFrame); breathState = 'idle'; breathElapsed = 0; lastBreathPhase = ''; breathControls(false); breathStart.textContent = 'Começar'; $('#breath-phase').textContent = 'No seu tempo'; $('#breath-number').textContent = '—'; $('#breath-cycle').textContent = breathPattern.value === 'free' ? 'Uma respiração de cada vez.' : `${breathPatterns[breathPattern.value].label} · ${breathPlan.cycles} ciclos`; $('#breath-orb').style.transform = 'scale(1)'; }
function startBreath() { breathPlan = currentBreathPlan(); breathState = 'running'; breathElapsed = 0; breathStarted = performance.now(); lastBreathPhase = ''; breathControls(true); breathStart.textContent = 'Pausar'; breathFrame = requestAnimationFrame(tickBreath); }
function pauseBreath() { if (breathState !== 'running') return; breathElapsed += performance.now() - breathStarted; breathState = 'paused'; cancelAnimationFrame(breathFrame); breathStart.textContent = 'Continuar'; $('#breath-phase').textContent = 'Sua pausa'; $('#breath-cycle').textContent = 'Continue quando quiser.'; $('#breath-status').textContent = 'Sessão pausada. Continue quando quiser.'; }
function tickBreath(now) {
  if (breathState !== 'running') return;
  const step = breathAt(breathPlan, breathElapsed + now - breathStarted);
  if (step.complete) { breathState = 'complete'; breathControls(false); breathStart.textContent = 'Fazer outra pausa'; $('#breath-phase').textContent = 'Tudo no seu tempo'; $('#breath-number').textContent = '✓'; $('#breath-cycle').textContent = 'Sua pausa está completa.'; $('#breath-status').textContent = 'Sua pausa está completa.'; $('#breath-orb').style.transform = 'scale(1)'; return; }
  const phaseKey = step.cycle + step.type;
  if (phaseKey !== lastBreathPhase) { lastBreathPhase = phaseKey; $('#breath-phase').textContent = step.label; $('#breath-cycle').textContent = `Ciclo ${step.cycle} de ${breathPlan.cycles}`; $('#breath-status').textContent = `${step.label}. Ciclo ${step.cycle} de ${breathPlan.cycles}.`; }
  $('#breath-number').textContent = step.remaining;
  const ease = .5 - .5 * Math.cos(Math.PI * step.progress);
  const scale = step.type === 'in' ? .82 + .38 * ease : step.type === 'hold' ? 1.2 : step.type === 'hold-empty' ? .82 : 1.2 - .38 * ease;
  $('#breath-orb').style.transform = reducedMotion.matches ? 'scale(1)' : `scale(${scale})`;
  breathFrame = requestAnimationFrame(tickBreath);
}
breathStart.addEventListener('click', () => { if (breathState === 'running') pauseBreath(); else if (breathState === 'paused') { breathState = 'running'; breathStarted = performance.now(); lastBreathPhase = ''; breathStart.textContent = 'Pausar'; breathFrame = requestAnimationFrame(tickBreath); } else startBreath(); });
$('#breath-stop').addEventListener('click', () => { resetBreath(); $('#breath-status').textContent = 'Sessão encerrada.'; });
breathDialog.addEventListener('close', () => pauseBreath());
$$('[data-breathe]').forEach(button => button.addEventListener('click', () => openBreath(button.dataset.breathe, button)));
document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseBreath(); cancelAnimationFrame(waterFrame); waterFrame = 0; } else { requestWater(); tickFocus(); checkSoundTimer(); } });

// Intent-based entry keeps the home page small while giving each tool a purpose.
const intentions = {
  calm: { title: 'Volte à sua respiração.', text: 'Acompanhe um movimento suave por alguns ciclos. Sem pressa, sem precisar fazer perfeito.', action: 'Respirar agora', favorite: 'breathing' },
  rest: { title: 'Prepare um cantinho de descanso.', text: 'Escolha um som suave, diminua o volume e experimente um instante sem outras tarefas.', action: 'Escolher meus sons', favorite: 'sounds' },
  focus: { title: 'Dê espaço a uma coisa só.', text: 'Escolha uma tarefa pequena e um bloco de atenção. Depois, deixe o descanso fazer parte.', action: 'Encontrar meu foco', favorite: 'focus' },
  write: { title: 'Tire um pouco da cabeça.', text: 'Três perguntas para escrever sem precisar organizar tudo. O texto não é enviado ao Acalmo.', action: 'Abrir minha escrita', favorite: 'journal' },
  silence: { title: 'Um minuto só para estar aqui.', text: 'Sem som. Sem tarefa. Apenas um movimento suave, se acompanhar a respiração fizer sentido para você.', action: 'Fazer uma pausa', favorite: 'breathing' }
};
let currentIntent = 'calm';
$$('[data-intent]').forEach(button => button.addEventListener('click', () => { currentIntent = button.dataset.intent; const intent = intentions[currentIntent]; $$('[data-intent]').forEach(node => { const selected = node === button; node.classList.toggle('selected', selected); node.setAttribute('aria-pressed', String(selected)); }); $('#recommendation-title').textContent = intent.title; $('#recommendation-text').textContent = intent.text; $('#recommendation-start').textContent = intent.action; const save = $('[data-save]', $('#recommendation')); save.dataset.save = intent.favorite; save.setAttribute('aria-label', `Guardar ${favoriteMeta[intent.favorite].label.toLowerCase()} no meu espaço`); renderFavorites(); }));
$('#recommendation-start').addEventListener('click', event => { if (currentIntent === 'rest') $('#sons').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' }); else if (currentIntent === 'write') openJournal(event.currentTarget); else if (currentIntent === 'focus') openFocus(event.currentTarget); else openBreath(currentIntent === 'silence' ? 'time60' : 'cycles5', event.currentTarget); });

// Sea ambience is the default; browser autoplay rules and an explicit mute are respected.
let defaultSeaPending=store.read('sound-preference',true)!==false, defaultSeaBusy=false;
const heroAudio=document.createElement('button');
heroAudio.id='hero-audio';heroAudio.className='hero-sound';heroAudio.type='button';
hero.append(heroAudio);
let soundDeadline = 0, audioPaused = false;
function renderAudio() {
  const volumes = audio.volumes;
  const any = Object.values(volumes).some(value => value > 0);
  if (!any) { soundDeadline = 0; $('#sound-timer-status').textContent = ''; }
  $$('.sound-toggle').forEach(button => { const name = button.dataset.sound; const selected = Boolean(volumes[name] > 0); button.setAttribute('aria-pressed', String(selected)); button.setAttribute('aria-label', (selected ? 'Desligar ' : 'Tocar ') + soundNames[name]); button.innerHTML = icon(selected && !audioPaused ? 'pause' : 'play'); });
  $$('.noise-toggle').forEach(button => { const selected = Boolean(volumes[button.dataset.noise] > 0); button.setAttribute('aria-pressed', String(selected)); button.classList.toggle('selected', selected); });
  $('#audio-pause').disabled = !any; $('#audio-stop').disabled = !any; $('#audio-pause').innerHTML = icon(audioPaused ? 'play' : 'pause') + (audioPaused ? 'Continuar sons' : 'Pausar sons');
  const seaPlaying=Boolean(volumes.ocean>0)&&audio.playing&&!audioPaused;
  heroAudio.innerHTML=icon(seaPlaying?'pause':'waves')+'<span>'+(seaPlaying?'Mar tranquilo · pausar':'Ativar som do mar')+'</span>';
  heroAudio.setAttribute('aria-pressed',String(seaPlaying));
  heroAudio.setAttribute('aria-label',seaPlaying?'Pausar som do mar':'Ativar som do mar');
}
async function changeSound(name, value) { defaultSeaPending=false;store.write('sound-preference',value>0);try { await audio.set(name, value); audioPaused = false; if (value > 0 && !soundDeadline && Number($('#sound-timer').value)) soundDeadline = Date.now() + Number($('#sound-timer').value) * 60000; $('#sound-status').textContent = ''; renderAudio(); } catch { $('#sound-status').textContent = 'Não foi possível iniciar o áudio. Tente tocar novamente ou use outro navegador.'; } }
$$('.sound-toggle').forEach(button => button.addEventListener('click', () => { const name = button.dataset.sound; const selected = audio.volumes[name] > 0; const input = $('#volume-' + name); if (!selected && Number(input.value) === 0) { input.value = '35'; $('#value-' + name).textContent = '35%'; } changeSound(name, selected ? 0 : Number(input.value) / 100); }));
$$('[data-volume]').forEach(input => input.addEventListener('input', () => { const name = input.dataset.volume; $('#value-' + name).textContent = input.value + '%'; if (audio.volumes[name] > 0) changeSound(name, Number(input.value) / 100); }));
$$('.noise-toggle').forEach(button => button.addEventListener('click', () => { const name = button.dataset.noise; changeSound(name, audio.volumes[name] > 0 ? 0 : 0.45); }));
$('#audio-pause').addEventListener('click', async () => { defaultSeaPending=false;try { if (audioPaused) { await audio.resume(); audioPaused = false; } else { await audio.pause(); audioPaused = true; } store.write('sound-preference',!audioPaused);renderAudio(); } catch { $('#sound-status').textContent = 'Toque novamente para retomar os sons.'; } });
async function stopSounds() { defaultSeaPending=false;store.write('sound-preference',false);await audio.stopAll(); soundDeadline = 0; audioPaused = false; renderAudio(); $('#sound-timer-status').textContent = ''; }
$('#audio-stop').addEventListener('click', stopSounds);
$('#sound-timer').addEventListener('change', () => { const minutes = Number($('#sound-timer').value); soundDeadline = minutes && Object.values(audio.volumes).some(v => v > 0) ? Date.now() + minutes * 60000 : 0; if (minutes && !soundDeadline) $('#sound-timer-status').textContent = 'O tempo começa ao tocar um som.'; else checkSoundTimer(); });
function checkSoundTimer() { if (!soundDeadline) return; const remaining = soundDeadline - Date.now(); if (remaining <= 0) { stopSounds(); $('#sound-status').textContent = 'O tempo escolhido terminou. Os sons foram encerrados.'; } else $('#sound-timer-status').textContent = 'Restam ' + formatClock(remaining); }
setInterval(checkSoundTimer, 1000);
heroAudio.addEventListener('click',()=>{const playing=audio.volumes.ocean>0&&audio.playing&&!audioPaused;changeSound('ocean',playing?0:.18);});
async function startDefaultSea(gesture=false){
  if(!defaultSeaPending||defaultSeaBusy||document.hidden)return;
  defaultSeaBusy=true;
  try{
    const started=gesture?(await audio.set('ocean',.18),true):await audio.tryAutoplay('ocean',.18);
    if(started){defaultSeaPending=false;audioPaused=false;$('#volume-ocean').value='18';$('#value-ocean').textContent='18%';}
  }catch{ /* The visible sound control remains available after a blocked attempt. */ }
  finally{defaultSeaBusy=false;renderAudio();}
}
// Uma única tentativa de liberar o áudio na primeira interação livre; tocar em um controle é escolha de outra coisa.
function unlockDefaultSea(event){
  if(!event.isTrusted)return;
  if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
  document.removeEventListener('pointerdown',unlockDefaultSea,true);
  document.removeEventListener('keydown',unlockDefaultSea,true);
  if(event.target.closest('a,button,input,select,textarea,summary,label'))return;
  startDefaultSea(true);
}
document.addEventListener('pointerdown',unlockDefaultSea,{capture:true});
document.addEventListener('keydown',unlockDefaultSea,{capture:true});
renderAudio();
startDefaultSea();
$('[data-intent="silence"]').addEventListener('click',()=>{stopSounds().catch(()=>{});});

// Journal is ephemeral unless the visitor explicitly saves it to this browser.
const journalFields = ['#journal-one', '#journal-two', '#journal-three'];
const savedJournal = store.read('journal');
if (savedJournal && Array.isArray(savedJournal.answers) && savedJournal.answers.length === 3) { journalFields.forEach((selector, i) => { $(selector).value = String(savedJournal.answers[i] || '').slice(0, 4000); }); $('#journal-persist').checked = true; }
function openJournal(trigger) { openDialog('journal-dialog', trigger); }
$('#journal-open').addEventListener('click', event => openJournal(event.currentTarget));
$('#journal-form').addEventListener('submit', event => { event.preventDefault(); const answers = journalFields.map(selector => $(selector).value); if (!answers.some(value => value.trim())) { $('#journal-status').textContent = 'Você pode escrever um pouco ou simplesmente fechar e voltar depois.'; return; } if ($('#journal-persist').checked) { const saved = store.write('journal', { answers, date: new Date().toISOString() }); $('#journal-status').textContent = saved ? 'Seu texto foi guardado neste navegador. Por agora, uma coisa de cada vez.' : 'O navegador não permitiu salvar. Seu texto continua nesta página; baixe uma cópia se quiser guardar.'; } else { store.remove('journal'); $('#journal-status').textContent = 'Sua escrita ficou apenas nesta página. Você pode fechar e respirar um pouco.'; } });
$('#journal-persist').addEventListener('change', event => { if (!event.target.checked) { store.remove('journal'); $('#journal-status').textContent = 'O texto salvo foi removido. A versão aberta continua nesta página.'; } });
function download(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000); }
$('#journal-export').addEventListener('click', () => { const questions = ['O que está ocupando a sua cabeça?', 'O que pode esperar um pouco?', 'Qual pequeno cuidado cabe neste momento?']; const text = 'Meu espaço de escrita — Acalmo\n\n' + journalFields.map((selector, i) => questions[i] + '\n' + $(selector).value).join('\n\n'); download(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'minha-pausa-acalmo.txt'); $('#journal-status').textContent = 'Seu texto foi preparado para download no dispositivo.'; });
$('#journal-delete').addEventListener('click', () => { if (!journalFields.some(selector => $(selector).value) && !store.read('journal')) return; if (!window.confirm('Apagar este texto da página e deste navegador? Baixe uma cópia antes, se quiser guardá-lo.')) return; journalFields.forEach(selector => { $(selector).value = ''; }); $('#journal-persist').checked = false; store.remove('journal'); $('#journal-status').textContent = 'O texto foi apagado deste navegador.'; });

// A focus block has a real deadline and never starts another block automatically.
let focusMode = 'work', focusState = 'idle', focusRemaining = 25 * 60000, focusDeadline = 0;
const focusStart = $('#focus-start'), focusLength = $('#focus-length');
function focusDuration() { return Number(focusLength.value) * (focusMode === 'rest' ? .2 : 1) * 60000; }
function renderFocus() { const text = formatClock(focusRemaining); $('#focus-clock').textContent = text; $('#focus-phase').textContent = focusMode === 'work' ? 'Momento de concentração' : 'Momento de descanso'; focusLength.disabled = focusState === 'running' || focusState === 'paused'; focusStart.textContent = focusState === 'running' ? 'Pausar' : focusState === 'paused' ? 'Continuar' : focusMode === 'work' ? 'Começar foco' : 'Começar descanso'; if (focusState === 'running') document.title = text + ' · ' + (focusMode === 'work' ? 'Foco' : 'Descanso') + ' · Acalmo'; else document.title = 'Acalmo — um lugar para desacelerar'; }
function tickFocus() { if (focusState !== 'running') return; focusRemaining = Math.max(0, focusDeadline - Date.now()); if (!focusRemaining) { focusState = 'idle'; const wasWork = focusMode === 'work'; focusMode = wasWork ? 'rest' : 'work'; focusRemaining = focusDuration(); const message = wasWork ? 'Seu bloco terminou. Um pouco de descanso também faz parte.' : 'Seu descanso terminou. Continue só se fizer sentido.'; $('#focus-instruction').textContent = message; $('#focus-status').textContent = message; toast(message); } renderFocus(); }
function openFocus(trigger) { openDialog('focus-dialog', trigger); renderFocus(); }
$('#focus-open').addEventListener('click', event => openFocus(event.currentTarget));
focusStart.addEventListener('click', () => { if (focusState === 'running') { focusRemaining = Math.max(0, focusDeadline - Date.now()); focusState = 'paused'; } else { focusDeadline = Date.now() + focusRemaining; focusState = 'running'; } renderFocus(); });
$('#focus-reset').addEventListener('click', () => { focusMode = 'work'; focusState = 'idle'; focusRemaining = focusDuration(); $('#focus-instruction').textContent = 'Escolha uma tarefa pequena e dê espaço a ela.'; renderFocus(); });
focusLength.addEventListener('change', () => { focusMode = 'work'; focusRemaining = focusDuration(); renderFocus(); });
// Fechar o diálogo preserva o bloco em pausa: sem isso o cronômetro seguiria reescrevendo o título da aba.
$('#focus-dialog').addEventListener('close', () => { if (focusState === 'running') { focusRemaining = Math.max(0, focusDeadline - Date.now()); focusState = 'paused'; } renderFocus(); });
setInterval(tickFocus, 250);

// Original daily reflection; dates use the visitor's local calendar day.
let todayQuote = dailyQuote();
$('#daily-quote').textContent = todayQuote;
let quoteDate = new Date().toDateString();
setInterval(() => { if (quoteDate !== new Date().toDateString()) { quoteDate = new Date().toDateString(); todayQuote = dailyQuote(); $('#daily-quote').textContent = todayQuote; renderQuoteSave(); } }, 60000);
async function quoteImage() {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1080;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eae9dc'; ctx.fillRect(0, 0, 1080, 1080);
  if (landscape.complete && landscape.naturalWidth) { ctx.save(); ctx.globalAlpha = .18; ctx.drawImage(landscape, 0, 330, 1080, 750); ctx.restore(); }
  ctx.strokeStyle = '#7d937b40'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.ellipse(920, 900, 200 + i * 40, 100 + i * 24, -.3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#344b3f'; ctx.textAlign = 'center'; ctx.font = '28px Arial'; ctx.fillText('Uma frase para hoje', 540, 200);
  ctx.font = '58px Georgia'; const words = todayQuote.split(' '), lines = []; let line = '';
  words.forEach(word => { const test = line ? line + ' ' + word : word; if (ctx.measureText(test).width > 850 && line) { lines.push(line); line = word; } else line = test; }); if (line) lines.push(line);
  const start = 490 - (lines.length - 1) * 39; lines.forEach((line, i) => ctx.fillText(line, 540, start + i * 78));
  ctx.font = '46px Georgia'; ctx.fillText('acalmo.', 540, 850); ctx.font = '23px Arial'; ctx.fillText('Um lugar para desacelerar.', 540, 904);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('image unavailable')), 'image/png'));
}
$('#quote-image').addEventListener('click', async () => { try { const blob = await quoteImage(); download(blob, 'uma-frase-acalmo.png'); $('#quote-status').textContent = 'Imagem preparada para salvar e compartilhar.'; } catch { $('#quote-status').textContent = 'Não foi possível preparar a imagem. Você ainda pode compartilhar a frase em texto.'; } });
$('#quote-share').addEventListener('click', async () => { const text = todayQuote + '\n\nAcalmo — um lugar para desacelerar.'; try { if (navigator.share) await navigator.share({ title: 'Uma frase do Acalmo', text, url: config.siteOrigin }); else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text + '\n' + config.siteOrigin); $('#quote-status').textContent = 'Frase e link copiados. Cole onde quiser compartilhar.'; } else $('#quote-status').textContent = 'Selecione a frase para copiar ou use “Salvar imagem”.'; } catch (error) { if (error.name !== 'AbortError') $('#quote-status').textContent = 'Use “Salvar imagem” ou copie a frase para compartilhar.'; } });

// Favorite data is text-only, validated, and rendered without user HTML.
const favoriteMeta = { breathing: { label: 'Respiração guiada', icon: 'ripple' }, sounds: { label: 'Paisagens sonoras', icon: 'waves' }, journal: { label: 'Descarregar a mente', icon: 'pen' }, focus: { label: 'Pausa de foco', icon: 'clock' } };
let favorites = store.read('favorites', []);
favorites = Array.isArray(favorites) ? favorites.filter(key => Object.hasOwn(favoriteMeta, key)) : [];
function renderFavorites() { $$('[data-save]').forEach(button => { const saved = favorites.includes(button.dataset.save); button.setAttribute('aria-pressed', String(saved)); if (button.classList.contains('save-button')) button.innerHTML = icon('heart') + (saved ? 'Guardado' : 'Guardar'); }); }
$$('[data-save]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.save; favorites = favorites.includes(key) ? favorites.filter(value => value !== key) : [...favorites, key]; const saved = store.write('favorites', favorites); renderFavorites(); toast(favorites.includes(key) ? saved ? 'Guardado no seu espaço.' : 'Guardado para esta visita. O navegador não permite salvar.' : 'Removido do seu espaço.'); }));
function renderQuoteSave() { const saved = store.read('quote') === todayQuote; $('#quote-save').setAttribute('aria-pressed', String(saved)); $('#quote-save').innerHTML = icon('heart') + (saved ? 'Frase guardada' : 'Guardar frase'); }
$('#quote-save').addEventListener('click', () => { if (store.read('quote') === todayQuote) { store.remove('quote'); toast('Frase removida do seu espaço.'); } else { const saved = store.write('quote', todayQuote); toast(saved ? 'Frase guardada no seu espaço.' : 'Frase guardada para esta visita.'); } renderQuoteSave(); });
$('#save-mix').addEventListener('click', () => { const mix = audio.volumes; if (!Object.values(mix).some(value => value > 0)) { toast('Escolha e toque um som antes de guardar a combinação.'); return; } const saved = store.write('mix', mix); toast(saved ? 'Combinação guardada no seu espaço.' : 'Combinação guardada para esta visita.'); });
function clearElement(node) { node.replaceChildren(); }
function makeButton(text, className, action) { const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = text; button.addEventListener('click', action); return button; }
function renderSpace() {
  const list = $('#favorites-list'); clearElement(list);
  if (!favorites.length) { const text = document.createElement('p'); text.className = 'empty-space'; text.textContent = 'Guarde suas experiências favoritas tocando no coração. Elas vão aparecer aqui quando você quiser voltar.'; list.append(text); }
  favorites.forEach(key => { const row = document.createElement('div'); row.className = 'favorite-row'; const decoration = document.createElement('span'); decoration.innerHTML = icon(favoriteMeta[key].icon); row.append(decoration); row.append(makeButton(favoriteMeta[key].label, 'favorite-open', () => { $('#space-dialog').close(); if (key === 'breathing') openBreath('cycles5', $('#space-open')); else if (key === 'journal') openJournal($('#space-open')); else if (key === 'focus') openFocus($('#space-open')); else $('#sons').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' }); })); const remove = makeButton('', 'favorite-remove', () => { favorites = favorites.filter(value => value !== key); store.write('favorites', favorites); renderFavorites(); renderSpace(); }); remove.innerHTML = icon('close'); remove.setAttribute('aria-label', 'Remover ' + favoriteMeta[key].label); row.append(remove); list.append(row); });
  const quote = $('#saved-quote'); clearElement(quote); const savedQuote = store.read('quote');
  if (typeof savedQuote === 'string' && savedQuote.length < 400) { const piece = document.createElement('div'); piece.className = 'saved-piece'; const label = document.createElement('p'); label.textContent = 'Uma frase que ficou'; const block = document.createElement('blockquote'); block.textContent = savedQuote; piece.append(label, block, makeButton('Remover frase', 'text-button', () => { store.remove('quote'); renderQuoteSave(); renderSpace(); })); quote.append(piece); }
  const mixNode = $('#saved-mix'); clearElement(mixNode); const mix = store.read('mix');
  if (mix && typeof mix === 'object' && Object.keys(soundNames).some(key => Number(mix[key]) > 0)) { const piece = document.createElement('div'); piece.className = 'saved-piece'; const label = document.createElement('p'); label.textContent = 'Minha paisagem: ' + Object.keys(soundNames).filter(key => Number(mix[key]) > 0).map(key => soundNames[key]).join(', '); piece.append(label, makeButton('Ouvir minha combinação', 'text-button', async () => { try { await stopSounds(); for (const key of Object.keys(soundNames)) { const value = Math.min(1, Math.max(0, Number(mix[key]) || 0)); if (value > 0) { const input = $('#volume-' + key); if (input) { input.value = Math.round(value * 100); $('#value-' + key).textContent = Math.round(value * 100) + '%'; } await changeSound(key, value); } } $('#space-dialog').close(); $('#sons').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' }); } catch { toast('Toque nos sons para iniciar sua paisagem.'); } }), makeButton('Remover combinação', 'text-button', () => { store.remove('mix'); renderSpace(); })); mixNode.append(piece); }
  if (!store.persistent) $('#storage-note').textContent = 'Este navegador não permite guardar dados. Seus favoritos ficam disponíveis só durante esta visita.';
}
$('#space-open').addEventListener('click', event => { renderSpace(); openDialog('space-dialog', event.currentTarget); });
renderFavorites(); renderQuoteSave();

// All affiliate links use the owner's supplied StoreID; no prices or reviews are invented.
const queries = { mask: 'mascara de dormir', notebook: 'caderno sem pauta', lamp: 'luminaria de mesa' };
$$('[data-affiliate]').forEach(link => { link.href = affiliateUrl(queries[link.dataset.affiliate], config.amazonStoreId); });
if (config.checkoutUrl) { try { const url = new URL(config.checkoutUrl); if (url.protocol === 'https:') { $('#product-buy').href = url.href; $('#product-buy').hidden = false; } } catch { /* Keep incomplete offers out of the visitor flow. */ } }

// Installation is optional; the PWA has no notification requests.
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#install-button').hidden = false; });
$('#install-open').addEventListener('click', event => openDialog('install-dialog', event.currentTarget));
$('#install-button').addEventListener('click', async () => { if (!installPrompt) return; try { await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === 'accepted') $('#install-description').textContent = 'O atalho foi solicitado ao seu navegador. O Acalmo continua disponível por aqui.'; } catch { /* O navegador pode recusar o convite a qualquer momento. */ } installPrompt = null; $('#install-button').hidden = true; });
window.addEventListener('appinstalled', () => { $('#install-description').textContent = 'O Acalmo foi instalado. Você pode abrir pela sua tela inicial.'; $('#install-button').hidden = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { $('#install-description').textContent += ' O modo offline não está disponível nesta visita.'; });
window.addEventListener('pagehide', event => { if (event.persisted) { audio.pause().catch(() => {}); audioPaused = true; renderAudio(); } else {audio.destroy().catch(() => {});waterScene.destroy();} cancelAnimationFrame(waterFrame); waterFrame = 0; pauseBreath(); });
window.addEventListener('pageshow', event => { if (event.persisted) { sizeWater(); tickFocus(); checkSoundTimer(); } });

// Deep links: a paisagem chega armada, nunca tocando sozinha — o navegador exige um gesto.
let pendingMix = null;
const mixPlay = $('#mix-play');
function armMix(mix) {
  pendingMix = mix;
  for (const [name, value] of Object.entries(mix)) { const input = $('#volume-' + name); if (input) { input.value = Math.round(value * 100); $('#value-' + name).textContent = Math.round(value * 100) + '%'; } }
  mixPlay.hidden = false;
  $('#sound-status').textContent = 'Sua paisagem chegou pelo link. Toque para ouvir.';
}
mixPlay.addEventListener('click', async () => { const mix = pendingMix; pendingMix = null; mixPlay.hidden = true; defaultSeaPending = false; for (const [name, value] of Object.entries(mix)) await changeSound(name, value); });
$('#mix-link').addEventListener('click', async () => {
  const param = mixParam(audio.volumes);
  if (!param) { toast('Toque um som antes de copiar o link da paisagem.'); return; }
  const url = config.siteOrigin + '/?mix=' + param;
  try { await navigator.clipboard.writeText(url); $('#sound-status').textContent = 'Link da paisagem copiado. Quem abrir ouve a mesma combinação.'; }
  catch { $('#sound-status').textContent = 'Copie o link da paisagem: ' + url; }
});
const entryParams = new URLSearchParams(location.search);
const entryMix = parseMix(entryParams.get('mix'), Object.keys(soundNames));
if (entryMix) { defaultSeaPending = false; armMix(entryMix); }
const entryPattern = entryParams.get('resp');
if (Object.hasOwn(breathPatterns, entryPattern || '')) openBreath('cycles5', null, entryPattern);
const entryFocus = Number(entryParams.get('foco'));
if ([...focusLength.options].some(option => Number(option.value) === entryFocus)) { focusLength.value = String(entryFocus); focusRemaining = focusDuration(); openFocus(null); }
