import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/assets/audio.js', import.meta.url), 'utf8');
const { default: AmbientAudio } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class Parameter {
  value = 0;
  ramps = [];
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value, time) { this.value = value; this.ramps.push({ value, time }); }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelAndHoldAtTime() {}
  cancelScheduledValues() {}
}

class Node {
  gain = new Parameter();
  frequency = new Parameter();
  Q = new Parameter();
  threshold = new Parameter();
  knee = new Parameter();
  ratio = new Parameter();
  attack = new Parameter();
  release = new Parameter();
  disconnected = false;
  stopped = false;
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
  start() {}
  stop() { this.stopped = true; }
}

class Context {
  static instances = [];
  static initialState = 'suspended';
  state = Context.initialState;
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  nodes = [];
  resumeCalls = 0;
  constructor() { Context.instances.push(this); }
  createGain() { return this.makeNode(); }
  createBiquadFilter() { return this.makeNode(); }
  createDynamicsCompressor() { return this.makeNode(); }
  createBufferSource() { return this.makeNode(); }
  createOscillator() { return this.makeNode(); }
  makeNode() { const node = new Node(); this.nodes.push(node); return node; }
  createBuffer(channels, size) {
    const arrays = Array.from({ length: channels }, () => new Float32Array(size));
    return { getChannelData: channel => arrays[channel] };
  }
  async resume() { this.resumeCalls++; this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}

test('audio requires a gesture, preserves a paused mix and releases every node', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  Context.instances = [];
  const audio = new AmbientAudio();
  try {
    assert.equal(Context.instances.length, 0);
    assert.equal(audio.playing, false);
    await audio.set('rain', 0);
    await audio.resume();
    assert.equal(Context.instances.length, 0, 'empty controls must not start an audio context');
    await Promise.all([audio.set('rain', 0.4), audio.set('ocean', 0.2), audio.set('forest', 0.3), audio.set('fire', 0.1)]);
    assert.equal(Context.instances.length, 1);
    assert.equal(audio.playing, true);
    assert.deepEqual(audio.volumes, { rain: 0.4, ocean: 0.2, forest: 0.3, fire: 0.1 });
    await audio.pause();
    assert.equal(audio.playing, false);
    assert.equal(Context.instances[0].state, 'suspended');
    assert.equal(audio.volumes.rain, 0.4);
    await audio.resume();
    assert.equal(audio.playing, true);
    await audio.set('rain', 0);
    assert.equal('rain' in audio.volumes, false);
    await audio.stopAll();
    assert.deepEqual(audio.volumes, {});
    assert.equal(audio.playing, false);
    await audio.destroy();
    assert.equal(Context.instances[0].state, 'closed');
    assert.ok(Context.instances[0].nodes.every(node => node.disconnected));
    assert.equal(audio._cleanupJobs.size, 0);
    await assert.rejects(audio.set('ocean', 0.5), /áudio foi encerrado/);
  } finally {
    await audio.destroy();
    globalThis.AudioContext = previous;
  }
});

test('bad inputs and unsupported browsers fail without breaking future retries', async () => {
  const previous = globalThis.AudioContext;
  const previousWebkit = globalThis.webkitAudioContext;
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  const audio = new AmbientAudio();
  try {
    await assert.rejects(audio.set('unknown', 0.5), /não está disponível/);
    await assert.rejects(audio.set('rain', Number.NaN), /volume/);
    await assert.rejects(audio.set('rain', 0.5), /navegador não oferece áudio/);
    globalThis.AudioContext = Context;
    await audio.set('rain', 0.5);
    assert.equal(audio.playing, true);
  } finally {
    await audio.destroy();
    globalThis.AudioContext = previous;
    globalThis.webkitAudioContext = previousWebkit;
  }
});

