// コース（町筋）の定義と幾何計算。描画には依存しない。
// 座標系: 平面 (x, y)。y は three.js の world z に対応する。
// 向き θ は x 軸から y 軸へ回る角度で、前方 = (cosθ, sinθ)、右 = (-sinθ, cosθ)。

export interface Vec2 {
  x: number;
  y: number;
}

export interface CourseDef {
  name: string;
  /** 通りの中心線の折れ点 */
  points: Vec2[];
  /** 区間ごとの道幅 [m]（points.length - 1 個） */
  widths: number[];
  /** 角（points[1]..points[n-2]）の名前 */
  cornerNames: string[];
}

export interface Segment {
  a: Vec2;
  b: Vec2;
  ux: number;
  uy: number;
  len: number;
  /** 道幅の半分 */
  hw: number;
  /** この区間の始点までの累積距離 */
  s0: number;
}

export interface Corner {
  index: number;
  name: string;
  at: Vec2;
  /** 中心線上の累積距離 */
  s: number;
  /** +1 = 右折、-1 = 左折 */
  dir: 1 | -1;
}

export interface Pole {
  x: number;
  y: number;
  r: number;
  /** 角の電柱には布団が巻いてある */
  padded: boolean;
  /** 同じ並び（区間と側）の電柱は同じ番号。電線をつなぐのに使う */
  line: number;
}

