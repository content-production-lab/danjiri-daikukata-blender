// 採点（加点・減点・倍率）と総合ランク。描画には依存しない。仕様は docs/SPEC.md 5.1・5.2。

export type ScoreKey =
  | 'speed'
  | 'clean'
  | 'kiwa'
  | 'jump'
  | 'lift'
  | 'combo'
  | 'time'
  | 'safe'
  | 'hit'
  | 'slam'
  | 'posture'
  | 'stall';

export const SCORE_LABELS: Record<ScoreKey, string> = {
  speed: '角の速さ',
  clean: '無傷',
  kiwa: '際（きわ）',
  jump: '大技（跳び）',
  lift: '片輪返し',
  combo: '連続の倍率',
  time: 'タイム',
  safe: '無事',
  hit: '接触',
  slam: 'ドスン',
  posture: '体勢の崩れ',
  stall: '止まりかけ',
};

/** 角ひとつ分の記録 */
export interface CornerTrack {
  entryKmh: number;
  minKmh: number;
  sumKmh: number;
  n: number;
  hits: number;
  /** 角の最中に跳んで無事に着地した回数 */
  jumpsLanded: number;
  /** 片輪が浮いたか・浮いたあと無事に戻ったか */
  wheelLift: boolean;
  liftRecovered: boolean;
  /** 家並みとの最小間隔 [m] */
  minClear: number;
}

export interface CornerScore {
  items: Partial<Record<ScoreKey, number>>;
  /** 倍率を掛けたあとの合計 */
  total: number;
  multiplier: number;
  grade: string;
}

export const newCornerTrack = (kmh: number): CornerTrack => ({
  entryKmh: kmh,
  minKmh: kmh,
  sumKmh: 0,
  n: 0,
  hits: 0,
  jumpsLanded: 0,
  wheelLift: false,
  liftRecovered: false,
  minClear: Infinity,
});

/** 連続で無傷の角の数から倍率（上限 1.5） */
export const comboMultiplier = (streak: number) => Math.min(1.5, 1 + 0.1 * Math.max(0, streak - 1));

export function kiwaBonus(minClear: number): number {
  if (minClear < 0.3) return 300;
  if (minClear < 0.6) return 200;
  if (minClear < 1.0) return 100;
  return 0;
}

/**
 * 角の点数。
 * @param streak この角を含めた連続無傷の数（接触したら 0）
 */
export function scoreCorner(z: CornerTrack, streak: number): CornerScore {
  const avg = z.n ? z.sumKmh / z.n : 0;
  const clean = z.hits === 0;
  const items: Partial<Record<ScoreKey, number>> = {};
  items.speed = Math.round(z.minKmh * 25 + avg * 12);
  if (clean) items.clean = 400;
  if (clean) {
    const k = kiwaBonus(z.minClear);
    if (k) items.kiwa = k;
  }
  if (z.jumpsLanded) items.jump = z.jumpsLanded * Math.round(150 + avg * 12);
  if (z.liftRecovered && clean) items.lift = 200;
  const plus = Object.values(items).reduce((a, b) => a + (b ?? 0), 0);
  const multiplier = clean ? comboMultiplier(streak) : 1;
  const comboPts = Math.round(plus * (multiplier - 1));
  if (comboPts) items.combo = comboPts;
  if (z.minKmh < 5) items.stall = -200;
  const total = plus + comboPts + (items.stall ?? 0);
  return { items, total, multiplier, grade: cornerGrade(total, clean) };
}

export function cornerGrade(total: number, clean: boolean): string {
  if (!clean && total < 600) return 'あかん';
  if (total >= 1700) return '極';
  if (total >= 1300) return '見事';
  if (total >= 950) return 'ええで';
  return 'まだまだ';
}

/** 接触の減点 */
export function hitPenalty(speed: number, kind: 'wall' | 'pole', padded: boolean): number {
  const k = kind === 'pole' ? (padded ? 0.5 : 1.5) : 1;
  return -Math.round(speed * 40 * k);
}

export const slamPenalty = (strength: number) => -Math.round(strength * 60);

/** 宮入りのタイム・無事ボーナス */
export const timeBonus = (sec: number) => Math.max(0, Math.round((150 - sec) * 20));
export const safeBonus = (damage: number) => Math.max(0, Math.round((100 - damage) * 5));

export interface Rank {
  letter: 'S' | 'A' | 'B' | 'C' | 'D';
  name: string;
}

/** 総合ランクの境目（自動操縦の試走から決めた。sim.test.ts 参照） */
export const RANK_THRESHOLDS: [number, Rank][] = [
  [11000, { letter: 'S', name: '極' }],
  [8800, { letter: 'A', name: '見事' }],
  [7000, { letter: 'B', name: 'ええで' }],
  [4800, { letter: 'C', name: 'まだまだ' }],
];

export function overallRank(total: number, cleared: boolean): Rank {
  if (!cleared) return { letter: 'D', name: '出直し' };
  for (const [min, r] of RANK_THRESHOLDS) if (total >= min) return r;
  return { letter: 'D', name: '出直し' };
}

/** 項目ごとの合計を持つ帳簿 */
export class ScoreBook {
  readonly items: Partial<Record<ScoreKey, number>> = {};
  private postureAcc = 0;

  add(key: ScoreKey, pts: number): void {
    if (!pts) return;
    this.items[key] = (this.items[key] ?? 0) + pts;
  }

  /** 重心が危険域にいた時間を積み、1秒ごとに 40 点引く */
  addPostureTime(dt: number): void {
    this.postureAcc += dt;
    while (this.postureAcc >= 1) {
      this.postureAcc -= 1;
      this.add('posture', -40);
    }
  }

  get total(): number {
    return Object.values(this.items).reduce((a, b) => a + (b ?? 0), 0);
  }

  /** 表示用（加点が先、減点が後） */
  lines(): { key: ScoreKey; label: string; pts: number }[] {
    return (Object.keys(this.items) as ScoreKey[])
      .map((key) => ({ key, label: SCORE_LABELS[key], pts: this.items[key] ?? 0 }))
      .filter((l) => l.pts !== 0)
      .sort((a, b) => b.pts - a.pts);
  }
}
