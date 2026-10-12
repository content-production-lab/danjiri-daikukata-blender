// キーボード・ゲームパッド・タッチ（画面端のボタン）の入力をまとめる。

import type { PlayerInput } from './sim/game';

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
  private buttons = new Set<Action>();
  private jumpQueued = false;
  private jumpHeldUntil = 0;
  private steer = 0;
  private lean = 0;
  private padJumpHeld = false;
  private padActive = new Set<Action>();
  onToggleCamera: () => void = () => {};
  onToggleMute: () => void = () => {};
  onPause: () => void = () => {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      const nav = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
      if (nav && !(e.target instanceof HTMLButtonElement && e.code === 'Space')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.queueJump();
      if (e.code === 'KeyC') this.onToggleCamera();
      if (e.code === 'KeyM') this.onToggleMute();
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
  }

  setButton(a: Action, on: boolean): void {
    if (a === 'jump') {
      if (on) this.queueJump();
      return;
    }
    if (on) this.buttons.add(a);
    else this.buttons.delete(a);
  }

  queueJump(): void {
    this.jumpQueued = true;
    this.jumpHeldUntil = performance.now() + 180;
  }

  /** 今押されている動作（画面端の表示を光らせる） */
  isActive(a: Action): boolean {
    if (a === 'jump') return performance.now() < this.jumpHeldUntil;
    return this.buttons.has(a) || this.padActive.has(a) || KEYS[a].some((c) => this.keys.has(c));
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
    this.steer = analogSteer ?? approach(this.steer, steerTarget, steerTarget === 0 ? 5 : 3.2, dt);
    this.lean = analogLean ?? approach(this.lean, leanTarget, leanTarget === 0 ? 4 : 2.2, dt);

    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return { pull: on('pull'), brake: on('brake'), steer: this.steer, lean: this.lean, jump };
  }
}
