import { describe, expect, it } from 'vitest';
import { Course, MAIN_COURSE, TUTORIAL_COURSE } from './course';
import { DIFFICULTIES } from './guide';
import { PlaySession } from './session';
import type { PlayerInput } from './game';
import { overallRank, timeBonus } from './score';

const DT = 1 / 60;
const stopped: PlayerInput = { pull: false, brake: true, steer: 0, lean: 0, jump: false };
function guideInput(s: PlaySession): PlayerInput {
  const gd = s.game.guide;
  const dir = gd.corner?.dir ?? 0;
  return { pull: true, brake: false, steer: gd.cue === 'now' ? dir : gd.cue === 'back' ? -dir : 0, lean: 0, jump: false };
}

describe('長いコースとチュートリアル', () => {
  it('練習240m・2角と通常760m・7角を独立させ、通常は先頭から開始する', () => {
    const c = new Course(MAIN_COURSE);
    expect(c.total).toBe(760);
    expect(c.corners).toHaveLength(7);
    const practice = new Course(TUTORIAL_COURSE);
    expect(practice.total).toBe(240);
    expect(practice.corners.map((corner) => corner.dir)).toEqual([1, -1]);
    const s = new PlaySession(DIFFICULTIES.normal, 'simple');
    expect(s.lesson).toBe('main');
    expect(s.game.s).toBe(0);
    expect(s.game.totalCorners).toBe(7);
    expect(s.game.upcomingCorner?.name).toBe('浜の辻');
  });

  it('発進・停止・再開と、左右の団扇／戻せを順に練習し、本編へ移れる', () => {
    const s = new PlaySession(DIFFICULTIES.normal, 'simple', true);
    for (let i = 0; i < 120; i++) s.update(DT, stopped);
    expect(s.lesson).toBe('start');
    expect(s.game.time).toBe(0);
    while (s.game.s < 15) s.update(DT, guideInput(s));
    for (let i = 0; i < 600 && s.lesson !== 'resume'; i++) s.update(DT, stopped);
    expect(s.lesson).toBe('resume');
    const waits = new Set<string>();
    const lessons = new Set<string>();
    for (let i = 0; i < 18000 && s.lesson !== 'ready' && s.lesson !== 'failed'; i++) {
      lessons.add(s.lesson);
      // 各合図で一度待ち、時間も位置も進まないことを確かめる。
      const cueKey = `${s.lesson}:${s.game.guide.cue}`;
      s.update(DT, { ...guideInput(s), steer: waits.has(cueKey) ? guideInput(s).steer : 0 });
      if (s.waitingSteer) {
        const time = s.game.time;
        const pos = s.game.s;
        const key = `${s.lesson}:${s.game.guide.cue}`;
        waits.add(key);
        for (let j = 0; j < 12; j++) s.update(DT, { ...guideInput(s), steer: 0 });
        expect(s.game.time).toBe(time);
        expect(s.game.s).toBe(pos);
      }
    }
    expect(s.lesson).toBe('ready');
    expect(s.game.course.def).toBe(TUTORIAL_COURSE);
    expect(s.game.results).toHaveLength(2);
    const completedPractice = s.game;
    for (let i = 0; i < 120; i++) expect(s.update(DT, guideInput(s))).toEqual([]);
    expect(s.lesson).toBe('ready');
    expect(s.game).toBe(completedPractice);
    expect(lessons).toContain('right');
    expect(lessons).toContain('left');
    expect([...waits].sort()).toEqual(['left:back', 'left:now', 'right:back', 'right:now']);
    s.startMain();
    const skip = new PlaySession(DIFFICULTIES.normal, 'simple', false);
    expect(s.game.time).toBe(0);
    expect(s.game.score).toBe(0);
    expect(s.game.damage).toBe(0);
    expect(s.game.results).toEqual([]);
    expect(s.game.danjiri).toEqual(skip.game.danjiri);
    // 練習の有無で本編の採点・乱数の結果が変わらない。
    for (let i = 0; i < 24000 && !s.game.ended; i++) {
      s.update(DT, guideInput(s));
      skip.update(DT, guideInput(skip));
    }
    expect(s.game.ended).toBe('goal');
    expect(s.game.results).toHaveLength(7);
    expect(s.game.results.filter((r) => r.hits > 0).map((r) => r.name)).toEqual([]);
    expect(s.game.score).toBe(skip.game.score);
    expect(s.game.rank).toEqual(skip.game.rank);
  });

  it('練習の失敗を本編終了にせず、練習だけ再開できる', () => {
    const s = new PlaySession(DIFFICULTIES.pro, 'manual', true);
    while (s.game.kmh < 5) s.update(DT, { ...stopped, pull: true, brake: false });
    s.game.rider.fallen = true;
    expect(s.update(DT, stopped)).toEqual([]);
    expect(s.lesson).toBe('failed');
    s.retryTutorial();
    expect(s.lesson).toBe('start');
    expect(s.game.ended).toBeNull();
    expect(s.game.s).toBe(4);
    s.startMain();
    expect(s.lesson).toBe('main');
    expect(s.game.opts.assist).toBe(0);
    expect(s.game.opts.autoBrake).toBe(false);
  });

  it('延長に応じてタイム加点とランク境界を補正する', () => {
    expect(timeBonus(150, 760)).toBeGreaterThan(0);
    expect(timeBonus(150, 650)).toBe(0);
    expect(overallRank(15400, true, 7).letter).toBe('S');
    expect(overallRank(15399, true, 7).letter).toBe('A');
    expect(overallRank(15400, false, 7).letter).toBe('D');
  });
});
