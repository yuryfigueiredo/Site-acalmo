/**
 * Original, procedural soundscapes. Nothing is downloaded or recorded.
 * Create an instance freely; call set/resume from an explicit user gesture.
 * tryAutoplay only uses playback already permitted by the browser.
 */
export const soundChannels = ['rain', 'ocean', 'forest', 'fire', 'brown', 'white', 'pink'];
const NAMES = new Set(soundChannels);
const FADE = 0.12;

export default class AmbientAudio {
  constructor() {
    this._context = null;
    this._master = null;
    this._outputNodes = [];
    this._channels = new Map();
    this._buffers = new Map();
    this._cleanupJobs = new Set();
    this._paused = false;
    this._destroyed = false;
    this._sleepFade = 0;
    this._queue = Promise.resolve();
  }

  get volumes() {
    return Object.fromEntries([...this._channels].map(([name, channel]) => [name, channel.volume]));
  }

  get playing() {
    return !this._destroyed && !this._paused && this._channels.size > 0 && this._context?.state === 'running';
  }

  // True while the master gain is drifting toward silence for the sound timer.
  get fading() {
    return this._sleepFade > 0;
  }

  async tryAutoplay(name, volume) {
    if (!NAMES.has(name)) throw new Error('Esta paisagem sonora não está disponível.');
    if (typeof volume !== 'number' || !Number.isFinite(volume)) throw new Error('Escolha um volume entre 0 e 1.');
    volume = Math.max(0, Math.min(1, volume));
    if (volume === 0) return false;
    return this._enqueue(() => {
      this._ensureContext();
      // A suspended AudioContext may leave resume() pending until a gesture.
      // Do not call it here or occupy the command queue while waiting for one.
      if (this._context.state !== 'running') return false;
      this._ensureOutput();
      this._paused = false;
      this._setChannel(name, volume);
      return this.playing;
    });
  }

  async set(name, volume) {
    if (!NAMES.has(name)) throw new Error('Esta paisagem sonora não está disponível.');
    if (typeof volume !== 'number' || !Number.isFinite(volume)) throw new Error('Escolha um volume entre 0 e 1.');
    volume = Math.max(0, Math.min(1, volume));
    return this._enqueue(async () => {
      if (volume === 0) {
        const channel = this._channels.get(name);
        if (channel) {
          this._channels.delete(name);
          this._retire(channel);
        }
        return;
      }
      await this._activate();
      this._paused = false;
      this._setChannel(name, volume);
    });
  }

  _setChannel(name, volume) {
    const existing = this._channels.get(name);
    const channel = existing || this._makeChannel(name);
    channel.volume = volume;
    this._channels.set(name, channel);
    this._fade(channel.gain.gain, volume * 0.3, existing ? 0.22 : name === 'ocean' ? 2.8 : 0.8);
    // Bringing the mix back up always cancels a pending sleep fade.
    this._sleepFade = 0;
    this._fade(this._master.gain, 0.65, 1.2);
  }

  /**
   * Drift the master gain to silence over `seconds` without touching the mix,
   * so a timer can end softly. Returns false when there is nothing to fade;
   * the caller still owns the final stop.
   */
  async fadeOut(seconds = 60) {
    const fadeSeconds = Math.max(1, Math.min(600, Number(seconds) || 60));
    return this._enqueue(async () => {
      if (this._paused || !this._channels.size || !this._master || this._context?.state !== 'running') return false;
      this._fade(this._master.gain, 0, fadeSeconds);
      this._sleepFade = fadeSeconds;
      return true;
    });
  }

  // Ends a sleep fade early: the mix returns to its normal level instead of going silent.
  async cancelFade() {
    return this._enqueue(async () => {
      if (!this._sleepFade) return false;
      this._sleepFade = 0;
      if (!this._paused && this._channels.size && this._master && this._context?.state === 'running') this._fade(this._master.gain, 0.65, 1.2);
      return true;
    });
  }

