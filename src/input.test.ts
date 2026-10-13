import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from './input';
import { DIFFICULTIES } from './sim/guide';
import { PlaySession } from './sim/session';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  vi.stubGlobal('HTMLButtonElement', class {});
});
afterEach(() => vi.unstubAllGlobals());

describe('操作入力', () => {
  it('かんたん操作は団扇の指を一本だけ使って本編を完走できる', () => {
    const input = new Input();
    input.setMode('simple');
    const session = new PlaySession(DIFFICULTIES.normal, 'simple', false);
    input.toggleRun();
    for (let i = 0; i < 24000 && !session.game.ended; i++) {
      input.releasePointer(1);
      const guide = session.game.guide;
      const dir = guide.corner?.dir ?? 0;
      const steer = guide.cue === 'now' ? dir : guide.cue === 'back' ? -dir : 0;
      if (steer) input.pressPointer(1, steer > 0 ? 'steerR' : 'steerL');
      session.update(1 / 60, input.read(1 / 60));
    }
    expect(session.game.ended).toBe('goal');
    expect(session.game.results).toHaveLength(7);
    expect(session.game.results.filter((r) => r.hits > 0)).toEqual([]);
  });

  it('かんたん操作は発進を保持し、指を離して団扇を操作できる', () => {
    const input = new Input();
    input.setMode('simple');
    expect(input.read(1 / 60).brake).toBe(true);
    input.toggleRun();
    input.pressPointer(1, 'steerR');
    expect(input.read(1 / 60)).toEqual({ pull: true, brake: false, steer: 1, lean: 0, jump: false });
    input.releasePointer(1);
    expect(input.read(1 / 60).pull).toBe(true);
    expect(input.read(1 / 60).steer).toBe(0);
    input.toggleRun();
    expect(input.read(1 / 60).brake).toBe(true);
  });

  it('手動操作の別々の指を識別し、片方の解除で他方を解除しない', () => {
    const input = new Input();
    input.pressPointer(10, 'pull');
    input.pressPointer(11, 'steerR');
    input.pressPointer(12, 'steerR');
    input.releasePointer(11);
    expect(input.isActive('pull')).toBe(true);
    expect(input.isActive('steerR')).toBe(true);
    input.releasePointer(12);
    expect(input.isActive('steerR')).toBe(false);
    expect(input.read(1 / 60).pull).toBe(true);
    input.releasePointer(10);
    expect(input.read(1 / 60).pull).toBe(false);
  });

  it('画面を離れたら押しっぱなし・発進・ジャンプ予約を解除する', () => {
    const input = new Input();
    input.setMode('simple');
    input.toggleRun();
    input.pressPointer(4, 'steerL');
    const deactivate = vi.fn();
    input.onDeactivate = deactivate;
    window.dispatchEvent(new Event('blur'));
    expect(input.read(1 / 60)).toEqual({ pull: false, brake: true, steer: 0, lean: 0, jump: false });
    expect(deactivate).toHaveBeenCalledOnce();
    input.setMode('manual');
    input.queueJump();
    input.reset();
    expect(input.read(1 / 60).jump).toBe(false);
  });

  it('モード切替時に入力を持ち越さず、手動のキーボード操作を残す', () => {
    const input = new Input();
    const down = new Event('keydown');
    Object.defineProperties(down, { code: { value: 'KeyW' }, repeat: { value: false } });
    window.dispatchEvent(down);
    expect(input.read(1 / 60).pull).toBe(true);
    input.setMode('simple');
    expect(input.running).toBe(false);
    input.pressPointer(5, 'leanR');
    input.queueJump();
    expect(input.read(1 / 60).lean).toBe(0);
    expect(input.read(1 / 60).jump).toBe(false);
  });
});
