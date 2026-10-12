// 大屋根の上に立つ大工方のバランス。描画には依存しない。
// 横（lat）と前後（lon）の2方向に、足元で踏ん張る倒立振子として扱う。
// 値は「崩れ具合」で、|値| >= 1 で屋根から落ちる。

export interface RiderInputs {
  /** 体重移動（-1 = 左へ、+1 = 右へ） */
  lean: number;
  /** 跳ぶ（押した瞬間だけ true） */
  jump: boolean;
}

export interface RoofMotion {
  /** 屋根が受ける加速度（車体基準、右・前）[m/s^2] */
  aRight: number;
  aFwd: number;
  /** 車体の傾き [rad]（+ = 右へ傾く）と、その角加速度 */
  roll: number;
  rollAcc: number;
  /** 路面からの突き上げ（上下の加速度）[m/s^2] */
  bump: number;
}

const G = 9.81;
/** 屋根の高さ [m] */
const ROOF_H = 4.1;

export const RIDER = {
  /** 踏ん張り（復元）の強さ。g/l を上回る分だけ安定する */
  gripLat: 12.7,
  gripLon: 17,
  /** 立ち姿勢の不安定さ g / l */
  pendulum: G / 1.05,
  damping: 3.2,
  /** 見かけの加速度が崩れに効く強さ */
  accelGain: 6.6,
  /** 体重移動の効き */
  leanGain: 4.6,
  /** 跳んだときの滞空時間 [s] */
  airTime: 0.55,
  /** 着地点のずれがこれを超えると屋根から落ちる [m] */
  maxLandingOffset: 0.85,
} as const;

export class RiderSim {
  lat = 0;
  latRate = 0;
  lon = 0;
  lonRate = 0;
  /** 実際の体重移動（入力に遅れて追従） */
  lean = 0;
  airborne = false;
  airT = 0;
  /** 跳んでいる間に屋根が下でずれた量 [m]（右・前） */
  offRight = 0;
  offFwd = 0;
  offVR = 0;
  offVF = 0;
  /** 跳躍の高さ [m]（描画用） */
  height = 0;
  fallen = false;
  fallReason = '';
  /** 直近の着地のずれ [m] */
  lastLandingOffset = 0;
  landedThisStep = false;

  step(dt: number, inp: RiderInputs, roof: RoofMotion): void {
    this.landedThisStep = false;
    if (this.fallen) return;
    const R = RIDER;
    const target = Math.max(-1, Math.min(1, inp.lean));
    this.lean += (target - this.lean) * (1 - Math.exp(-dt / 0.18));

    // 屋根の上で感じる見かけの横加速度: 遠心力 + 屋根の傾き + 傾きの角加速度
    const latAcc = -roof.aRight + G * Math.sin(roof.roll) + roof.rollAcc * ROOF_H;
    const lonAcc = -roof.aFwd;

    if (inp.jump && !this.airborne) {
      this.airborne = true;
      this.airT = 0;
      this.offRight = 0;
      this.offFwd = 0;
      this.offVR = 0;
      this.offVF = 0;
    }

    if (this.airborne) {
      this.airT += dt;
      // 宙にいる間、屋根だけが加速する。屋根から見ると自分が逆へずれる
      this.offVR += latAcc * dt;
      this.offVF += lonAcc * dt;
      this.offRight += this.offVR * dt;
      this.offFwd += this.offVF * dt;
      const t = this.airT / R.airTime;
      this.height = 4 * 0.42 * t * (1 - t);
      if (this.airT >= R.airTime) {
        this.airborne = false;
        this.height = 0;
        this.landedThisStep = true;
        const off = Math.hypot(this.offRight, this.offFwd);
        this.lastLandingOffset = off;
        if (off > R.maxLandingOffset) {
          this.fall('着地で足を踏み外した');
          return;
        }
        // 着地の勢いが崩れになる
        this.latRate += this.offVR * 1.1;
        this.lonRate += this.offVF * 0.9;
        this.lat += this.offRight * 0.6;
      }
      return;
    }

    const bumpKick = roof.bump * 0.02;
    const latA =
      (latAcc / G) * R.accelGain + (R.pendulum - R.gripLat) * this.lat - R.damping * this.latRate + this.lean * R.leanGain;
    const lonA = (lonAcc / G) * R.accelGain * 0.8 + (R.pendulum - R.gripLon) * this.lon - R.damping * this.lonRate;
    this.latRate += (latA + bumpKick * Math.sign(this.lat || 1)) * dt;
    this.lonRate += lonA * dt;
    this.lat += this.latRate * dt;
    this.lon += this.lonRate * dt;

    if (Math.abs(this.lat) >= 1) this.fall(this.lat > 0 ? '右へ振られて屋根から落ちた' : '左へ振られて屋根から落ちた');
    else if (Math.abs(this.lon) >= 1) this.fall(this.lon > 0 ? '前へつんのめって屋根から落ちた' : '後ろへ振られて屋根から落ちた');
  }

  /** 衝突などの突発的な揺れ（車体基準: 右・前の速度変化 [m/s]） */
  jolt(dvRight: number, dvFwd: number): void {
    if (this.fallen) return;
    if (this.airborne) {
      this.offVR -= dvRight;
      this.offVF -= dvFwd;
      return;
    }
    this.latRate -= dvRight * 0.75;
    this.lonRate -= dvFwd * 0.6;
  }

  /** 加速度を打ち消す体重移動（アシスト用） */
  static assistLean(roof: RoofMotion): number {
    const latAcc = -roof.aRight + G * Math.sin(roof.roll);
    return Math.max(-1, Math.min(1, -((latAcc / G) * RIDER.accelGain) / RIDER.leanGain));
  }

  private fall(reason: string): void {
    this.fallen = true;
    this.fallReason = reason;
  }
}
