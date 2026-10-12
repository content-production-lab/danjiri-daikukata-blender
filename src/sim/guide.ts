// 難易度と、角の手前の手がかり（団扇の合図のタイミング・目安の速さ）。描画には依存しない。

import type { Course, Corner } from './course';
import type { DanjiriSim } from './danjiri';

export type DifficultyId = 'easy' | 'normal' | 'pro';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  /** 体重移動の自動の割合（0..1） */
  leanAssist: number;
  /** 団扇（後梃子）の自動の割合（0..1） */
  steerAssist: number;
  /** 角の手前で目安の速さを超えたら自動で減速する */
  autoBrake: boolean;
  /** 傷みの倍率 */
  damageScale: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: { id: 'easy', name: 'やさしい', leanAssist: 1, steerAssist: 0.8, autoBrake: true, damageScale: 0.5 },
  normal: { id: 'normal', name: 'ふつう', leanAssist: 0.75, steerAssist: 0, autoBrake: false, damageScale: 1 },
  pro: { id: 'pro', name: '本職', leanAssist: 0, steerAssist: 0, autoBrake: false, damageScale: 1 },
};

/** 角を曲がるときの目安の速さ [km/h] */
export const CORNER_KMH = 18;
/** 角から離れるほど、1m あたりこれだけ速くてよい [km/h] */
const ALLOW_PER_M = 0.9;

/** 角までの距離 dist [m] で出してよい速さの目安 [km/h] */
export function allowedKmh(dist: number): number {
  if (dist < -4) return Infinity;
  return CORNER_KMH + ALLOW_PER_M * Math.max(0, dist - 6);
}

/** 団扇を振りはじめる距離 [m]（速いほど手前から） */
export function cueDistance(vf: number): number {
  return 6 + Math.max(0, vf) * 0.4;
}
/** 角の手前これだけで振るのをやめ、角を過ぎたら逆へ「戻す」 */
const CUE_END = 1;
const BACK_START = 0.5;
const BACK_END = -3;

/** none: なし、soon: まもなく、now: 角の向きへ振る、back: 逆へ戻して回りすぎを止める */
export type Cue = 'none' | 'soon' | 'now' | 'back';

export interface Guide {
  corner: Corner | null;
  dist: number;
  allowed: number;
  cue: Cue;
  /** 目安に対する速さの評価 */
  speed: 'ok' | 'fast' | 'over' | 'free';
}

export function guideFor(corner: Corner | null, s: number, d: DanjiriSim): Guide {
  if (!corner) return { corner: null, dist: Infinity, allowed: Infinity, cue: 'none', speed: 'free' };
  const dist = corner.s - s;
  const allowed = allowedKmh(dist);
  const cueAt = cueDistance(d.vf);
  const cue: Cue =
    dist <= cueAt && dist > CUE_END
      ? 'now'
      : dist <= BACK_START && dist > BACK_END
        ? 'back'
        : dist > cueAt && dist <= cueAt + 12
          ? 'soon'
          : 'none';
  const kmh = d.vf * 3.6;
  const speed = dist > 35 || dist < -4 ? 'free' : kmh <= allowed + 1 ? 'ok' : kmh <= allowed + 5 ? 'fast' : 'over';
  return { corner, dist, allowed, cue, speed };
}

/** 通りに沿わせる団扇の合図（自動操縦・やさしいの手助け用） */
export function autoSteer(course: Course, s: number, d: DanjiriSim): number {
  const aim = course.pointAt(s + 6 + Math.max(0, d.vf) * 0.5);
  let err = Math.atan2(aim.y - d.y, aim.x - d.x) - d.theta;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  return Math.max(-1, Math.min(1, 3.2 * err - 1.6 * d.omega));
}
