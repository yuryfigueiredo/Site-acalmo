import assert from 'node:assert/strict';
import { createBreathPlan, createNamedPlan, breathPatterns, breathAt, formatClock, dailyQuote, makeStore, affiliateUrl, parseMix, mixParam } from '../dist/assets/core.js';

for (const hold of [false, true]) {
  for (const selection of ['cycles3', 'cycles5', 'time60', 'time180', 'time300', 'time600']) {
    const plan = createBreathPlan(selection, hold);
    assert.equal(plan.steps[0].type, 'in');
    assert.equal(plan.steps.at(-1).type, 'out');
    assert.ok(Math.abs(plan.steps.at(-1).end - plan.duration) < .001);
    if (selection.startsWith('time')) assert.equal(plan.duration, Number(selection.slice(4)) * 1000);
    else assert.equal(plan.duration, Number(selection.slice(6)) * (hold ? 13000 : 10000));
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      assert.ok(step.ms > 0);
      assert.equal(breathAt(plan, step.at + 1).type, step.type);
      assert.equal(breathAt(plan, step.end - 70).remaining, 0);
      if (i) assert.equal(step.at, plan.steps[i - 1].end);
    }
    assert.equal(breathAt(plan, plan.duration).complete, true);
  }
}
assert.equal(createBreathPlan('unknown').cycles, 5);
assert.equal(formatClock(60001), '01:01');
assert.equal(formatClock(-10), '00:00');
assert.equal(dailyQuote(new Date(2026, 0, 1, 0)), dailyQuote(new Date(2026, 0, 1, 23)));
assert.notEqual(dailyQuote(new Date(2026, 0, 1)), dailyQuote(new Date(2026, 0, 2)));
const data = new Map();
const store = makeStore({ setItem: (k, v) => data.set(k, v), getItem: k => data.get(k) ?? null, removeItem: k => data.delete(k) });
assert.equal(store.persistent, true);
store.write('journal', { answers: ['<script>', 'a', 'b'] });
assert.deepEqual(store.read('journal').answers, ['<script>', 'a', 'b']);
store.remove('journal'); assert.equal(store.read('journal'), null);
data.set('acalmo:broken', '{'); assert.equal(store.read('broken', 'fallback'), 'fallback');
const transient = makeStore(null); assert.equal(transient.persistent, false); assert.equal(transient.write('favorites', ['focus']), false); assert.deepEqual(transient.read('favorites'), ['focus']);
const url = new URL(affiliateUrl('máscara de dormir', 'abcinvestimen-20'));
assert.equal(url.hostname, 'www.amazon.com.br'); assert.equal(url.searchParams.get('tag'), 'abcinvestimen-20'); assert.equal(url.searchParams.get('k'), 'máscara de dormir');
assert.equal(new URL(affiliateUrl('a', 'bad&id=1')).searchParams.has('tag'), false);
for (const [id, pattern] of Object.entries(breathPatterns)) {
  const plan = createNamedPlan(id);
  assert.equal(plan.cycles, pattern.cycles);
  assert.equal(plan.duration, pattern.cycles * pattern.phases.reduce((sum, [, ms]) => sum + ms, 0));
  assert.equal(plan.steps.at(-1).end, plan.duration);
  for (let i = 1; i < plan.steps.length; i++) assert.equal(plan.steps[i].at, plan.steps[i - 1].end);
  assert.equal(breathAt(plan, plan.duration).complete, true);
}
assert.throws(() => createNamedPlan('nope'));
assert.equal(createNamedPlan('quadrada', 2).cycles, 2);
assert.equal(createNamedPlan('quadrada', 99).cycles, 20);
const allowed = ['rain', 'ocean', 'brown'];
assert.deepEqual(parseMix('rain:40,ocean:35', allowed), { rain: .4, ocean: .35 });
assert.equal(parseMix('rain:0', allowed), null);
assert.equal(parseMix('rain:101', allowed), null);
assert.equal(parseMix('hack:50', allowed), null);
assert.equal(parseMix('rain:abc', allowed), null);
assert.equal(parseMix('', allowed), null);
assert.equal(parseMix(null, allowed), null);
assert.deepEqual(parseMix('brown:60,rain:40,rain:90', allowed), { brown: .6, rain: .9 });
assert.equal(mixParam({ rain: .4, ocean: 0, brown: .6 }), 'rain:40,brown:60');
assert.equal(mixParam({ rain: 0 }), null);
assert.deepEqual(parseMix(mixParam({ rain: .4, brown: .6 }), allowed), { rain: .4, brown: .6 });
console.log('Core: 12 planos livres, 3 padrões nomeados, mix por URL, relógio, frase por data, armazenamento e links afiliados verificados.');
