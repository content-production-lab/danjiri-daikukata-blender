import { describe, expect, it } from 'vitest';
import { Course, MAIN_COURSE } from './course';
import { DanjiriSim, SPEC } from './danjiri';
import { RiderSim } from './rider';
import { Game, type PlayerInput } from './game';
import { botInput } from './bot';

const DT = 1 / 120;
const idle: PlayerInput = { pull: false, brake: false, steer: 0, lean: 0, jump: false };

function runGame(assist: number, input: (g: Game) => PlayerInput, maxT = 300): Game {
  const g = new Game({ assist });
  while (!g.ended && g.time < maxT) g.tick(DT, input(g));
  return g;
}

describe('Course', () => {
  const c = new Course(MAIN_COURSE);

  it('角の交差部は四角く道の中で、外の家並みは道の外', () => {
    const k = MAIN_COURSE.points[1];
    expect(c.inside({ x: k.x - 5, y: k.y - 4.9 })).toBe(true); // 角の外側の隅
    expect(c.inside({ x: k.x - 6, y: k.y + 6 })).toBe(false); // 角の内側の家
    expect(c.pushInside({ x: k.x - 6, y: k.y - 20 })).not.toBeNull();
  });

  it('角の向きを正しく判定する（右折 = +1）', () => {
    expect(c.corners.map((x) => x.dir)).toEqual([1, -1, -1, 1, 1]);
  });

  it('角をまたいでも射影の進みが連続する', () => {
    const corner = c.corners[0];
    const before = c.project({ x: 0, y: corner.at.y + 1 }, 0);
    const after = c.project({ x: 1, y: corner.at.y }, before.seg);
    expect(after.s).toBeGreaterThan(before.s - 0.5);
    expect(after.seg).toBe(1);
  });
});

describe('DanjiriSim', () => {
  const ahead = (d: DanjiriSim) => d.toWorld(12, 0);

  it('全力で曳くと加速し、曳き手の走れる速さを超えない', () => {
    const d = new DanjiriSim();
    for (let t = 0; t < 20; t += DT) d.step(DT, { pull: 1, brake: 0, steer: 0 }, ahead(d));
    expect(d.vf).toBeGreaterThan(5.5);
    expect(d.vf).toBeLessThan(SPEC.runSpeed);
  });

  it('前梃子を掛けると止まり、後ろへは下がらない', () => {
    const d = new DanjiriSim();
    d.vf = 6;
    for (let t = 0; t < 5; t += DT) d.step(DT, { pull: 0, brake: 1, steer: 0 }, ahead(d));
    expect(Math.abs(d.vf)).toBeLessThan(0.05);
  });

  it('右へ回す合図で右へ向きを変える（後ろが左へすべる）', () => {
    const d = new DanjiriSim();
    d.vf = 4;
    const th0 = d.theta;
    for (let t = 0; t < 1.5; t += DT) d.step(DT, { pull: 0.4, brake: 0, steer: 1 }, ahead(d));
    expect(d.theta - th0).toBeGreaterThan(0.15);
    expect(d.slip).toBeLessThan(0);
  });

  it('強い横の加速度を受け続けると片輪が浮き、限界を超えると横転する', () => {
    const lift = new DanjiriSim();
    // 左へ曲がる向心加速度（右へ倒れる力）を直接与える
    lift.aRight = -SPEC.halfTrack / SPEC.cgHeight * 9.81 * 1.05;
    (lift as unknown as { stepRoll(dt: number): void }).stepRoll(DT);
    for (let i = 0; i < 20; i++) (lift as unknown as { stepRoll(dt: number): void }).stepRoll(DT);
    expect(lift.roll).toBeGreaterThan(0);
    expect(lift.overturned).toBe(false);

    const over = new DanjiriSim();
    over.aRight = -9.81 * 1.2;
    for (let i = 0; i < 400 && !over.overturned; i++) (over as unknown as { stepRoll(dt: number): void }).stepRoll(DT);
    expect(over.overturned).toBe(true);
  });

  it('普通の加速度では車輪は浮かない', () => {
    const d = new DanjiriSim();
    d.aRight = -3;
    (d as unknown as { stepRoll(dt: number): void }).stepRoll(DT);
    expect(d.roll).toBe(0);
  });

  it('壁に突っ込むと速度が落ち、跳ね返る向きに変わる', () => {
    const d = new DanjiriSim();
    d.theta = 0;
    d.vf = 5;
    const v = d.applyContact(SPEC.halfLength, 0, -1, 0, 0.05);
    expect(v).toBeCloseTo(5, 1);
    expect(d.vf).toBeLessThan(0);
  });
});

