import { describe, expect, it } from 'vitest';
import {
  ScoreBook,
  comboMultiplier,
  hitPenalty,
  kiwaBonus,
  newCornerTrack,
  overallRank,
  scoreCorner,
  timeBonus,
  type CornerTrack,
} from './score';
import { Game } from './game';
import { botInput } from './bot';

const track = (o: Partial<CornerTrack>): CornerTrack => ({ ...newCornerTrack(18), sumKmh: 18 * 100, n: 100, minKmh: 14, minClear: 2, ...o });

describe('角の採点', () => {
  it('無傷なら加点し、接触すると無傷・際・倍率が消える', () => {
    const clean = scoreCorner(track({ minClear: 0.4 }), 3);
    expect(clean.items.clean).toBe(400);
    expect(clean.items.kiwa).toBe(200);
    expect(clean.multiplier).toBeCloseTo(1.2);
    const hit = scoreCorner(track({ minClear: 0, hits: 1 }), 0);
    expect(hit.items.clean).toBeUndefined();
    expect(hit.items.kiwa).toBeUndefined();
    expect(hit.items.combo).toBeUndefined();
    expect(hit.total).toBeLessThan(clean.total);
  });

  it('際は家並みに近いほど高い', () => {
    expect([0.2, 0.5, 0.9, 1.5].map(kiwaBonus)).toEqual([300, 200, 100, 0]);
  });

  it('連続の倍率は 1.5 で頭打ち', () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(4)).toBeCloseTo(1.3);
    expect(comboMultiplier(20)).toBe(1.5);
  });

  it('角で跳んで無事に着地すると大技、片輪を戻すと片輪返し', () => {
    const r = scoreCorner(track({ jumpsLanded: 2, wheelLift: true, liftRecovered: true }), 1);
    expect(r.items.jump).toBeGreaterThan(2 * 150);
    expect(r.items.lift).toBe(200);
  });

  it('角で止まりかけると減点', () => {
    expect(scoreCorner(track({ minKmh: 3 }), 1).items.stall).toBe(-200);
  });

  it('接触の減点は速さに比例し、電柱は重く、布団は軽い', () => {
    expect(hitPenalty(3, 'wall', false)).toBe(-120);
    expect(hitPenalty(3, 'pole', false)).toBe(-180);
    expect(hitPenalty(3, 'pole', true)).toBe(-60);
  });
});

describe('帳簿と総合ランク', () => {
  it('体勢の崩れは 1 秒ごとに 40 点引く', () => {
    const b = new ScoreBook();
    for (let i = 0; i < 250; i++) b.addPostureTime(0.01);
    expect(b.items.posture).toBe(-80);
  });

  it('タイムが速いほど加点、宮入りしなければランクは D', () => {
    expect(timeBonus(100)).toBeGreaterThan(timeBonus(120));
    expect(timeBonus(200)).toBe(0);
    expect(overallRank(99999, false).letter).toBe('D');
    expect(overallRank(11000, true).letter).toBe('S');
    expect(overallRank(100, true).letter).toBe('D');
  });
});

describe('通しの採点', () => {
  const run = (corner: number, jump: boolean) => {
    const g = new Game({ assist: 1 });
    let lastJ = -9;
    while (!g.ended && g.time < 300) {
      const inp = botInput(g, { cruiseKmh: 27, cornerKmh: corner });
      const c = g.upcomingCorner;
      if (jump && c && Math.abs(c.s - g.s) < 3 && g.time - lastJ > 1.5) {
        inp.jump = true;
        lastJ = g.time;
      }
      g.tick(1 / 120, inp);
    }
    return g;
  };

  it('慎重な曳き方は宮入りして C 以上、角で跳ぶとランクが上がる', () => {
    const calm = run(15, false);
    const bold = run(22, true);
    expect(calm.ended).toBe('goal');
    expect(bold.ended).toBe('goal');
    expect('SABC').toContain(calm.rank.letter);
    expect(bold.score).toBeGreaterThan(calm.score);
    expect('SABCD'.indexOf(bold.rank.letter)).toBeLessThan('SABCD'.indexOf(calm.rank.letter));
    expect(bold.book.items.jump ?? 0).toBeGreaterThan(0);
  });
});
