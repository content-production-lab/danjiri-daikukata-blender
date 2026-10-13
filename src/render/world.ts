// 町並み（家・電柱・提灯・見物人・宮）を、Blender の部品を並べて作る。

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Course } from '../sim/course';
import { mulberry32 } from '../sim/game';
import * as TX from './textures';
import { InstancedParts, PoseCrowd, type Models } from './models';

const SETBACK = 1.7; // 道の端から家の正面まで（見物人が立つ）
/** Blender で作った町家の名目寸法（間口・高さ・奥行） */
const HOUSE_W = 7;
const HOUSE_H = 7;
const HOUSE_D = 11;

export interface World {
  course: Course;
  group: THREE.Group;
  spectators: PoseCrowd;
  spectatorSpots: { x: number; z: number; yaw: number; s: number; scale: number }[];
  dispose(): void;
}

const Y = new THREE.Vector3(0, 1, 0);

export function buildWorld(course: Course, models: Models, lowSpec: boolean): World {
  const group = new THREE.Group();
  const rnd = mulberry32(7);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  // 地面
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ map: TX.asphalt(), roughness: 0.95, color: '#9a9a9a' }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // 道の端の白線と、見物人との境の綱（角で脇道をふさがない区間だけ）
  const lineMat = new THREE.MeshBasicMaterial({ color: '#d8d4c8' });
  const fenceMat = new THREE.MeshStandardMaterial({ color: '#e8e0c8', roughness: 0.9 });
  const posts: THREE.Vector3[] = [];
  for (const sg of course.segs) {
    for (const side of [-1, 1]) {
      const runs: [number, number][] = [];
      let runStart: number | null = null;
      for (let t = -sg.hw; t <= sg.len + sg.hw + 0.01; t += 0.5) {
        const off = sg.hw + 0.3;
        const edge = !course.inside({ x: sg.a.x + sg.ux * t - sg.uy * off * side, y: sg.a.y + sg.uy * t + sg.ux * off * side });
        if (edge && runStart === null) runStart = t;
        if ((!edge || t + 0.5 > sg.len + sg.hw + 0.01) && runStart !== null) {
          runs.push([runStart, edge ? t : t - 0.5]);
          runStart = null;
        }
      }
      for (const [t0, t1] of runs) {
        const len = t1 - t0;
        if (len < 0.5) continue;
        const tm = (t0 + t1) / 2;
        const at = (off: number, t = tm) => new THREE.Vector3(sg.a.x + sg.ux * t - sg.uy * off * side, 0, sg.a.y + sg.uy * t + sg.ux * off * side);
        const yaw = -Math.atan2(sg.uy, sg.ux);
        const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.15), lineMat);
        line.rotation.set(-Math.PI / 2, 0, yaw);
        line.position.copy(at(sg.hw)).setY(0.012);
        group.add(line);
        const fence = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5), fenceMat);
        fence.rotation.order = 'YXZ';
        fence.rotation.set(0, yaw, Math.PI / 2);
        fence.position.copy(at(sg.hw + 0.35)).setY(0.85);
        group.add(fence);
        for (let t = t0; t <= t1; t += 4) posts.push(at(sg.hw + 0.35, t));
      }
    }
  }
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), fenceMat, posts.length);
  posts.forEach((p, i) => postMesh.setMatrixAt(i, m.makeTranslation(p.x, 0.47, p.z)));
  group.add(postMesh);

  // 家並み
  const houses: { kind: string; x: number; z: number; w: number; d: number; h: number; yaw: number; chunk: number }[] = [];
  const kinds = ['machiya_a', 'machiya_b', 'machiya_c'];
  const footprintOk = (cx: number, cy: number, ux: number, uy: number, w: number, d: number) => {
    for (const [a, b] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [-w / 2, d / 2],
      [w / 2, d / 2],
      [0, -d / 2],
    ]) {
      if (course.inside({ x: cx + ux * a - uy * b, y: cy + uy * a + ux * b }, -SETBACK + 0.05)) return false;
    }
    return true;
  };
  for (const [si, sg] of course.segs.entries()) {
    for (const side of [-1, 1]) {
      let t = -sg.hw - 30;
      while (t < sg.len + sg.hw + 30) {
        const w = 5 + rnd() * 4.5;
        const d = 9 + rnd() * 4;
        const off = sg.hw + SETBACK + d / 2;
        const cx = sg.a.x + sg.ux * (t + w / 2) - sg.uy * off * side;
        const cy = sg.a.y + sg.uy * (t + w / 2) + sg.ux * off * side;
        if (footprintOk(cx, cy, sg.ux, sg.uy, w - 0.1, d)) {
          houses.push({ kind: kinds[Math.floor(rnd() * 3)], x: cx, z: cy, w: w - 0.15, d, h: 6.2 + rnd() * 1.8, yaw: -Math.atan2(sg.uy, sg.ux), chunk: si * 2 + (side > 0 ? 1 : 0) });
        }
        t += w;
      }
    }
  }
  // 出発点の後ろは家でふさぐ
  {
    const sg = course.segs[0];
    const d = 10;
    const back = sg.hw + SETBACK + d / 2;
    for (let n = -sg.hw - 12; n < sg.hw + 12; ) {
      const w = 5 + rnd() * 3;
      const off = n + w / 2;
      houses.push({ kind: kinds[Math.floor(rnd() * 3)], x: sg.a.x - sg.ux * back - sg.uy * off, z: sg.a.y - sg.uy * back + sg.ux * off, w: w - 0.15, d, h: 6.5, yaw: -Math.atan2(sg.ux, -sg.uy), chunk: -1 });
      n += w;
    }
  }
  // 家は通りの片側ごとに1つのメッシュへまとめる（見えない通りは丸ごと描かない）
  const chunks = new Map<number, Map<string, THREE.BufferGeometry[]>>();
  const tint = new THREE.Color();
  for (const h of houses) {
    q.setFromAxisAngle(Y, h.yaw);
    m.compose(pos.set(h.x, 0, h.z), q, scl.set(h.w / HOUSE_W, h.h / HOUSE_H, h.d / HOUSE_D));
    const byMat = chunks.get(h.chunk) ?? new Map<string, THREE.BufferGeometry[]>();
    chunks.set(h.chunk, byMat);
    tint.setHSL(0.08, 0.12, 0.82 + rnd() * 0.18);
    for (const part of models.town[h.kind]) {
      const g = part.geometry.clone().applyMatrix4(m);
      // 家ごとに壁の色を少し変える（頂点色）
      const n = g.getAttribute('position').count;
      const colors = new Float32Array(n * 3);
      const c = part.material === 'facade' || part.material === 'plaster' ? tint : new THREE.Color(1, 1, 1);
      for (let k = 0; k < n; k++) c.toArray(colors, k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const list = byMat.get(part.material) ?? [];
      list.push(g);
      byMat.set(part.material, list);
    }
  }
  const vcMats = new Map<string, THREE.Material>();
  for (const byMat of chunks.values()) {
    for (const [name, geos] of byMat) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      for (const g of geos) g.dispose();
      merged.computeBoundingSphere();
      let mat = vcMats.get(name);
      if (!mat) {
        mat = (models.materials[name] as THREE.MeshStandardMaterial).clone();
        (mat as THREE.MeshStandardMaterial).vertexColors = true;
        vcMats.set(name, mat);
      }
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !lowSpec;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // 電柱と電線
  const plain = course.poles.filter((p) => !p.padded);
  const padded = course.poles.filter((p) => p.padded);
  const poleYaw = (p: { x: number; y: number }) => {
    const pr = course.project(p, 0);
    const sg = course.segs[pr.seg];
    return -Math.atan2(sg.uy, sg.ux);
  };
  for (const [list, name] of [
    [plain, 'pole'],
    [padded, 'pole_padded'],
  ] as const) {
    const inst = new InstancedParts(models.town[name], models.materials, list.length, { castShadow: true });
    list.forEach((p, i) => {
      q.setFromAxisAngle(Y, poleYaw(p) + Math.PI / 2);
      inst.setMatrix(i, m.compose(pos.set(p.x, 0, p.y), q, scl.set(1, 1, 1)));
    });
    inst.commit();
    group.add(inst.group);
  }
  const wirePts: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < plain.length; i++) {
    const a = plain[i];
    const b = plain[i + 1];
    if (a.line !== b.line) continue;
    for (const dy of [0.05, -0.45]) {
      for (let k = 0; k < 8; k++) {
        const pa = new THREE.Vector3(a.x, 9.25 + dy, a.y).lerp(new THREE.Vector3(b.x, 9.25 + dy, b.y), k / 8);
        pa.y -= Math.sin((k / 8) * Math.PI) * 0.6;
        const pb = new THREE.Vector3(a.x, 9.25 + dy, a.y).lerp(new THREE.Vector3(b.x, 9.25 + dy, b.y), (k + 1) / 8);
        pb.y -= Math.sin(((k + 1) / 8) * Math.PI) * 0.6;
        wirePts.push(pa, pb);
      }
    }
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: '#1a1a1a' })));

  // 通りを横切る提灯の列
  const lanSpots: THREE.Vector3[] = [];
  for (const sg of course.segs) {
    for (let t = 18; t < sg.len - 12; t += 22) {
      const span = sg.hw + SETBACK;
      for (let k = -4; k <= 4; k++) {
        const a = k / 4.5;
        lanSpots.push(new THREE.Vector3(sg.a.x + sg.ux * t - sg.uy * span * a, 7.7 - (1 - a * a) * 0.6, sg.a.y + sg.uy * t + sg.ux * span * a));
      }
    }
  }
  const lan = new InstancedParts(models.town.street_lantern, models.materials, lanSpots.length, { castShadow: false });
  lanSpots.forEach((p, i) => lan.setMatrix(i, m.makeTranslation(p.x, p.y, p.z)));
  lan.commit();
  group.add(lan.group);

  // 見物人（家の前に並ぶ。スマホでは間引く）
  const spots: World['spectatorSpots'] = [];
  const step = lowSpec ? 1.6 : 0.8;
  for (const sg of course.segs) {
    for (const side of [-1, 1]) {
      for (let t = -sg.hw + 1; t < sg.len + sg.hw; t += step + rnd() * 0.9) {
        const off = sg.hw + 0.5 + rnd() * (SETBACK - 0.7);
        const x = sg.a.x + sg.ux * t - sg.uy * off * side;
        const y = sg.a.y + sg.uy * t + sg.ux * off * side;
        if (course.inside({ x, y }, -0.25)) continue;
        spots.push({ x, z: y, yaw: Math.atan2(sg.uy * side, -sg.ux * side), s: sg.s0 + Math.max(0, Math.min(sg.len, t)), scale: 0.92 + rnd() * 0.16 });
      }
    }
  }
  const SPECTATOR_COLORS = ['#3b4a63', '#a33a2f', '#e1dccf', '#5e6b3a', '#2d2d33', '#c7a35b', '#7a4f8c', '#1f3f8a'];
  const spectators = new PoseCrowd(models, spots.length, SPECTATOR_COLORS, false, true);
  spectators.begin();
  spots.forEach((p, i) => spectators.add(i, 0, p.x, 0, p.z, p.yaw, 0, 0, p.scale));
  spectators.commit();
  group.add(spectators.group);

  // 宮（ゴール）
  const last = course.segs[course.segs.length - 1];
  const yaw = -Math.atan2(last.uy, last.ux);
  const torii = models.torii.clone();
  torii.position.set(last.b.x, 0, last.b.y);
  torii.rotation.y = yaw;
  const shrine = models.shrine.clone();
  shrine.position.set(last.b.x + last.ux * 26, 0, last.b.y + last.uy * 26);
  shrine.rotation.y = yaw;
  group.add(torii, shrine);

  // コースを切り替えても、Blender部品の共有ジオメトリ・材質は破棄しない。
  const sharedGeometry = new Set([
    ...Object.values(models.town).flat(), ...models.poses.flat(), ...models.stand, ...models.standLo,
  ].map((part) => part.geometry));
  for (const model of [models.torii, models.shrine]) model.traverse((obj) => {
    if (obj instanceof THREE.Mesh) sharedGeometry.add(obj.geometry);
  });
  const sharedMaterials = new Set(Object.values(models.materials));
  let disposed = false;
  return {
    course, group, spectators, spectatorSpots: spots,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      const geometry = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments)) return;
        if (!sharedGeometry.has(obj.geometry)) geometry.add(obj.geometry);
        for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (!sharedMaterials.has(mat)) materials.add(mat);
        }
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
      });
      geometry.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      ground.material.map?.dispose();
      group.clear();
    },
  };
}
