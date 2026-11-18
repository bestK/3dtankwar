export class AudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public enabled = true;

  public unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.55;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 6;
      this.masterGain.connect(compressor);
      compressor.connect(this.ctx.destination);

      this.noiseBuffer = this.buildNoiseBuffer(1.6);
      this.reverbNode = this.buildBunkerReverb(1.1);
      const revGain = this.ctx.createGain();
      revGain.gain.value = 0.22;
      this.reverbNode.connect(revGain);
      revGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.04);
    }
  }

  private buildNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private buildBunkerReverb(seconds: number): ConvolverNode {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 2.8);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    return conv;
  }

  public playCannon(heavy = false, distanceFactor = 1): void {
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const vol = Math.max(0.08, Math.min(1, distanceFactor));

    // Sub-bass punch
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = heavy ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(heavy ? 145 : 175, t);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 32 : 44, t + (heavy ? 0.28 : 0.16));
    oscGain.gain.setValueAtTime((heavy ? 0.62 : 0.42) * vol, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.32 : 0.18));
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.34);

    // Muzzle blast crack
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(heavy ? 900 : 1350, t);
    filter.frequency.exponentialRampToValueAtTime(240, t + 0.22);
    filter.Q.value = 1.1;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime((heavy ? 0.58 : 0.36) * vol, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.28 : 0.16));

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    if (this.reverbNode) nGain.connect(this.reverbNode);
    noise.start(t);
    noise.stop(t + 0.3);
  }

  public playSteelRicochet(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const freqs = [1680, 2540, 3890];
    freqs.forEach((f, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.22);
      gain.gain.setValueAtTime(0.14 / (idx + 1), t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  public playBrickBreak(): void {
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(980, t);
    filter.frequency.exponentialRampToValueAtTime(190, t + 0.18);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(t);
    noise.stop(t + 0.2);
  }

  public playExplosion(catastrophic = false): void {
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const dur = catastrophic ? 0.95 : 0.52;

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(catastrophic ? 92 : 115, t);
    sub.frequency.exponentialRampToValueAtTime(22, t + dur);
    subGain.gain.setValueAtTime(catastrophic ? 0.85 : 0.55, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(t);
    sub.stop(t + dur + 0.04);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(catastrophic ? 1400 : 950, t);
    filter.frequency.exponentialRampToValueAtTime(110, t + dur);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(catastrophic ? 0.72 : 0.45, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    if (this.reverbNode) nGain.connect(this.reverbNode);
    noise.start(t);
    noise.stop(t + dur + 0.05);
  }

  public playPowerUp(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + i * 0.055);
      gain.gain.setValueAtTime(0.18, t + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.055 + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t + i * 0.055);
      osc.stop(t + i * 0.055 + 0.24);
    });
  }

  /** Warm cinematic brass homage to the classic 1985 Battle City stage fanfare */
  public playStageFanfare(): void {
    this.unlock();
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime + 0.04;
    const motif: Array<[number, number, number]> = [
      [261.63, 0.0, 0.13],
      [293.66, 0.15, 0.13],
      [311.13, 0.3, 0.22],
      [261.63, 0.56, 0.13],
      [293.66, 0.71, 0.13],
      [349.23, 0.86, 0.24],
      [392.0, 1.15, 0.45],
    ];

    for (const [freq, start, len] of motif) {
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc2.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + start);
      osc2.frequency.setValueAtTime(freq * 0.5, t + start);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1600, t + start);
      filter.frequency.exponentialRampToValueAtTime(680, t + start + len);

      gain.gain.setValueAtTime(0.001, t + start);
      gain.gain.linearRampToValueAtTime(0.16, t + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + start + len + 0.06);

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbNode) gain.connect(this.reverbNode);

      osc.start(t + start);
      osc2.start(t + start);
      osc.stop(t + start + len + 0.08);
      osc2.stop(t + start + len + 0.08);
    }
  }
}
