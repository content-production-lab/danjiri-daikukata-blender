// 地車（だんじり）の車体運動。描画には依存しない。
// 車輪は舵を切れない。曲がるには、綱で前を引き、後梃子（うしろてこ）で後ろを外へ振って、車輪を横すべりさせる。

import type { Vec2 } from './course';

export const G = 9.81;

export const SPEC = {
  /** 総重量 [kg]（約4トン） */
  mass: 4000,
  /** ヨー慣性モーメント [kg m^2] */
  yawInertia: 9000,
  /** 重心高さ [m]。屋根が重いので高い */
  cgHeight: 1.55,
  /** 輪距の半分 [m] */
  halfTrack: 0.95,
  /** 車体長の半分・幅の半分（衝突判定）[m] */
  halfLength: 2.05,
  halfWidth: 1.3,
  /** 前後車軸の重心からの距離 [m] */
  axle: 0.85,
  /** 綱が付く位置・後梃子の位置（前後端）[m] */
  ropeArm: 2.0,
  tekoArm: 2.1,
  /** 木の車輪と路面の横すべり摩擦係数 */
  muSide: 0.78,
  /** 転がり抵抗係数（木の車輪なので大きめ） */
  rollRes: 0.035,
  /** 曳き手の最大の引く力 [N] と全力で走れる速さ [m/s] */
  ropeForceMax: 11000,
  runSpeed: 8.6,
  /** 曳き手の反応の遅れ [s] */
  ropeLag: 0.7,
  /** 後梃子の最大の横押し [N] と反応の遅れ [s] */
  tekoForceMax: 12500,
  tekoLag: 0.35,
  /** 前梃子のブレーキ [N] */
  brakeForceMax: 26000,
} as const;

export interface DanjiriControls {
  /** 曳き手への合図（0 = 歩く、1 = 全力） */
  pull: number;
  /** 前梃子のブレーキ（0..1） */
  brake: number;
  /** 団扇による後梃子への合図（-1 = 左へ回す、+1 = 右へ回す） */
  steer: number;
}

