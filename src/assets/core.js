export const quotes = [
  'Você pode ir com calma e ainda assim seguir em frente.',
  'Nem tudo precisa encontrar resposta hoje.',
  'Uma pausa também faz parte do caminho.',
  'O próximo instante pode ser mais simples.',
  'Dê ao seu dia um pouco do espaço que você dá aos outros.',
  'Você não precisa transformar cada momento em uma tarefa.',
  'Voltar ao que é pequeno pode abrir espaço por dentro.',
  'Há dias em que seguir devagar já é seguir.',
  'O que pode esperar não precisa ocupar este instante.',
  'Seu descanso não precisa ser merecido. Ele pode ser cuidado.',
  'Deixe uma coisa para depois e um pouco de espaço para agora.',
  'Um começo pequeno ainda é um começo inteiro.',
  'Você pode terminar o dia sem terminar todas as coisas.',
  'Existe um ritmo em que também cabe você.',
  'Uma janela aberta. Um copo de água. Um recomeço possível.',
  'O dia não precisa ser perfeito para ter um instante bom.',
  'Você pode mudar de ritmo sem abandonar o caminho.',
  'Às vezes, cuidar é diminuir a lista.',
  'Seu tempo não precisa ter a velocidade do mundo.',
  'Antes de fazer mais, perceba como você está.',
  'Um lugar tranquilo pode começar com um pequeno gesto.',
  'Nem todo silêncio precisa ser preenchido.',
  'Escolher uma coisa também é dar descanso às outras.',
  'Você pode estar aqui sem resolver tudo.',
  'Deixe o próximo passo caber no seu dia.',
  'Há espaço para respirar entre uma coisa e outra.',
  'Uma rotina gentil também deixa espaço para mudar.',
  'Comece pelo que torna este instante um pouco mais leve.',
  'O descanso pode ser simples. Você também pode.',
  'Volte quando fizer sentido. A pausa continua aqui.',
  'Estar presente pode começar com perceber os próprios pés.'
];

export function createBreathPlan(selection = 'cycles5', withHold = false) {
  const hold = withHold ? 3000 : 0;
  const cycleSelections = { cycles3: 3, cycles5: 5 };
  const timeSelections = { time60: 60000, time180: 180000, time300: 300000, time600: 600000 };
  const target = timeSelections[selection];
  const count = target ? Math.max(1, Math.round(target / (10000 + hold))) : (cycleSelections[selection] || 5);
  const flow = target ? (target - count * hold) / (2 * count) : 5000;
  const steps = [];
  let at = 0;
  for (let cycle = 1; cycle <= count; cycle++) {
    const phases = [{ type: 'in', label: 'Inspire', ms: flow }, ...(hold ? [{ type: 'hold', label: 'Faça uma pausa', ms: hold }] : []), { type: 'out', label: 'Solte o ar', ms: flow }];
    for (const phase of phases) {
      steps.push({ ...phase, cycle, at, end: at + phase.ms });
      at += phase.ms;
    }
  }
  return { steps, cycles: count, duration: target || at, withHold };
}

export const breathPatterns = {
  '4-7-8': { label: 'Respiração 4-7-8', cycles: 4, phases: [['in', 4000, 'Inspire pelo nariz'], ['hold', 7000, 'Segure o ar'], ['out', 8000, 'Solte pela boca']] },
  quadrada: { label: 'Respiração quadrada', cycles: 4, phases: [['in', 4000, 'Inspire'], ['hold', 4000, 'Segure o ar'], ['out', 4000, 'Solte o ar'], ['hold-empty', 4000, 'Segure sem ar']] },
  coerente: { label: 'Respiração coerente', cycles: 6, phases: [['in', 5500, 'Inspire'], ['out', 5500, 'Solte o ar']] }
};

export function createNamedPlan(id, cyclesOverride) {
  const pattern = breathPatterns[id];
  if (!pattern) throw new Error('Este padrão de respiração não está disponível.');
  const cycles = Math.max(1, Math.min(20, Math.round(cyclesOverride || pattern.cycles)));
  const steps = [];
  let at = 0;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const [type, ms, label] of pattern.phases) {
      steps.push({ type, label, ms, cycle, at, end: at + ms });
      at += ms;
    }
  }
  return { steps, cycles, duration: at, pattern: id };
}

// "rain:40,ocean:35" — percentuais inteiros; nomes fora da lista e valores inválidos são ignorados.
export function parseMix(raw, allowed) {
  if (typeof raw !== 'string' || !raw) return null;
  const names = new Set(allowed);
  const mix = {};
  for (const part of raw.split(',').slice(0, 12)) {
    const [name, value] = part.split(':');
    if (!names.has(name)) continue;
    const percent = Number(value);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) continue;
    mix[name] = percent / 100;
  }
  return Object.keys(mix).length ? mix : null;
}

export function mixParam(volumes) {
  const parts = Object.entries(volumes).filter(([, value]) => value > 0).map(([name, value]) => `${name}:${Math.round(value * 100)}`);
  return parts.length ? parts.join(',') : null;
}

export function breathAt(plan, elapsed) {
  const time = Math.max(0, elapsed);
  if (time >= plan.duration - 0.01) return { complete: true };
  const step = plan.steps.find(step => time < step.end) || plan.steps.at(-1);
  const progress = Math.min(1, Math.max(0, (time - step.at) / step.ms));
  // Give zero a short visible moment without extending the advertised duration.
  const remaining = Math.max(0, Math.ceil((step.end - time - 140) / 1000));
  return { ...step, complete: false, progress, remaining };
}

export function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000) || 0);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function dailyQuote(date = new Date()) {
  // Calendar-day arithmetic avoids daylight-saving shifts and repeats yearly.
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  return quotes[(day - 1) % quotes.length];
}

export function makeStore(storage) {
  const memory = new Map();
  let persistent = false;
  try { storage.setItem('acalmo:probe', '1'); storage.removeItem('acalmo:probe'); persistent = true; } catch { /* Memory-only mode remains usable. */ }
  return {
    get persistent() { return persistent; },
    read(key, fallback = null) {
      try { const raw = persistent ? storage.getItem('acalmo:' + key) : memory.get(key); return raw === null || raw === undefined ? fallback : JSON.parse(raw); } catch { return fallback; }
    },
    write(key, value) {
      const raw = JSON.stringify(value);
      memory.set(key, raw);
      if (persistent) { try { storage.setItem('acalmo:' + key, raw); return true; } catch { persistent = false; } }
      return false;
    },
    remove(key) { memory.delete(key); try { storage.removeItem('acalmo:' + key); } catch { /* Storage may be unavailable. */ } }
  };
}

export function affiliateUrl(query, storeId) {
  const url = new URL('https://www.amazon.com.br/s');
  url.searchParams.set('k', query);
  if (/^[a-zA-Z0-9-]+$/.test(storeId || '')) url.searchParams.set('tag', storeId);
  return url.href;
}
