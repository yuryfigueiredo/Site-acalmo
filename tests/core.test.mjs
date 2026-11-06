import assert from 'node:assert/strict';
import { createBreathPlan, createNamedPlan, breathPatterns, breathAt, formatClock, dailyQuote, dailyPrompts, journalPrompts, journalHistoryLimit, pushJournalHistory, readJournalHistory, makeStore, affiliateUrl, parseMix, mixParam } from '../dist/assets/core.js';

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
// Journal prompts: one set per calendar day, always three, never repeated inside a set.
assert.ok(journalPrompts.length >= 6, 'too few prompt sets to rotate through');
assert.equal(new Set(journalPrompts.flat()).size, journalPrompts.length * 3, 'questions repeat across sets');
for (const prompts of journalPrompts) {
  assert.equal(prompts.length, 3);
  assert.equal(new Set(prompts).size, 3);
  for (const question of prompts) {
    assert.equal(typeof question, 'string');
    assert.ok(question.trim().length > 4, question);
    assert.ok(question.endsWith('?'), question);
  }
}
// Reference values pin the calendar arithmetic: a shifted index silently changes every day's questions.
assert.deepEqual(dailyPrompts(new Date(2026, 0, 1)), journalPrompts[0], 'January 1st opens the first set');
assert.deepEqual(dailyPrompts(new Date(2026, 0, 2)), journalPrompts[1], 'the next day moves one set forward');
assert.deepEqual(dailyPrompts(new Date(2026, 0, 9)), journalPrompts[8], 'the last set of the cycle is reached, not skipped');
assert.deepEqual(dailyPrompts(new Date(2026, 0, 10)), journalPrompts[0], 'the cycle restarts after the last set');
assert.deepEqual(dailyPrompts(new Date(2026, 0, 1, 0)), dailyPrompts(new Date(2026, 0, 1, 23, 59)), 'the hour of day must not change the set');
assert.deepEqual(dailyPrompts(new Date(2026, 0, 1, 12)), dailyPrompts(new Date(2025, 0, 1, 12)), 'the same day of another year repeats the set');
assert.notEqual(dailyPrompts(new Date(2026, 0, 1)).join('|'), dailyPrompts(new Date(2026, 0, 2)).join('|'), 'each day brings a different set');
for (const day of [1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 60, 120, 200, 340]) {
  assert.equal(dailyPrompts(new Date(2026, 0, day)).length, 3);
  assert.notEqual(dailyPrompts(new Date(2026, 0, day))[0], '');
}
// Local history: newest first, capped, tolerant of broken data, and never doubled.
assert.equal(journalHistoryLimit, 30);
assert.deepEqual(readJournalHistory(undefined), []);
assert.deepEqual(readJournalHistory('garbage'), []);
assert.deepEqual(readJournalHistory([null, {}, 'x', { answers: ['', '   ', ''] }]), []);
assert.deepEqual(readJournalHistory([{ answers: ['a', 5, 'c', 'd'], date: 'an invented date' }])[0].answers, ['a', '', 'c']);
assert.ok(Number.isFinite(Date.parse(readJournalHistory([{ answers: ['a', 'b', 'c'] }])[0].date)), 'an entry without a date gets today');
assert.ok(Number.isFinite(Date.parse(readJournalHistory([{ answers: ['a', 'b', 'c'], date: 'an invented date' }])[0].date)), 'an entry with a broken date gets a usable one');
assert.deepEqual(readJournalHistory([{ answers: ['a', 'b', 'c'], date: '2026-01-05T10:00:00.000Z' }]), [{ date: '2026-01-05T10:00:00.000Z', answers: ['a', 'b', 'c'] }]);
let history = [];
for (let day = 1; day <= 36; day++) history = pushJournalHistory(history, { date: new Date(2026, 0, day, 9).toISOString(), answers: ['um ' + day, 'dois', 'três'] });
assert.equal(history.length, journalHistoryLimit);
assert.equal(history[0].answers[0], 'um 36');
assert.equal(history[1].answers[0], 'um 35', 'newest first');
assert.equal(history.at(-1).answers[0], 'um 7', 'the oldest writing leaves when the list fills');
const deduped = pushJournalHistory(history, { date: new Date(2026, 2, 1).toISOString(), answers: ['um 36', 'dois', 'três'] });
assert.equal(deduped.length, journalHistoryLimit);
assert.equal(deduped[0].answers[0], 'um 36');
assert.equal(deduped[1].answers[0], 'um 35', 'sending the same text twice is one memory, not two');
const untouched = pushJournalHistory(history, { date: new Date(2026, 2, 1).toISOString(), answers: ['', '', ''] });
assert.equal(untouched.length, journalHistoryLimit);
assert.equal(untouched[0].answers[0], 'um 36', 'nothing is stored without text');
assert.equal(pushJournalHistory([], { answers: ['a', 'b', 'c'] })[0].answers.join(), ['a', 'b', 'c'].join());
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
console.log('Core: 12 planos livres, 3 padrões nomeados, mix por URL, relógio, frase e perguntas por data, histórico local do diário, armazenamento e links afiliados verificados.');
