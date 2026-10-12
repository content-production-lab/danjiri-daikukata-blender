// 鳴物（太鼓・鉦・笛）と、車輪・群衆の音を WebAudio で合成する。音声ファイルは使わない。

const STEPS = 8;
const VOLUME = 0.8;
const MUTE_KEY = 'danjiri-daikukata:muted';

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
// 8分音符ごとの手（1 = 打つ）。大太鼓・締太鼓・鉦
const ODAIKO = [1, 0, 0, 1, 1, 0, 1, 0];
const SHIME = [0, 1, 1, 0, 1, 1, 0, 1];
const KANE = [1, 0, 1, 1, 0, 1, 1, 0];
// 篠笛の旋律（陽音階、半音の数。null は休み）
const FUE: (number | null)[] = [12, null, 14, 17, 19, 17, 14, null, 12, 14, 12, 9, 7, null, 9, 12];

export class Hayashi {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private rumbleGain!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private timer = 0;
  private fadeToken = 0;
  muted = loadMuted();
  /** 外から更新する状態 */
  speedKmh = 0;
  slip = 0;
  excitement = 0;

  /** 'running' | 'suspended' | 'closed' | 'none' */
  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  /** 遊び始め・再開で鳴らす（初回はここで音の部品を組み立てる） */
  start(): void {
    this.fadeToken++;
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    void ctx.resume();
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, ctx.currentTime, 0.08);
  }

  /** すぐ止める（一時停止・画面を隠したとき）。処理も止まる */
  pause(): void {
    this.fadeToken++;
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  /** 音の部品ごと破棄する */
  stop(): void {
    window.clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  /** pause() で止めた音を再開する */
  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /** 音を小さくしていって止める（曳行の終わり） */
  fadeOut(sec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const token = ++this.fadeToken;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, sec / 4);
    window.setTimeout(() => {
      if (token === this.fadeToken) void ctx.suspend();
    }, sec * 1000);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // 保存できなくても消音そのものは効く
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : VOLUME, this.ctx.currentTime, 0.05);
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.9;
    this.musicBus.connect(this.master);

    // ノイズ素材（ブラウンノイズ寄り）
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      d[i] = last * 3 + w * 0.15;
    }

    // 車輪のごろごろ音
    const rumble = this.loopNoise();
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 160;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);

    // 横すべりのきしみ
    const squeal = this.loopNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 6;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    squeal.connect(bp).connect(this.squealGain).connect(this.master);

    // 群衆のざわめき
    const crowd = this.loopNoise();
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 700;
    this.crowdFilter.Q.value = 0.8;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    crowd.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master);

    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** 毎フレーム呼ぶ: 走行音の更新 */
  update(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.max(0, this.speedKmh);
    this.rumbleGain.gain.setTargetAtTime(Math.min(0.9, v / 22) * 0.9, t, 0.1);
    this.rumbleFilter.frequency.setTargetAtTime(110 + v * 6, t, 0.1);
    this.squealGain.gain.setTargetAtTime(Math.min(0.35, Math.max(0, Math.abs(this.slip) - 0.4) * 0.25), t, 0.05);
    this.crowdGain.gain.setTargetAtTime(0.05 + Math.min(0.25, v / 120) + this.excitement * 0.25, t, 0.2);
    this.crowdFilter.frequency.setTargetAtTime(600 + this.excitement * 500, t, 0.2);
  }

  /** 衝突音 */
  hit(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(1.4, 0.3 + strength * 0.25), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
    this.noiseBurst(t, 0.25, 1800, Math.min(0.9, strength * 0.2), 2);
  }

  /** 歓声 */
  cheer(amount: number): void {
    this.excitement = Math.min(1, this.excitement + amount);
  }

  private loopNoise(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    src.start(ctx.currentTime, Math.random() * 1.5);
    return src;
  }

  private noiseBurst(t: number, dur: number, freq: number, gain: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.excitement *= 0.985;
    // 速くなるほど鳴物も速く（やりまわしで最高潮）
    const bpm = 96 + Math.min(90, Math.max(0, this.speedKmh) * 3.4);
    const stepDur = 60 / bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.nextTime, this.step, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % STEPS;
      if (this.step === 0) this.bar++;
    }
  }

  private playStep(t: number, i: number, stepDur: number): void {
    const ctx = this.ctx!;
    const accent = i === 0 ? 1 : 0.75;
    if (ODAIKO[i]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(115, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.18);
      g.gain.setValueAtTime(0.9 * accent, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.4);
      this.noiseBurst(t, 0.06, 300, 0.4 * accent);
    }
    if (SHIME[i]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.05);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.1);
      this.noiseBurst(t, 0.04, 2500, 0.2, 3);
    }
    if (KANE[i]) {
      // 鉦: 倍音が整数比でない金属音
      for (const [f, a] of [
        [2210, 0.09],
        [3370, 0.06],
        [5140, 0.04],
        [6890, 0.025],
      ] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(a * accent * 1.3, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
        o.connect(g).connect(this.musicBus);
        o.start(t);
        o.stop(t + 0.2);
      }
    }
    // 篠笛: 2拍ごとに1音
    const fi = (this.bar * 4 + Math.floor(i / 2)) % FUE.length;
    const note = FUE[fi];
    if (i % 2 === 0 && note !== null) {
      const o = ctx.createOscillator();
      const vib = ctx.createOscillator();
      const vg = ctx.createGain();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 587.33 * Math.pow(2, note / 12);
      vib.frequency.value = 5.5;
      vg.gain.value = 9;
      vib.connect(vg).connect(o.frequency);
      const dur = stepDur * 1.9;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.03);
      g.gain.setValueAtTime(0.07, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.02);
      vib.stop(t + dur + 0.02);
      this.noiseBurst(t, dur, 2400, 0.012, 1);
    }
    // 掛け声（「ソーリャ」の代わりの、人の声に近い帯域の短い叫び）
    if (i === 0 && this.bar % 2 === 1 && this.speedKmh > 8) {
      this.noiseBurst(t, 0.22, 750, 0.18 + this.excitement * 0.3, 4);
      this.noiseBurst(t, 0.22, 1250, 0.12 + this.excitement * 0.2, 5);
    }
  }
}
