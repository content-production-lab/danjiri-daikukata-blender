// キーボード・ゲームパッド・タッチ（画面端のボタン）の入力をまとめる。

import type { PlayerInput } from './sim/game';
import type { ControlMode } from './sim/session';

export type Action = 'steerL' | 'steerR' | 'pull' | 'brake' | 'leanL' | 'leanR' | 'jump';

const KEYS: Record<Action, string[]> = {
  steerL: ['KeyA'],
  steerR: ['KeyD'],
  pull: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  leanL: ['ArrowLeft'],
  leanR: ['ArrowRight'],
  jump: ['Space'],
};

const approach = (v: number, target: number, rate: number, dt: number) => {
  const d = target - v;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : v + Math.sign(d) * step;
};

export class Input {
  private keys = new Set<string>();
  /** 画面のボタン（タッチ・マウス）で押されている動作 */
  private pointers = new Map<number, Action>();
  private mode: ControlMode = 'manual';
  running = false;
  private jumpQueued = false;
  private jumpHeldUntil = 0;
  private steer = 0;
  private lean = 0;
  private padJumpHeld = false;
  private padActive = new Set<Action>();
  onToggleCamera: () => void = () => {};
  onToggleMute: () => void = () => {};
  onPause: () => void = () => {};
  onDeactivate: () => void = () => {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      const nav = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
      if (nav && !(e.target instanceof HTMLButtonElement && e.code === 'Space')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.mode === 'simple') {
        if (KEYS.pull.includes(e.code)) this.running = true;
        if (KEYS.brake.includes(e.code)) this.running = false;
      }
      if (e.code === 'Space') this.queueJump();
      if (e.code === 'KeyC') this.onToggleCamera();
      if (e.code === 'KeyM') this.onToggleMute();
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.reset();
      this.onDeactivate();
    });
  }

  setMode(mode: ControlMode): void {
    this.mode = mode;
    this.reset();
  }

  reset(): void {
    this.keys.clear();
    this.pointers.clear();
    this.padActive.clear();
    this.jumpQueued = false;
    this.jumpHeldUntil = 0;
    this.padJumpHeld = false;
    this.steer = 0;
    this.lean = 0;
    this.running = false;
  }

  toggleRun(): void {
    this.running = !this.running;
  }

  pressPointer(id: number, a: Action): void {
    if (this.pointers.has(id)) return;
    this.pointers.set(id, a);
    if (a === 'jump') this.queueJump();
  }

  releasePointer(id: number): void {
    this.pointers.delete(id);
  }

  queueJump(): void {
    if (this.mode === 'simple') return;
    this.jumpQueued = true;
    this.jumpHeldUntil = performance.now() + 180;
  }

  /** 今押されている動作（画面端の表示を光らせる） */
  isActive(a: Action): boolean {
    if (a === 'jump') return performance.now() < this.jumpHeldUntil;
    if (this.mode === 'simple') {
      if (a === 'pull') return this.running;
      if (a === 'brake') return !this.running;
      if (a === 'leanL' || a === 'leanR') return false;
    }
    return [...this.pointers.values()].includes(a) || this.padActive.has(a) || KEYS[a].some((c) => this.keys.has(c));
  }

  read(dt: number): PlayerInput {
    const pad = navigator.getGamepads?.().find((p) => p && p.connected) ?? null;
    this.padActive.clear();
    let analogSteer: number | null = null;
    let analogLean: number | null = null;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      if (dz(pad.axes[0]) !== 0) analogSteer = dz(pad.axes[0]);
      if (dz(pad.axes[2] ?? 0) !== 0) analogLean = dz(pad.axes[2]);
      if ((pad.buttons[7]?.value ?? 0) > 0.3 || pad.buttons[12]?.pressed) this.padActive.add('pull');
      if ((pad.buttons[6]?.value ?? 0) > 0.3 || pad.buttons[13]?.pressed) this.padActive.add('brake');
      if (pad.buttons[0]?.pressed && !this.padJumpHeld) this.queueJump();
      this.padJumpHeld = !!pad.buttons[0]?.pressed;
    }
    const on = (a: Action) => this.isActive(a);
    const steerTarget = analogSteer ?? (on('steerR') ? 1 : 0) - (on('steerL') ? 1 : 0);
    const leanTarget = (on('leanR') ? 1 : 0) - (on('leanL') ? 1 : 0);

    // 団扇の合図は振りはじめてから強まる。体重移動はじわりと掛ける
    this.steer = this.mode === 'simple' ? steerTarget : analogSteer ?? approach(this.steer, steerTarget, steerTarget === 0 ? 5 : 3.2, dt);
    this.lean = this.mode === 'simple' ? 0 : analogLean ?? approach(this.lean, leanTarget, leanTarget === 0 ? 4 : 2.2, dt);

    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return { pull: on('pull'), brake: on('brake'), steer: this.steer, lean: this.lean, jump };
  }
}