export interface ContactEvent {
  /** 壁に当たった速さ [m/s] */
  speed: number;
  /** 当たった点（車体基準: 前方, 右方） */
  localFwd: number;
  localRight: number;
  kind: 'wall' | 'pole';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class DanjiriSim {
  x = 0;
  y = 0;
  theta = -Math.PI / 2;
  /** 車体基準の速度: 前方・右方 [m/s] */
  vf = 0;
  vr = 0;
  /** ヨーレート [rad/s]（+ = 右回り） */
  omega = 0;

  /** 実際に効いている綱の力・後梃子の力 [N]（合図に遅れて追従） */
  ropeForce = 0;
  tekoForce = 0;
  ropeDir: Vec2 = { x: 0, y: -1 };

  /** 片輪が浮いた傾き [rad]（+ = 右へ傾き、左の車輪が浮く） */
  roll = 0;
  rollRate = 0;
  rollAcc = 0;
  /** 着地の衝撃（直近の値） */
  slam = 0;
  overturned = false;

  /** 直近の加速度（車体基準）[m/s^2] */
  aFwd = 0;
  aRight = 0;

  /** 車体基準の横すべり速度（演出用） */
  slip = 0;

  get speed(): number {
    return Math.hypot(this.vf, this.vr);
  }

  forward(): Vec2 {
    return { x: Math.cos(this.theta), y: Math.sin(this.theta) };
  }

  right(): Vec2 {
    return { x: -Math.sin(this.theta), y: Math.cos(this.theta) };
  }

  toWorld(fwd: number, right: number): Vec2 {
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    return { x: this.x + c * fwd - s * right, y: this.y + s * fwd + c * right };
  }

  /**
   * 1ステップ進める。
   * @param ropeTarget 綱の先（曳き手の先頭付近）の位置。綱はそちらへ引く。
   */
  step(dt: number, ctl: DanjiriControls, ropeTarget: Vec2): void {
    const S = SPEC;
    const m = S.mass;
    if (this.overturned) {
      this.vf *= Math.exp(-4 * dt);
      this.vr *= Math.exp(-4 * dt);
      this.omega *= Math.exp(-4 * dt);
      this.integratePose(dt);
      return;
    }

    // 曳き手は全力で走る速さに近づくほど引けなくなる
    const pull = clamp(ctl.pull, 0, 1);
    const along = Math.max(0, this.vf);
    const ropeTargetForce = pull * S.ropeForceMax * clamp(1 - along / (S.runSpeed * (0.45 + 0.55 * pull)), -0.3, 1);
    this.ropeForce += (ropeTargetForce - this.ropeForce) * (1 - Math.exp(-dt / S.ropeLag));
    const tekoTarget = clamp(ctl.steer, -1, 1) * S.tekoForceMax;
    this.tekoForce += (tekoTarget - this.tekoForce) * (1 - Math.exp(-dt / S.tekoLag));

    // 綱の向き（車体基準）
    const tip = this.toWorld(S.ropeArm, 0);
    let rdx = ropeTarget.x - tip.x;
    let rdy = ropeTarget.y - tip.y;
    const rl = Math.hypot(rdx, rdy);
    if (rl > 1e-3) {
      rdx /= rl;
      rdy /= rl;
    } else {
      const f = this.forward();
      rdx = f.x;
      rdy = f.y;
    }
    this.ropeDir = { x: rdx, y: rdy };
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    let ropeF = rdx * c + rdy * s;
    let ropeR = -rdx * s + rdy * c;
    // 綱は真後ろへは引けない。横向きの成分は綱の角度で限られる
    if (ropeF < 0.2) {
      ropeF = 0.2;
      ropeR = Math.sign(ropeR) * Math.sqrt(1 - 0.04);
    }
    const Fr = Math.max(0, this.ropeForce);
    const ropeFx = Fr * ropeF;
    const ropeFy = Fr * ropeR;

    // 片輪が浮くと、浮いた側の車輪のぶん横の踏ん張りが減る
    const liftFactor = this.roll !== 0 ? 0.7 : 1;
    const N = (m * G) / 2;
    const v0 = 0.25;
    const vrFront = this.vr + this.omega * S.axle;
    const vrRear = this.vr - this.omega * S.axle;
    const Ff = -S.muSide * N * liftFactor * Math.tanh(vrFront / v0);
    const Fb = -S.muSide * N * liftFactor * Math.tanh(vrRear / v0);

    // 後梃子: 後端を横へ押す（右へ回すには後ろを左へ）
    const tekoFy = -this.tekoForce;

    const rolling = -S.rollRes * m * G * Math.tanh(this.vf / 0.3);
    const brake = -clamp(ctl.brake, 0, 1) * S.brakeForceMax * Math.tanh(this.vf / 0.4);

    const Fx = ropeFx + rolling + brake;
    const Fy = ropeFy + Ff + Fb + tekoFy;
    const Mz = S.ropeArm * ropeFy + S.axle * Ff - S.axle * Fb + -S.tekoArm * tekoFy;

    this.aFwd = Fx / m;
    this.aRight = Fy / m;
    this.vf += (this.aFwd + this.omega * this.vr) * dt;
    this.vr += (this.aRight - this.omega * this.vf) * dt;
    this.omega += (Mz / S.yawInertia) * dt;
    // 構造の内部摩擦による減衰
    this.omega *= Math.exp(-0.6 * dt);
    if (Math.abs(this.vf) < 0.02 && pull < 0.05) this.vf = 0;
    this.slip = vrRear;

    this.stepRoll(dt);
    this.integratePose(dt);
  }

  /** 片輪浮き・横転。浮いていなければ傾きは 0（構造のたわみは描画側で付ける） */
  private stepRoll(dt: number): void {
    const S = SPEC;
    const h = S.cgHeight;
    const w = S.halfTrack;
    const m = S.mass;
    const Ip = m * ((4 * 4 + 2.5 * 2.5) / 12 + h * h + w * w);
    // 車体が受ける見かけの横加速度（右回り旋回なら左へ）
    const inertial = -this.aRight;
    const d = this.roll !== 0 ? Math.sign(this.roll) : Math.sign(inertial);
    const L = Math.abs(this.roll);
    const A = inertial * d;
    const torque = m * (A * (w * Math.sin(L) + h * Math.cos(L)) - G * (w * Math.cos(L) - h * Math.sin(L)));
    this.slam = 0;
    if (L === 0 && torque <= 0) {
      this.rollRate = 0;
      this.rollAcc = 0;
      return;
    }
    const acc = torque / Ip - 1.5 * this.rollRate * d;
    this.rollAcc = acc * d;
    let rate = this.rollRate * d + acc * dt;
    let nl = L + rate * dt;
    if (nl <= 0) {
      // 浮いた車輪が地面へ戻った（ドスン）
      this.slam = Math.abs(rate);
      nl = 0;
      rate = 0;
    }
    this.roll = nl * d;
    this.rollRate = rate * d;
    if (nl > Math.atan2(w, h) + 0.05) this.overturned = true;
  }

  private integratePose(dt: number): void {
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    this.x += (c * this.vf - s * this.vr) * dt;
    this.y += (s * this.vf + c * this.vr) * dt;
    this.theta += this.omega * dt;
  }

  /** 車体の4隅（世界座標） */
  corners(): { p: Vec2; lf: number; lr: number }[] {
    const L = SPEC.halfLength;
    const W = SPEC.halfWidth;
    return [
      [L, W],
      [L, -W],
      [-L, W],
      [-L, -W],
    ].map(([lf, lr]) => ({ p: this.toWorld(lf, lr), lf, lr }));
  }

  /**
   * 接触点に法線方向の撃力を与える（壁・電柱）。
   * @returns 接触時の法線方向の速さ（離れていく場合は 0）
   */
  applyContact(lf: number, lr: number, nx: number, ny: number, depth: number, restitution = 0.25): number {
    // 位置の補正
    this.x += nx * depth;
    this.y += ny * depth;
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    // 世界座標の速度
    const vx = c * this.vf - s * this.vr;
    const vy = s * this.vf + c * this.vr;
    // 重心からの接触点ベクトル
    const rx = c * lf - s * lr;
    const ry = s * lf + c * lr;
    const pvx = vx - this.omega * ry;
    const pvy = vy + this.omega * rx;
    const vn = pvx * nx + pvy * ny;
    if (vn >= 0) return 0;
    const rxn = rx * ny - ry * nx;
    const j = (-(1 + restitution) * vn) / (1 / SPEC.mass + (rxn * rxn) / SPEC.yawInertia);
    let nvx = vx + (j * nx) / SPEC.mass;
    let nvy = vy + (j * ny) / SPEC.mass;
    this.omega += (rxn * j) / SPEC.yawInertia;
    // 接線方向のこすれ
    const fr = 0.85;
    const vtn = nvx * nx + nvy * ny;
    nvx = vtn * nx + (nvx - vtn * nx) * fr;
    nvy = vtn * ny + (nvy - vtn * ny) * fr;
    this.vf = c * nvx + s * nvy;
    this.vr = -s * nvx + c * nvy;
    return -vn;
  }
}