  async pause() {
    return this._enqueue(async () => {
      this._paused = true;
      this._sleepFade = 0;
      if (!this._context || this._context.state !== 'running') return;
      if (this._master) {
        this._fade(this._master.gain, 0);
        await this._waitForFade();
      }
      if (this._context.state === 'running') await this._context.suspend();
    });
  }

  async resume() {
    return this._enqueue(async () => {
      // Resume is not an implicit request for a default sound or new context.
      if (!this._channels.size) return;
      await this._activate();
      this._paused = false;
      this._sleepFade = 0;
      this._fade(this._master.gain, 0.65);
    });
  }

  async stopAll() {
    return this._enqueue(async () => {
      this._sleepFade = 0;
      for (const channel of this._channels.values()) this._retire(channel);
      this._channels.clear();
      this._paused = false;
      if (this._context?.state === 'running') {
        if (this._master) {
          this._fade(this._master.gain, 0);
          await this._waitForFade();
        }
        if (this._context.state === 'running') await this._context.suspend();
      }
    });
  }

  async destroy() {
    if (this._destroyed) return;
    return this._enqueue(async () => {
      if (this._context?.state === 'running') {
        if (this._master) {
          this._fade(this._master.gain, 0);
          await this._waitForFade();
        }
      }
      for (const channel of this._channels.values()) this._dispose(channel);
      this._channels.clear();
      for (const job of this._cleanupJobs) {
        clearTimeout(job.timer);
        this._dispose(job.channel);
      }
      this._cleanupJobs.clear();
      for (const node of this._outputNodes) this._disconnect(node);
      if (this._context && this._context.state !== 'closed') await this._context.close();
      this._buffers.clear();
      this._context = null;
      this._master = null;
      this._sleepFade = 0;
      this._destroyed = true;
    });
  }

  _enqueue(task) {
    const pending = this._queue.then(() => {
      if (this._destroyed) throw new Error('O áudio foi encerrado. Reabra a página para continuar.');
      return task();
    });
    // A failed browser resume must not poison subsequent user attempts.
    this._queue = pending.catch(() => {});
    return pending;
  }