test('blocked autoplay returns promptly without resume or sound nodes and the next gesture reuses its context', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  Context.instances = [];
  Context.initialState = 'suspended';
  const audio = new AmbientAudio();
  let timeout;
  try {
    const result = await Promise.race([
      audio.tryAutoplay('ocean', 0.2),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Autoplay waited for a gesture')), 100); })
    ]);
    clearTimeout(timeout);
    assert.equal(result, false);
    assert.equal(audio.playing, false);
    assert.deepEqual(audio.volumes, {});
    assert.equal(Context.instances.length, 1);
    assert.equal(Context.instances[0].resumeCalls, 0);
    assert.equal(Context.instances[0].nodes.length, 0);
    await audio.set('ocean', 0.2);
    assert.equal(Context.instances.length, 1);
    assert.equal(Context.instances[0].resumeCalls, 1);
    assert.equal(audio.playing, true);
    assert.deepEqual(audio.volumes, { ocean: 0.2 });
    await audio.destroy();
    assert.ok(Context.instances[0].nodes.every(node => node.disconnected));
    assert.equal(Context.instances[0].state, 'closed');
  } finally {
    clearTimeout(timeout);
    await audio.destroy();
    globalThis.AudioContext = previous;
  }
});

test('the sleep fade lowers the master toward silence and any new sound cancels it', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  Context.instances = [];
  Context.initialState = 'running';
  const audio = new AmbientAudio();
  try {
    assert.equal(await audio.fadeOut(60), false, 'a fade with nothing playing must not open an audio context');
    assert.equal(Context.instances.length, 0);
    assert.equal(audio.fading, false);
    await audio.set('rain', 0.4);
    const master = audio._master.gain;
    assert.equal(await audio.fadeOut(60), true);
    assert.equal(audio.fading, true, 'the descent stays flagged while the timer runs');
    assert.deepEqual(master.ramps.at(-1), { value: 0, time: 60 }, 'the volume drifts to silence across the whole window');
    assert.equal(audio.volumes.rain, 0.4, 'the mix must stay intact during the descent');
    await audio.set('rain', 0.3);
    assert.equal(audio.fading, false, 'changing the volume cancels the descent');
    assert.equal(master.ramps.at(-1).value, 0.65, 'the master returns to its normal level');
    assert.equal(await audio.fadeOut(45), true);
    assert.deepEqual(master.ramps.at(-1), { value: 0, time: 45 });
    assert.equal(await audio.cancelFade(), true);
    assert.equal(audio.fading, false);
    assert.equal(master.ramps.at(-1).value, 0.65);
    assert.equal(await audio.cancelFade(), false, 'cancelling with no descent in progress does nothing');
    assert.equal(await audio.fadeOut(5000), true, 'the window is clamped to a reasonable length');
    assert.deepEqual(master.ramps.at(-1), { value: 0, time: 600 });
    await audio.pause();
    assert.equal(audio.fading, false, 'pausing ends the descent');
    await audio.resume();
    assert.equal(audio.fading, false);
    assert.equal(await audio.fadeOut(30), true);
    await audio.stopAll();
    assert.deepEqual(audio.volumes, {});
    assert.equal(audio.fading, false, 'stopping everything clears the descent state');
    assert.equal(master.ramps.at(-1).value, 0);
    assert.equal(Context.instances[0].state, 'suspended');
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(audio._cleanupJobs.size, 0);
    await audio.destroy();
    assert.ok(Context.instances[0].nodes.every(node => node.disconnected), 'every node is released after the descent');
  } finally {
    await audio.destroy();
    Context.initialState = 'suspended';
    globalThis.AudioContext = previous;
  }
});

test('permitted autoplay starts softly, reports actual playback and cleans up normally', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  Context.instances = [];
  Context.initialState = 'running';
  const audio = new AmbientAudio();
  try {
    assert.equal(await audio.tryAutoplay('ocean', 0.2), true);
    assert.equal(audio.playing, true);
    assert.deepEqual(audio.volumes, { ocean: 0.2 });
    assert.equal(Context.instances[0].resumeCalls, 0);
    assert.equal(audio._channels.get('ocean').sources.size, 7, 'three noise layers and four slow modulators');
    assert.ok(audio._channels.get('ocean').gain.gain.ramps.some(ramp => ramp.time >= 2.8), 'the initial ocean gain must fade in over multiple seconds');
    await audio.pause();
    assert.equal(await audio.tryAutoplay('ocean', 0.2), false, 'autoplay must not undo a suspended pause');
    assert.equal(Context.instances[0].resumeCalls, 0);
    await audio.destroy();
    assert.ok(Context.instances[0].nodes.every(node => node.disconnected));
  } finally {
    await audio.destroy();
    Context.initialState = 'suspended';
    globalThis.AudioContext = previous;
  }
});
