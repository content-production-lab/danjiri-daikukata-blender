import { describe, expect, it } from 'vitest';
import { Game, type PlayerInput } from './game';
import { CORNER_KMH, DIFFICULTIES, allowedKmh, guideFor, type Cue, type DifficultyId } from './guide';
import { Course, MAIN_COURSE } from './course';
import { DanjiriSim } from './danjiri';

const play = (id: DifficultyId, f: (g: Game) => PlayerInput) => {
  const d = DIFFICULTIES[id];
  const g = new Game({ assist: d.leanAssist, steerAssist: d.steerAssist, autoBrake: d.autoBrake, damageScale: d.damageScale });
  while (!g.ended && g.time < 300) g.tick(1 / 120, f(g));
  return g;
};

/** 画面の手がかりどおりに操作する（速さの色・団扇／戻せの合図） */
const followGuide = (g: Game): PlayerInput => {
  const gd = g.guide;
  const dir = gd.corner?.dir ?? 0;
  const steer = gd.cue === 'now' ? dir : gd.cue === 'back' ? -dir : 0;
  return { pull: g.kmh < Math.min(26, gd.allowed - 1), brake: g.kmh > gd.allowed + 1, steer, lean: 0, jump: false };
};

describe('手がかり', () => {
  it('角に近づくと、まもなく → 振れ → 戻せ の順に出る', () => {
    const course = new Course(MAIN_COURSE);
    const corner = course.corners[0];
    const d = new DanjiriSim();
    d.vf = 5;
    const seen: Cue[] = [];
    for (let dist = 30; dist > -6; dist -= 0.25) {
      const c = guideFor(corner, corner.s - dist, d).cue;
      if (seen[seen.length - 1] !== c) seen.push(c);
    }
    expect(seen).toEqual(['none', 'soon', 'now', 'none', 'back', 'none']);
  });

  it('目安の速さは角に近づくほど下がり、角では 18km/h', () => {
    expect(allowedKmh(40)).toBeGreaterThan(allowedKmh(15));
    expect(allowedKmh(3)).toBe(CORNER_KMH);
    expect(allowedKmh(-10)).toBe(Infinity);
  });
});

describe('難易度', () => {
  it('やさしいなら、曳けを押し続けるだけで宮入りできる', () => {
    const g = play('easy', () => ({ pull: true, brake: false, steer: 0, lean: 0, jump: false }));
    expect(g.ended).toBe('goal');
    expect(g.damage).toBeLessThan(30);
  });

  it('ふつうでも、手がかりどおりに曳けば宮入りできる', () => {
    const g = play('normal', followGuide);
    expect(g.ended).toBe('goal');
    expect(g.results.filter((r) => r.hits > 0).map((r) => r.name)).toEqual([]);
  });

  it('ふつうで曳けを押し続けるだけでは家に突っ込む', () => {
    const g = play('normal', () => ({ pull: true, brake: false, steer: 0, lean: 0, jump: false }));
    expect(g.ended).not.toBe('goal');
  });
});