export interface Projection {
  s: number;
  seg: number;
  /** 中心線からの右方向のずれ */
  lateral: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Course {
  readonly def: CourseDef;
  readonly segs: Segment[] = [];
  readonly corners: Corner[] = [];
  readonly poles: Pole[] = [];
  readonly total: number;

  constructor(def: CourseDef) {
    this.def = def;
    let s = 0;
    for (let i = 0; i < def.points.length - 1; i++) {
      const a = def.points[i];
      const b = def.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.segs.push({ a, b, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len, hw: def.widths[i] / 2, s0: s });
      s += len;
    }
    this.total = s;
    for (let i = 1; i < def.points.length - 1; i++) {
      const p = this.segs[i - 1];
      const n = this.segs[i];
      const cross = p.ux * n.uy - p.uy * n.ux;
      this.corners.push({ index: i, name: def.cornerNames[i - 1] ?? `${i}の辻`, at: def.points[i], s: n.s0, dir: cross > 0 ? 1 : -1 });
    }
    this.placePoles();
  }

  /** 点が道の中にあるか（各区間を道幅ぶん延長した長方形の和集合） */
  inside(p: Vec2, margin = 0): boolean {
    for (const sg of this.segs) {
      const dx = p.x - sg.a.x;
      const dy = p.y - sg.a.y;
      const t = dx * sg.ux + dy * sg.uy;
      const n = -dx * sg.uy + dy * sg.ux;
      const hw = sg.hw - margin;
      if (t >= -hw && t <= sg.len + hw && Math.abs(n) <= hw) return true;
    }
    return false;
  }

  /** 道の中の点から、家並み（道の端）までの距離の目安。外なら 0 */
  clearance(p: Vec2): number {
    let best = 0;
    for (const sg of this.segs) {
      const dx = p.x - sg.a.x;
      const dy = p.y - sg.a.y;
      const t = dx * sg.ux + dy * sg.uy;
      const n = -dx * sg.uy + dy * sg.ux;
      const d = Math.min(sg.hw - Math.abs(n), t + sg.hw, sg.len + sg.hw - t);
      if (d > best) best = d;
    }
    return best;
  }

  /** 道の外に出た点を道の中へ戻すベクトル（中なら null） */
  pushInside(p: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const sg of this.segs) {
      const dx = p.x - sg.a.x;
      const dy = p.y - sg.a.y;
      const t = dx * sg.ux + dy * sg.uy;
      const n = -dx * sg.uy + dy * sg.ux;
      const tc = clamp(t, -sg.hw, sg.len + sg.hw);
      const nc = clamp(n, -sg.hw, sg.hw);
      if (tc === t && nc === n) return null;
      const cx = sg.a.x + sg.ux * tc - sg.uy * nc;
      const cy = sg.a.y + sg.uy * tc + sg.ux * nc;
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < bestD) {
        bestD = d;
        best = { x: cx - p.x, y: cy - p.y };
      }
    }
    return best;
  }

  /** 中心線への射影。hint 付近の区間だけを見て、角での飛びを防ぐ */
  project(p: Vec2, hint = 0): Projection {
    let best: Projection = { s: 0, seg: 0, lateral: 0 };
    let bestD = Infinity;
    const lo = Math.max(0, hint - 1);
    const hi = Math.min(this.segs.length - 1, hint + 1);
    for (let i = lo; i <= hi; i++) {
      const sg = this.segs[i];
      const dx = p.x - sg.a.x;
      const dy = p.y - sg.a.y;
      const t = clamp(dx * sg.ux + dy * sg.uy, 0, sg.len);
      const n = -dx * sg.uy + dy * sg.ux;
      const cx = sg.a.x + sg.ux * t;
      const cy = sg.a.y + sg.uy * t;
      const d = Math.hypot(p.x - cx, p.y - cy);
      // 前の区間を優先しすぎないよう、少しだけ先の区間に有利にする
      const bias = i > hint ? -0.5 : 0;
      if (d + bias < bestD) {
        bestD = d + bias;
        best = { s: sg.s0 + t, seg: i, lateral: n };
      }
    }
    return best;
  }

  /** 累積距離 s の中心線上の点と向き */
  pointAt(s: number): { x: number; y: number; ux: number; uy: number; seg: number } {
    const ss = clamp(s, 0, this.total);
    let i = 0;
    while (i < this.segs.length - 1 && this.segs[i].s0 + this.segs[i].len < ss) i++;
    const sg = this.segs[i];
    const t = ss - sg.s0;
    return { x: sg.a.x + sg.ux * t, y: sg.a.y + sg.uy * t, ux: sg.ux, uy: sg.uy, seg: i };
  }

  /** 中心線に沿って、角の内側を少し切る点（綱の先頭が走る線） */
  ropeLineAt(s: number): Vec2 {
    const p = this.pointAt(s);
    for (const c of this.corners) {
      const d = s - c.s;
      if (Math.abs(d) < 6) {
        // 角の手前後 6m で内側へ寄せる
        const w = 1 - Math.abs(d) / 6;
        const pr = this.segs[c.index - 1];
        const nx = this.segs[c.index];
        // 内側方向 = 次の区間の向きの逆 + 前の区間の向き（角の内側）
        const ix = nx.ux - pr.ux;
        const iy = nx.uy - pr.uy;
        const il = Math.hypot(ix, iy) || 1;
        const k = Math.min(pr.hw, nx.hw) * 0.35 * w;
        return { x: p.x + (ix / il) * k, y: p.y + (iy / il) * k };
      }
    }
    return { x: p.x, y: p.y };
  }

  private placePoles() {
    for (let i = 0; i < this.segs.length; i++) {
      const sg = this.segs[i];
      for (const side of [-1, 1]) {
        for (let t = 12; t < sg.len - 12; t += 28) {
          const off = sg.hw - 0.35;
          const x = sg.a.x + sg.ux * t - sg.uy * off * side;
          const y = sg.a.y + sg.uy * t + sg.ux * off * side;
          this.poles.push({ x, y, r: 0.18, padded: false, line: i * 2 + (side > 0 ? 1 : 0) });
        }
      }
    }
    // 角の外側には、布団を巻いた電柱を立てる
    for (const c of this.corners) {
      const pr = this.segs[c.index - 1];
      const nx = this.segs[c.index];
      const hwp = nx.hw - 0.45;
      const hwn = pr.hw - 0.45;
      this.poles.push({ x: c.at.x + pr.ux * hwp - nx.ux * hwn, y: c.at.y + pr.uy * hwp - nx.uy * hwn, r: 0.35, padded: true, line: -1 });
    }
  }
}

/** 発進・停止と右折・左折だけを練習する独立コース。 */
export const TUTORIAL_COURSE: CourseDef = {
  name: '操作練習コース',
  points: [{ x: 0, y: 0 }, { x: 0, y: -100 }, { x: 100, y: -100 }, { x: 100, y: -140 }],
  widths: [11, 11, 11],
  cornerNames: ['練習・右の辻', '練習・左の辻'],
};

export const MAIN_COURSE: CourseDef = {
  name: '浜町 曳行コース',
  points: [
    { x: 0, y: 0 },
    { x: 0, y: -80 },
    { x: 100, y: -80 },
    { x: 100, y: -180 },
    { x: 0, y: -180 },
    { x: 0, y: -280 },
    { x: 100, y: -280 },
    { x: 100, y: -380 },
    { x: 180, y: -380 },
  ],
  widths: [11, 10, 9.5, 10, 9.5, 10, 9.5, 11],
  cornerNames: ['浜の辻', '本町角', '紺屋町角', '魚屋町角', '大通り角', '宮前通り角', '宮入りの辻'],
};