describe('RiderSim', () => {
  const turning = (aRight: number) => ({ aRight, aFwd: 0, roll: 0, rollAcc: 0, bump: 0 });

  it('強く曲がる間に体重移動しないと屋根から落ちる', () => {
    const r = new RiderSim();
    for (let t = 0; t < 3 && !r.fallen; t += DT) r.step(DT, { lean: 0, jump: false }, turning(6));
    expect(r.fallen).toBe(true);
  });

  it('内側へ体重移動すれば同じ曲がりでも耐えられる', () => {
    const r = new RiderSim();
    const roof = turning(6);
    for (let t = 0; t < 3; t += DT) r.step(DT, { lean: RiderSim.assistLean(roof), jump: false }, roof);
    expect(r.fallen).toBe(false);
    expect(Math.abs(r.lat)).toBeLessThan(0.2);
  });

  it('直線で体重を掛けすぎても落ちる', () => {
    const r = new RiderSim();
    for (let t = 0; t < 4 && !r.fallen; t += DT) r.step(DT, { lean: 1, jump: false }, turning(0));
    expect(r.fallen).toBe(true);
  });

  it('直線で跳ぶのは安全だが、強く曲がる最中に跳ぶと着地を外す', () => {
    const calm = new RiderSim();
    calm.step(DT, { lean: 0, jump: true }, turning(0));
    for (let t = 0; t < 1.5; t += DT) calm.step(DT, { lean: 0, jump: false }, turning(0));
    expect(calm.fallen).toBe(false);

    const risky = new RiderSim();
    risky.step(DT, { lean: 0, jump: true }, turning(7));
    for (let t = 0; t < 1; t += DT) risky.step(DT, { lean: 0, jump: false }, turning(7));
    expect(risky.fallen).toBe(true);
  });
});

describe('Game', () => {
  it('落ち着いた曳き方ならコースを曳き切って宮入りできる', () => {
    const g = runGame(1, (x) => botInput(x, { cruiseKmh: 24, cornerKmh: 15 }));
    expect(g.ended).toBe('goal');
    expect(g.results).toHaveLength(MAIN_COURSE.points.length - 2);
    expect(g.damage).toBeLessThan(10);
    expect(g.score).toBeGreaterThan(0);
  });

  it('団扇の合図を出さずに角へ入ると家並みに突っ込む', () => {
    const g = runGame(1, (x) => ({ ...botInput(x), steer: 0 }), 120);
    expect(g.ended).not.toBe('goal');
    expect(g.results[0]?.hits ?? 1).toBeGreaterThan(0);
  });

  it('速すぎるやりまわしは失敗する', () => {
    const g = runGame(1, (x) => botInput(x, { cruiseKmh: 30, cornerKmh: 30 }));
    const hits = g.results.reduce((a, r) => a + r.hits, 0);
    expect(g.ended !== 'goal' || hits > 0).toBe(true);
  });

  it('何もしなければ流す程度の速さで進む', () => {
    const g = new Game({ assist: 1 });
    for (let t = 0; t < 8; t += DT) g.tick(DT, idle);
    expect(g.kmh).toBeGreaterThan(5);
    expect(g.kmh).toBeLessThan(20);
  });
});