  _ensureContext() {
    if (!this._context) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('Seu navegador não oferece áudio ambiente. Experimente uma versão atual do Chrome, Safari, Firefox ou Edge.');
      try {
        this._context = new AudioContext({ latencyHint: 'playback' });
      } catch {
        throw new Error('Não foi possível preparar o áudio. Tente novamente ou use outro navegador.');
      }
    }
  }

  _ensureOutput() {
    if (this._master) return;
    const context = this._context;
    const master = context.createGain();
    const dc = context.createBiquadFilter();
    const limiter = context.createDynamicsCompressor();
    master.gain.value = 0;
    dc.type = 'highpass';
    dc.frequency.value = 35;
    limiter.threshold.value = -18;
    limiter.knee.value = 18;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.35;
    master.connect(dc).connect(limiter).connect(context.destination);
    this._master = master;
    this._outputNodes = [master, dc, limiter];
  }

  async _activate() {
    this._ensureContext();
    if (this._context.state !== 'running') {
      try { await this._context.resume(); } catch {
        throw new Error('O navegador bloqueou o áudio. Toque novamente no som para começar.');
      }
    }
    if (this._context.state !== 'running') throw new Error('Toque novamente no som para permitir a reprodução.');
    this._ensureOutput();
  }

  _fade(parameter, value, seconds = FADE) {
    const time = this._context.currentTime;
    if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(time);
    else {
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(parameter.value, time);
    }
    parameter.linearRampToValueAtTime(value, time + seconds);
  }

  _waitForFade() { return new Promise(resolve => setTimeout(resolve, FADE * 1000 + 25)); }

  _node(channel, node, source = false) {
    channel.nodes.add(node);
    if (source) channel.sources.add(node);
    return node;
  }

  _filter(channel, type, frequency, q = 0.5) {
    const node = this._node(channel, this._context.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  _gain(channel, value) {
    const node = this._node(channel, this._context.createGain());
    node.gain.value = value;
    return node;
  }

  _noiseBuffer(kind) {
    if (this._buffers.has(kind)) return this._buffers.get(kind);
    const size = this._context.sampleRate * 10;
    const buffer = this._context.createBuffer(2, size, this._context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      // Kellet's coefficients approximate the -3 dB/octave slope of pink noise.
      let p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0, p6 = 0;
      for (let i = 0; i < size; i++) {
        const white = Math.random() * 2 - 1;
        low = (low + 0.02 * white) / 1.02;
        if (kind === 'brown') data[i] = low * 3.2;
        else if (kind === 'pink') {
          p0 = 0.99886 * p0 + white * 0.0555179;
          p1 = 0.99332 * p1 + white * 0.0750759;
          p2 = 0.96900 * p2 + white * 0.1538520;
          p3 = 0.86650 * p3 + white * 0.3104856;
          p4 = 0.55000 * p4 + white * 0.5329522;
          p5 = -0.7616 * p5 - white * 0.0168980;
          data[i] = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + white * 0.5362) * 0.11;
          p6 = white * 0.115926;
        } else data[i] = white * 0.55;
      }
      // Match loop endpoints without introducing a hard seam.
      const seam = Math.min(2048, size / 2);
      for (let i = 0; i < seam; i++) {
        const t = i / seam;
        data[size - seam + i] = data[size - seam + i] * (1 - t) + data[i] * t;
      }
    }
    this._buffers.set(kind, buffer);
    return buffer;
  }

  _noise(channel, kind, filter, level, rolloff = null) {
    const source = this._node(channel, this._context.createBufferSource(), true);
    const gain = this._gain(channel, level);
    source.buffer = this._noiseBuffer(kind);
    source.loop = true;
    source.connect(filter);
    if (rolloff) filter.connect(rolloff).connect(gain);
    else filter.connect(gain);
    gain.connect(channel.gain);
    source.start(0, Math.random() * 5);
    return { source, gain };
  }

  _lfo(channel, frequency, amplitude, parameter) {
    const oscillator = this._node(channel, this._context.createOscillator(), true);
    const gain = this._gain(channel, amplitude);
    oscillator.frequency.value = frequency;
    oscillator.connect(gain).connect(parameter);
    oscillator.start();
  }

  _every(channel, milliseconds, callback) {
    const timer = setInterval(() => {
      if (!channel.disposed && !this._paused && this._context?.state === 'running') callback();
    }, milliseconds);
    channel.timers.add(timer);
  }

  _makeChannel(name) {
    const channel = { name, nodes: new Set(), sources: new Set(), timers: new Set(), volume: 0, disposed: false };
    channel.gain = this._gain(channel, 0);
    channel.gain.connect(this._master);
    if (name === 'rain') {
      this._noise(channel, 'white', this._filter(channel, 'lowpass', 4600), 0.8);
      this._noise(channel, 'brown', this._filter(channel, 'lowpass', 650), 0.55);
      this._every(channel, 1300, () => {
        if (Math.random() < 0.7) this._tone(channel, 1100 + Math.random() * 1500, 0.065, 0.035, 'sine', -300);
      });
    } else if (name === 'ocean') {
      // Three distant, overlapping swells. Gentle filters remove both the
      // close-up hiss of breaking surf and the low rumble of unfiltered noise.
      const surf = this._noise(channel, 'white', this._filter(channel, 'highpass', 140), 0.3, this._filter(channel, 'lowpass', 1050, 0.4));
      this._lfo(channel, 0.062, 0.13, surf.gain.gain);
      this._lfo(channel, 0.027, 0.045, surf.gain.gain);
      const body = this._noise(channel, 'brown', this._filter(channel, 'highpass', 160), 0.4, this._filter(channel, 'lowpass', 520, 0.4));
      this._lfo(channel, 0.041, 0.14, body.gain.gain);
      const foam = this._noise(channel, 'white', this._filter(channel, 'bandpass', 1200, 0.65), 0.09, this._filter(channel, 'lowpass', 1700, 0.4));
      this._lfo(channel, 0.079, 0.05, foam.gain.gain);
    } else if (name === 'forest') {
      const leaves = this._noise(channel, 'white', this._filter(channel, 'bandpass', 1000, 0.3), 0.24);
      this._lfo(channel, 0.11, 0.12, leaves.gain.gain);
      this._noise(channel, 'brown', this._filter(channel, 'lowpass', 400), 0.5);
      this._every(channel, 2100, () => {
        if (Math.random() > 0.58) return;
        const pitch = 1450 + Math.random() * 850;
        this._tone(channel, pitch, 0.3, 0.06, 'sine', 400);
        this._tone(channel, pitch * 1.18, 0.16, 0.035, 'sine', -250, 0.22);
      });
    } else if (name === 'fire') {
      const warmth = this._noise(channel, 'brown', this._filter(channel, 'lowpass', 600), 1.15);
      this._lfo(channel, 0.23, 0.22, warmth.gain.gain);
      this._noise(channel, 'white', this._filter(channel, 'lowpass', 950), 0.18);
      this._every(channel, 260, () => {
        if (Math.random() < 0.4) this._crackle(channel);
      });
    } else if (name === 'brown') {
      this._noise(channel, 'brown', this._filter(channel, 'lowpass', 900), 1.1);
    } else if (name === 'white') {
      this._noise(channel, 'white', this._filter(channel, 'lowpass', 9000), 0.42);
    } else {
      this._noise(channel, 'pink', this._filter(channel, 'highpass', 45), 0.9, this._filter(channel, 'lowpass', 11000));
    }
    return channel;
  }

  _tone(channel, frequency, length, level, type, sweep = 0, delay = 0) {
    const context = this._context;
    const time = context.currentTime + delay;
    const oscillator = this._node(channel, context.createOscillator(), true);
    const envelope = this._gain(channel, 0);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.linearRampToValueAtTime(frequency + sweep, time + length);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(level, time + Math.min(0.025, length / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + length);
    oscillator.connect(envelope).connect(channel.gain);
    oscillator.onended = () => this._release(channel, [oscillator, envelope]);
    oscillator.start(time);
    oscillator.stop(time + length + 0.03);
  }

  _crackle(channel) {
    const context = this._context;
    const time = context.currentTime;
    const source = this._node(channel, context.createBufferSource(), true);
    const filter = this._filter(channel, 'bandpass', 500 + Math.random() * 1800, 0.7);
    const envelope = this._gain(channel, 0);
    const length = 0.035 + Math.random() * 0.08;
    source.buffer = this._noiseBuffer('white');
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(0.08 + Math.random() * 0.13, time + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + length);
    source.connect(filter).connect(envelope).connect(channel.gain);
    source.onended = () => this._release(channel, [source, filter, envelope]);
    source.start(time, Math.random() * 4, length);
  }

  _release(channel, nodes) {
    for (const node of nodes) {
      this._disconnect(node);
      channel.nodes.delete(node);
      channel.sources.delete(node);
    }
  }

  _disconnect(node) { try { node.disconnect(); } catch { /* Already disconnected. */ } }

  _retire(channel) {
    if (channel.disposed) return;
    for (const timer of channel.timers) clearInterval(timer);
    channel.timers.clear();
    if (this._context.state !== 'running') return this._dispose(channel);
    this._fade(channel.gain.gain, 0);
    const job = { channel, timer: null };
    job.timer = setTimeout(() => {
      this._dispose(channel);
      this._cleanupJobs.delete(job);
    }, FADE * 1000 + 30);
    this._cleanupJobs.add(job);
  }

  _dispose(channel) {
    if (channel.disposed) return;
    channel.disposed = true;
    for (const timer of channel.timers) clearInterval(timer);
    channel.timers.clear();
    for (const source of channel.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* One-shot source may have ended. */ }
    }
    for (const node of channel.nodes) this._disconnect(node);
    channel.nodes.clear();
    channel.sources.clear();
  }
}
