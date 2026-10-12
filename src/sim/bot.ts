// 自動操縦（テストとデモ用）。コースを曳き切れることの確認に使う。

import type { Game, PlayerInput } from './game';
import { autoSteer } from './guide';

export interface BotParams {
  /** 直線での目標速度 [km/h] */
  cruiseKmh: number;
  /** 角での目標速度 [km/h] */
  cornerKmh: number;
}

export function botInput(g: Game, p: BotParams = { cruiseKmh: 24, cornerKmh: 15 }): PlayerInput {
  const c = g.upcomingCorner;
  const distToCorner = c ? c.s - g.s : Infinity;
  const target = distToCorner < 28 && distToCorner > -6 ? p.cornerKmh : p.cruiseKmh;

  const steer = autoSteer(g.course, g.s, g.danjiri);

  const kmh = g.kmh;
  return {
    pull: kmh < target - 1,
    brake: kmh > target + 3,
    steer,
    lean: 0,
    jump: false,
  };
}
