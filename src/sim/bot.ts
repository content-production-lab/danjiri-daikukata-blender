// 自動操縦（テストとデモ用）。コースを曳き切れることの確認に使う。

import type { Game, PlayerInput } from './game';

export interface BotParams {
  /** 直線での目標速度 [km/h] */
  cruiseKmh: number;
  /** 角での目標速度 [km/h] */
  cornerKmh: number;
}

export function botInput(g: Game, p: BotParams = { cruiseKmh: 24, cornerKmh: 15 }): PlayerInput {
  const d = g.danjiri;
  const c = g.upcomingCorner;
  const distToCorner = c ? c.s - g.s : Infinity;
  const target = distToCorner < 28 && distToCorner > -6 ? p.cornerKmh : p.cruiseKmh;

  const aim = g.course.pointAt(g.s + 6 + Math.max(0, d.vf) * 0.5);
  const want = Math.atan2(aim.y - d.y, aim.x - d.x);
  let err = want - d.theta;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const steer = Math.max(-1, Math.min(1, 3.2 * err - 1.6 * d.omega));

  const kmh = g.kmh;
  return {
    pull: kmh < target - 1,
    brake: kmh > target + 3,
    steer,
    lean: 0,
    jump: false,
  };
}
