import * as THREE from 'three';
import { Game, type CornerResult, type EndReason, type GameEvent } from './sim/game';
import { SPEC } from './sim/danjiri';
import { SCORE_LABELS, type ScoreKey } from './sim/score';
import { DIFFICULTIES, type Difficulty, type DifficultyId } from './sim/guide';
import { loadModels, PoseCrowd, type Models } from './render/models';
import { buildWorld, type World } from './render/world';
import * as TX from './render/textures';
import { Hayashi } from './audio';
import { Input, type Action } from './input';
import { formatTime, xIntentUrl } from './share';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const lowSpec = isTouch;
if (isTouch) document.body.classList.add('touch');

// ---------- 描画の基本 ----------
const renderer = new THREE.WebGLRenderer({ antialias: !lowSpec, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowSpec ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = lowSpec ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
$('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#c9d6df', 60, lowSpec ? 170 : 230);
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(600, 24, 16),
  new THREE.MeshBasicMaterial({ map: TX.sky(), side: THREE.BackSide, fog: false, depthWrite: false }),
);
scene.add(skyDome);
scene.add(new THREE.HemisphereLight('#e4eeff', '#8a7660', 1.35));
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
sun.castShadow = true;
const SHADOW = lowSpec ? 1024 : 2048;
sun.shadow.mapSize.set(SHADOW, SHADOW);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.5, 1, 0.35).normalize();

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 900);
scene.add(camera);

// ---------- 状態 ----------
let models: Models | null = null;
let world: World | null = null;
let game: Game | null = null;
let paused = false;
let thirdPerson = false;
let wheelTurn = 0;
let shake = 0;
let runPhase = 0;
const DIFF_KEY = 'danjiri-daikukata:difficulty';
let difficulty: Difficulty = DIFFICULTIES.normal;
try {
  const saved = localStorage.getItem(DIFF_KEY) as DifficultyId | null;
  if (saved && saved in DIFFICULTIES) difficulty = DIFFICULTIES[saved];
} catch {
  // 保存できない環境では「ふつう」
}
const newGame = (d: Difficulty) => new Game({ assist: d.leanAssist, steerAssist: d.steerAssist, autoBrake: d.autoBrake, damageScale: d.damageScale });
/** 開発時の検証用: カメラを外から固定する */
let devCam: { pos: number[]; look: number[] } | null = null;

const PULLERS_PER_ROPE = lowSpec ? 40 : 56;
const ROPE_SEGS = 24;
const CREW_REAR = 8;
const CREW_FRONT = 6;

const audio = new Hayashi();
const input = new Input();

// 地車（読み込み後に組み立てる）
const djRoot = new THREE.Group();
const djBody = new THREE.Group();
djRoot.add(djBody);
scene.add(djRoot);
const wheels: THREE.Object3D[] = [];
const rig = new THREE.Group();
const ropeAnchors: THREE.Vector3[] = [];
let partner: THREE.Group | null = null;
let pullers: PoseCrowd | null = null;
let crew: PoseCrowd | null = null;
let ropeMesh: THREE.InstancedMesh | null = null;

// ---------- 大工方の視点（団扇と腕） ----------
const fanMat = new THREE.MeshStandardMaterial({ map: TX.uchiwa('浜'), side: THREE.DoubleSide, roughness: 0.8 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: '#1f3f8a', roughness: 0.9 });
const handMat = new THREE.MeshStandardMaterial({ color: '#c99a76', roughness: 0.7 });
interface Arm {
  fan: THREE.Group;
  sleeve: THREE.Mesh;
  hand: THREE.Mesh;
  side: number;
}
const arms: Arm[] = [-1, 1].map((side) => {
  const fan = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), fanMat);
  face.position.y = 0.13;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.12, 6), new THREE.MeshStandardMaterial({ color: '#e9dcc0' }));
  handle.position.y = 0.04;
  fan.add(face, handle);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1, 8), sleeveMat);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), handMat);
  camera.add(fan, sleeve, hand);
  return { fan, sleeve, hand, side };
});
const UP = new THREE.Vector3(0, 1, 0);
const setArmsVisible = (v: boolean) => {
  for (const a of arms) a.fan.visible = a.sleeve.visible = a.hand.visible = v;
};

function placeArm(a: Arm, x: number, y: number, z: number, rx: number, rz: number) {
  a.fan.position.set(x, y, z);
  a.fan.rotation.set(rx, 0, rz);
  a.hand.position.set(x, y - 0.02, z);
  const shoulder = new THREE.Vector3(0.32 * a.side, -0.62, 0.05);
  const dir = new THREE.Vector3(x, y - 0.03, z).sub(shoulder);
  const len = dir.length();
  a.sleeve.position.copy(shoulder).addScaledVector(dir, 0.5);
  a.sleeve.scale.set(1, len, 1);
  a.sleeve.quaternion.setFromUnitVectors(UP, dir.normalize());
}

// ---------- 組み立て ----------
function assemble(m: Models, g: Game) {
  // 地車: 本体（傾く）と車輪（地面に残る）
  const src = m.danjiri;
  for (const child of [...src.children]) {
    if (child.name.startsWith('wheel_')) {
      djRoot.add(child);
      wheels.push(child);
    } else if (child.name === 'rider_anchor') {
      rig.position.copy(child.position);
    } else if (child.name === 'partner_anchor') {
      partner = new THREE.Group();
      const blue = (m.materials.happi as THREE.MeshStandardMaterial).clone();
      blue.color.set('#1f3f8a');
      for (const p of m.stand) {
        const mesh = new THREE.Mesh(p.geometry, p.material === 'happi' ? blue : m.materials[p.material]);
        mesh.castShadow = true;
        partner.add(mesh);
      }
      const fan = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), fanMat);
      fan.position.set(0.3, 1.85, 0.25);
      fan.name = 'fan';
      partner.add(fan);
      partner.position.copy(child.position);
      djBody.add(partner);
    } else if (child.name.startsWith('rope_')) {
      ropeAnchors.push(child.position.clone());
    } else {
      djBody.add(child);
    }
  }
  djBody.add(rig);

  world = buildWorld(g.course, m, lowSpec);
  scene.add(world.group);

  pullers = new PoseCrowd(m, PULLERS_PER_ROPE * 2, ['#1f3f8a', '#1f3f8a', '#1f3f8a', '#f2efe6', '#b8231d']);
  scene.add(pullers.group);
  crew = new PoseCrowd(m, CREW_REAR + CREW_FRONT, ['#1f3f8a', '#f2efe6']);
  djRoot.add(crew.group);

  const ropeGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 6);
  ropeGeo.translate(0, 0.5, 0);
  ropeGeo.rotateX(Math.PI / 2);
  ropeMesh = new THREE.InstancedMesh(ropeGeo, new THREE.MeshStandardMaterial({ color: '#d8c79a', roughness: 0.95 }), ROPE_SEGS * 2);
  ropeMesh.castShadow = !lowSpec;
  ropeMesh.frustumCulled = false;
  scene.add(ropeMesh);
}

// ---------- 毎フレームの同期 ----------
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
/** 平面上の向き θ（前方 (cosθ, sinθ)）を、+z 正面の人形の rotation.y にする */
const yawFor = (theta: number) => Math.PI / 2 - theta;

function syncScene(dt: number) {
  if (!game || !pullers || !crew || !ropeMesh || !world) return;
  const g = game;
  const d = g.danjiri;

  djRoot.position.set(d.x, 0, d.y);
  djRoot.rotation.y = -d.theta;
  // 片輪浮きは浮かない側の車輪を軸に回す
  const pz = SPEC.halfTrack * (Math.sign(d.roll) || 1);
  const roll = d.roll - d.aRight * 0.006;
  djBody.rotation.set(roll, 0, d.aFwd * 0.004 + g.bump * 0.002);
  djBody.position.set(0, pz * Math.sin(d.roll) + Math.abs(g.bump) * 0.004, pz * (1 - Math.cos(d.roll)));
  wheelTurn += d.vf * dt;
  for (const w of wheels) w.rotation.z = -wheelTurn / 0.43;
  if (partner) {
    const fan = partner.getObjectByName('fan');
    if (fan) fan.rotation.z = Math.sin(g.time * 9) * 0.6 * (0.4 + Math.abs(g.control.steer));
    partner.rotation.y = g.control.steer * 0.6;
  }

  // 曳き手と綱
  runPhase += Math.max(0, d.vf) * dt * 2.2;
  const moving = d.vf > 0.3;
  const ropePts: THREE.Vector3[][] = [[], []];
  pullers.begin();
  for (let k = 0; k < 2; k++) {
    const sgn = k === 0 ? -1 : 1;
    const anchor = ropeAnchors[k] ?? new THREE.Vector3(2.2, 0.82, 0.55 * sgn);
    const ring = d.toWorld(anchor.x, anchor.z);
    ropePts[k].push(new THREE.Vector3(ring.x, anchor.y, ring.y));
    for (let i = 0; i < PULLERS_PER_ROPE; i++) {
      const dist = 3.2 + i * 0.75;
      const s = g.s + SPEC.halfLength + dist;
      const p = g.course.ropeLineAt(s);
      const dir = g.course.pointAt(s);
      const lat = g.lateral * Math.exp(-dist / 7) + sgn * (0.62 + 0.15 * Math.sin(i * 2.3));
      const x = p.x - dir.uy * lat;
      const y = p.y + dir.ux * lat;
      const phase = runPhase / Math.PI + i * 0.37;
      const pose = moving ? Math.floor(((phase % 1) + 1) % 1 * 4) : 4;
      pullers.add(k * PULLERS_PER_ROPE + i, pose, x, 0, y, yawFor(Math.atan2(dir.uy, dir.ux)), 0.1 + g.control.pull * 0.25);
      if (i % 2 === 0 && ropePts[k].length < ROPE_SEGS + 1) ropePts[k].push(new THREE.Vector3(x + sgn * dir.uy * 0.25, 0.95, y - sgn * dir.ux * 0.25));
    }
  }
  pullers.commit();
  let ri = 0;
  for (const pts of ropePts) {
    for (let i = 0; i < ROPE_SEGS; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) {
        ropeMesh.setMatrixAt(ri++, tmpM.makeScale(0, 0, 0));
        continue;
      }
      tmpV.subVectors(b, a);
      const len = tmpV.length();
      tmpQ.setFromUnitVectors(Z, tmpV.normalize());
      tmpS.set(1, 1, len);
      ropeMesh.setMatrixAt(ri++, tmpM.compose(a, tmpQ, tmpS));
    }
  }
  ropeMesh.instanceMatrix.needsUpdate = true;

  // 梃子方（地車と一緒に動く。後梃子は合図で横へ押す）
  const tekoShift = -(d.tekoForce / SPEC.tekoForceMax) * 0.7;
  crew.begin();
  for (let i = 0; i < CREW_REAR; i++) {
    const row = i % 2 === 0 ? -1 : 1;
    const pose = moving ? Math.floor((((runPhase / Math.PI + i * 0.3) % 1) + 1) % 1 * 4) : 4;
    crew.add(i, pose, -3.6 - Math.floor(i / 2) * 0.5, 0, row * 0.45 + tekoShift, Math.PI / 2 + tekoShift * 0.8, 0.3 + Math.abs(tekoShift) * 0.4);
  }
  for (let i = 0; i < CREW_FRONT; i++) {
    const pose = moving ? Math.floor((((runPhase / Math.PI + i * 0.45) % 1) + 1) % 1 * 4) : 4;
    crew.add(CREW_REAR + i, pose, 1.6 - Math.floor(i / 2) * 1.1, 0, i % 2 === 0 ? -1.6 : 1.6, Math.PI / 2, 0.15 + g.control.brake * 0.4);
  }
  crew.commit();

  // 見物人: 近くの人だけ描き、地車が近づくと沸く
  const spots = world.spectatorSpots;
  const far = lowSpec ? 110 : 160;
  world.spectators.begin();
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const dx = sp.x - d.x;
    const dz = sp.z - d.y;
    if (dx * dx + dz * dz > far * far) continue;
    const ds = Math.abs(sp.s - g.s);
    const jump = ds < 40 ? Math.max(0, Math.sin(g.time * 7 + i * 1.3)) * 0.12 * (1 - ds / 40) : 0;
    world.spectators.add(i, 0, sp.x, 0, sp.z, sp.yaw, 0, jump, sp.scale);
  }
  world.spectators.commit();

  sun.position.set(d.x + SUN_DIR.x * 80, SUN_DIR.y * 80, d.y + SUN_DIR.z * 80);
  sun.target.position.set(d.x, 0, d.y);
}

function updateCamera(dt: number) {
  if (!game) return;
  const g = game;
  const d = g.danjiri;
  const r = g.rider;
  shake *= Math.exp(-dt * 6);
  const sx = (Math.random() - 0.5) * shake * 0.12;
  const sy = (Math.random() - 0.5) * shake * 0.12;

  if (thirdPerson) {
    setArmsVisible(false);
    const f = d.forward();
    camera.position.lerp(tmpV.set(d.x - f.x * 10.5, 5.0, d.y - f.y * 10.5), 1 - Math.exp(-dt * 3));
    camera.lookAt(tmpV2.set(d.x + f.x * 6, 2.8, d.y + f.y * 6));
    return;
  }
  setArmsVisible(true);
  djRoot.updateMatrixWorld(true);
  const eye = tmpV.set(r.offFwd * 0.9, 1.55 + r.height + Math.abs(g.bump) * 0.01, r.lat * 0.32 + r.offRight * 0.9);
  rig.localToWorld(eye);
  camera.position.copy(eye);
  camera.position.x += sx;
  camera.position.y += sy;

  const toRope = Math.atan2(g.ropeTarget.y - d.y, g.ropeTarget.x - d.x) - d.theta;
  const lookYaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(toRope), Math.cos(toRope)), -1.1, 1.1) * 0.65 + g.control.steer * 0.12;
  const pitch = -0.17 - r.lon * 0.25 - d.aFwd * 0.006 + g.bump * 0.004;
  const rollCam = -(r.lat * 0.32 + d.roll - d.aRight * 0.006);
  camera.rotation.set(pitch, -d.theta - Math.PI / 2 - lookYaw, rollCam, 'YXZ');

  const t = g.time;
  const steer = g.control.steer;
  for (const a of arms) {
    const active = steer * a.side > 0.05 ? Math.abs(steer) : 0;
    const flap = Math.sin(t * 14 + a.side) * (g.control.pull > 0.9 ? 0.5 : 0.12);
    const up = active * 0.22 + (g.control.brake ? 0.3 : 0);
    placeArm(
      a,
      a.side * (0.34 + active * 0.08),
      -0.36 + up + (r.airborne ? 0.12 : 0),
      -0.62,
      flap * (1 - active) - 0.2,
      a.side * (-0.25 + active * Math.sin(t * 16) * 0.7) + (g.control.brake ? a.side * -0.6 : 0),
    );
  }
}

// ---------- HUD ----------
const el = {
  time: $('h-time'),
  score: $('h-score'),
  streak: $('h-streak'),
  damage: $('h-damage'),
  speed: $('h-speed'),
  rope: $('h-rope'),
  teko: $('h-teko'),
  order: $('h-order'),
  lat: $('h-lat'),
  lean: $('h-lean'),
  lon: $('h-lon'),
  callout: $('callout'),
  popup: $('popup'),
  scorePop: $('score-pop'),
  target: $('h-target'),
  lift: $('lift'),
};
const balanceEl = el.lat.parentElement as HTMLElement;
const minimap = $<HTMLCanvasElement>('minimap');
const mm = minimap.getContext('2d')!;
let popupTimer = 0;
const controlButtons = [...document.querySelectorAll<HTMLButtonElement>('#controls button')];

function popup(big: string, sub = '', bad = false, dur = 2.2) {
  el.popup.innerHTML = '';
  const b = document.createElement('div');
  b.className = 'big';
  b.textContent = big;
  el.popup.append(b);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'sub';
    s.textContent = sub;
    el.popup.append(s);
  }
  el.popup.className = `show${bad ? ' bad' : ''}`;
  popupTimer = dur;
}

/** 左上に加点・減点を流す */
function scorePop(label: string, pts: number) {
  if (!pts) return;
  const s = document.createElement('span');
  s.className = pts > 0 ? 'plus' : 'minus';
  s.textContent = `${label} ${pts > 0 ? '+' : ''}${pts}`;
  el.scorePop.append(s);
  window.setTimeout(() => s.remove(), 1700);
  while (el.scorePop.childElementCount > 6) el.scorePop.firstElementChild?.remove();
}

function updateHud(dt: number) {
  if (!game) return;
  const g = game;
  const d = g.danjiri;
  el.time.textContent = g.time.toFixed(1);
  el.score.textContent = g.score.toLocaleString('ja-JP');
  el.streak.textContent = g.streak > 1 ? `${g.streak}（×${Math.min(1.5, 1 + 0.1 * g.streak).toFixed(1)}）` : String(g.streak);
  el.damage.style.width = `${Math.min(100, g.damage)}%`;
  el.speed.textContent = Math.max(0, g.kmh).toFixed(0);
  const gd = g.guide;
  el.speed.className = gd.speed === 'free' || g.ended ? '' : gd.speed;
  el.target.textContent = gd.speed === 'free' || g.ended ? '' : `目安 ${Math.round(gd.allowed)}`;
  el.rope.style.width = `${Math.min(100, (Math.max(0, d.ropeForce) / SPEC.ropeForceMax) * 100)}%`;
  const tk = d.tekoForce / SPEC.tekoForceMax;
  el.teko.style.left = tk < 0 ? `${50 + tk * 50}%` : '50%';
  el.teko.style.width = `${Math.abs(tk) * 50}%`;
  el.order.textContent = g.control.brake ? '止め！（前梃子）' : g.control.pull > 0.9 ? '曳け！（ソーリャ）' : '流せ';
  el.lat.style.left = `${50 + THREE.MathUtils.clamp(g.rider.lat, -1, 1) * 50}%`;
  el.lon.style.left = `${50 + THREE.MathUtils.clamp(g.rider.lon, -1, 1) * 50}%`;
  const lean = g.appliedLean;
  el.lean.style.left = lean < 0 ? `${50 + lean * 50}%` : '50%';
  el.lean.style.width = `${Math.abs(lean) * 50}%`;
  balanceEl.classList.toggle('danger', g.inDanger);
  el.lift.classList.toggle('on', d.roll !== 0 && !d.overturned);

  const c = g.upcomingCorner;
  if (c && !g.ended) {
    const dist = c.s - g.s;
    const dirTxt = c.dir > 0 ? '右 ▶' : '◀ 左';
    if (gd.cue === 'now') {
      el.callout.textContent = c.dir > 0 ? '団扇！ 右へ ▶' : '◀ 左へ 団扇！';
      el.callout.className = 'hot cue';
    } else if (gd.cue === 'back') {
      el.callout.textContent = c.dir > 0 ? '◀ 戻せ！' : '戻せ！ ▶';
      el.callout.className = 'hot cue back';
    } else if (dist < -2) {
      el.callout.textContent = `やりまわし！ ${c.name}`;
      el.callout.className = 'hot';
    } else if (dist < 90) {
      el.callout.textContent = `${dirTxt} ・ ${c.name} ・ あと ${Math.max(0, dist).toFixed(0)}m`;
      el.callout.className = dist < 25 ? 'hot' : '';
    } else el.callout.textContent = '';
  } else if (!g.ended && g.course.total - g.s < 90) {
    el.callout.textContent = `宮入りまで ${(g.course.total - g.s).toFixed(0)}m`;
    el.callout.className = '';
  } else el.callout.textContent = '';

  popupTimer -= dt;
  if (popupTimer <= 0) el.popup.classList.remove('show');
  drawMinimap();
}

function updateControls() {
  // 合図のタイミングでは、振るべき向きの団扇ボタンを光らせる
  let cueBtn: Action | null = null;
  if (game && !game.ended && $('title').hidden) {
    const gd = game.guide;
    const dir = gd.corner?.dir ?? 0;
    const want = gd.cue === 'now' ? dir : gd.cue === 'back' ? -dir : 0;
    if (want) cueBtn = want > 0 ? 'steerR' : 'steerL';
  }
  for (const b of controlButtons) {
    const a = b.dataset.a as Action;
    b.classList.toggle('on', input.isActive(a));
    b.classList.toggle('cue', a === cueBtn);
  }
}

let mmBounds: { minX: number; minY: number; scale: number } | null = null;
function drawMinimap() {
  if (!game) return;
  const c = game.course;
  const W = minimap.width;
  if (!mmBounds) {
    const xs = c.def.points.map((p) => p.x);
    const ys = c.def.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
    mmBounds = { minX, minY, scale: (W - 30) / span };
  }
  const b = mmBounds;
  const P = (x: number, y: number): [number, number] => [15 + (x - b.minX) * b.scale, 15 + (y - b.minY) * b.scale];
  mm.clearRect(0, 0, W, W);
  mm.lineCap = 'square';
  mm.strokeStyle = 'rgba(247,241,227,0.35)';
  mm.lineWidth = 7;
  mm.beginPath();
  c.def.points.forEach((p, i) => (i ? mm.lineTo(...P(p.x, p.y)) : mm.moveTo(...P(p.x, p.y))));
  mm.stroke();
  mm.strokeStyle = '#e2b65a';
  mm.lineWidth = 3;
  mm.beginPath();
  for (let s = 0; s <= game.s; s += 4) {
    const p = c.pointAt(s);
    if (s === 0) mm.moveTo(...P(p.x, p.y));
    else mm.lineTo(...P(p.x, p.y));
  }
  mm.stroke();
  for (const k of c.corners) {
    mm.fillStyle = 'rgba(210,58,36,0.9)';
    mm.beginPath();
    mm.arc(...P(k.at.x, k.at.y), 3, 0, Math.PI * 2);
    mm.fill();
  }
  const end = c.def.points[c.def.points.length - 1];
  mm.fillStyle = '#d23a24';
  mm.fillRect(...P(end.x, end.y), 6, 6);
  const d = game.danjiri;
  const [x, y] = P(d.x, d.y);
  mm.save();
  mm.translate(x, y);
  mm.rotate(d.theta);
  mm.fillStyle = '#fff';
  mm.beginPath();
  mm.moveTo(7, 0);
  mm.lineTo(-5, 4.5);
  mm.lineTo(-5, -4.5);
  mm.closePath();
  mm.fill();
  mm.restore();
}

// ---------- 出来事 ----------
function handleEvents(events: GameEvent[]) {
  for (const e of events) {
    switch (e.type) {
      case 'hit':
        shake = Math.min(1.5, shake + e.speed * 0.35);
        audio.hit(e.speed);
        scorePop(e.kind === 'pole' ? (e.padded ? '布団に接触' : '電柱に接触') : '家に接触', e.penalty);
        if (e.speed > 1.5) popup(e.kind === 'pole' ? (e.padded ? '布団に当てた' : '電柱に当たった！') : '家に当てた！', `${(e.speed * 3.6).toFixed(0)} km/h で接触`, true, 1.4);
        break;
      case 'slam':
        shake = Math.min(1.5, shake + e.strength * 0.6);
        audio.hit(e.strength * 2);
        scorePop('ドスン', e.penalty);
        popup('ドスン！', '浮いた車輪が落ちた', true, 1.2);
        break;
      case 'corner':
        showCorner(e.result);
        break;
      case 'jump':
        audio.cheer(0.2);
        break;
      case 'land':
        if (e.offset > 0.45) popup('危ない！', `着地が ${(e.offset * 100).toFixed(0)}cm ずれた`, true, 1.2);
        break;
      case 'end':
        audio.fadeOut(3);
        window.setTimeout(() => showResult(e.reason), e.reason === 'goal' ? 1800 : 1400);
        if (e.reason === 'goal') {
          popup('宮入り！', '見事に曳き切った', false, 2);
          audio.cheer(1);
        } else if (e.reason === 'fall') popup('転落！', game?.rider.fallReason ?? '', true, 2);
        else if (e.reason === 'overturn') popup('横転！', '地車が横倒しになった', true, 2);
        else popup('曳行中止', '地車が傷みすぎた', true, 2);
        break;
    }
  }
}

function showCorner(r: CornerResult) {
  const bad = r.grade === 'あかん' || r.grade === 'まだまだ';
  for (const [k, v] of Object.entries(r.items)) scorePop(SCORE_LABELS[k as ScoreKey], v ?? 0);
  const extra = [r.jumps ? `跳び ${r.jumps}` : '', r.hits ? `接触 ${r.hits}` : '無傷', r.multiplier > 1 ? `×${r.multiplier.toFixed(1)}` : ''].filter(Boolean).join(' ・ ');
  popup(r.grade, `${r.name} ・ 最低 ${r.minKmh.toFixed(0)}km/h ・ ${extra} ・ +${r.total}`, bad, 2.6);
  audio.cheer(bad ? 0.2 : 0.7);
}

const REASON: Record<EndReason, [string, string]> = {
  goal: ['宮入り', '町を曳き切って、宮へ入った。'],
  fall: ['転落', ''],
  overturn: ['横転', '速すぎるやりまわしで、地車が横倒しになった。'],
  wrecked: ['曳行中止', '家や電柱に当てすぎて、地車が傷んだ。'],
};

function cell(tr: HTMLTableRowElement, text: string, cls = '', tag: 'td' | 'th' = 'td') {
  const c = document.createElement(tag);
  c.textContent = text;
  if (cls) c.className = cls;
  tr.append(c);
}

function showResult(reason: EndReason) {
  if (!game) return;
  const g = game;
  const rank = g.rank;
  const [title, text] = REASON[reason];
  $('r-kicker').textContent = `${reason === 'goal' ? '宮入り' : '結果'} ・ 難易度「${difficulty.name}」`;
  const rankEl = $('r-rank');
  rankEl.textContent = rank.letter;
  rankEl.className = `rank ${rank.letter}`;
  $('r-title').textContent = reason === 'goal' ? `総合ランク「${rank.name}」` : title;
  $('r-reason').textContent = reason === 'fall' ? `${g.rider.fallReason}。` : text;
  $('r-score').textContent = g.score.toLocaleString('ja-JP');
  $('r-time').textContent = formatTime(g.time);

  const bd = $<HTMLTableElement>('r-breakdown');
  bd.replaceChildren();
  for (const l of g.book.lines()) {
    const tr = bd.insertRow();
    cell(tr, l.label, '', 'th');
    cell(tr, `${l.pts > 0 ? '+' : ''}${l.pts.toLocaleString('ja-JP')}`, `pts ${l.pts > 0 ? 'plus' : 'minus'}`);
  }
  const tb = $<HTMLTableElement>('r-table');
  tb.replaceChildren();
  for (const r of g.results) {
    const tr = tb.insertRow();
    cell(tr, r.name, '', 'th');
    cell(tr, r.dir > 0 ? '右' : '左');
    cell(tr, `最低 ${r.minKmh.toFixed(0)} km/h`);
    cell(tr, `${r.hits ? `接触 ${r.hits}` : '無傷'}${r.jumps ? `・跳び ${r.jumps}` : ''}`);
    cell(tr, r.grade, 'grade');
    cell(tr, `+${r.total}`, 'pts');
  }
  if (!g.results.length) cell(tb.insertRow(), 'やりまわしの記録なし');

  const share = $<HTMLAnchorElement>('share-x');
  share.href = xIntentUrl({
    difficulty: difficulty.name,
    time: g.time,
    score: g.score,
    rank,
    failure:
      reason === 'goal'
        ? undefined
        : { kind: reason, detail: reason === 'fall' ? g.rider.fallReason : '', corners: g.results.length, totalCorners: g.course.corners.length },
  });

  $('hud').hidden = true;
  $('controls').hidden = true;
  $('result').hidden = false;
}

// ---------- 画面の切り替え ----------
function start() {
  if (!models) return;
  const checked = document.querySelector<HTMLInputElement>('input[name="difficulty"]:checked');
  if (checked && checked.value in DIFFICULTIES) difficulty = DIFFICULTIES[checked.value as DifficultyId];
  try {
    localStorage.setItem(DIFF_KEY, difficulty.id);
  } catch {
    // 保存できなくても遊べる
  }
  game = newGame(difficulty);
  wheelTurn = 0;
  shake = 0;
  mmBounds = null;
  el.scorePop.replaceChildren();
  $('title').hidden = true;
  $('result').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  $('controls').hidden = false;
  paused = false;
  audio.start();
  popup('ソーリャ！', isTouch ? '「曳け」で曳き出す' : 'W / ↑ で曳き出す', false, 2.4);
}

function setPaused(p: boolean) {
  if (!game || game.ended || !$('title').hidden) return;
  paused = p;
  $('pause').hidden = !p;
  if (p) audio.pause();
  else audio.resume();
}

$('start').addEventListener('click', start);
$('retry').addEventListener('click', start);
$('to-title').addEventListener('click', () => {
  $('result').hidden = true;
  $('title').hidden = false;
});
$('resume').addEventListener('click', () => setPaused(false));
$('pause-btn').addEventListener('click', () => setPaused(true));
$('quit').addEventListener('click', () => {
  audio.pause();
  paused = false;
  $('pause').hidden = true;
  $('hud').hidden = true;
  $('controls').hidden = true;
  $('title').hidden = false;
});
const muteBtn = $<HTMLButtonElement>('mute');
const showMute = () => {
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', audio.muted ? '音を出す' : '音を消す');
};
const toggleMute = () => {
  audio.setMuted(!audio.muted);
  showMute();
};
showMute();
muteBtn.addEventListener('click', toggleMute);
input.onToggleMute = toggleMute;
input.onToggleCamera = () => (thirdPerson = !thirdPerson);
input.onPause = () => setPaused(!paused);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.pause();
  else if (game && !game.ended && !paused && $('title').hidden) audio.resume();
});

// 画面端のボタン（タッチ・マウス。マルチタッチ可）
for (const b of controlButtons) {
  const a = b.dataset.a as Action;
  const set = (on: boolean) => input.setButton(a, on);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    set(true);
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      // 取り込めなくても押下は効かせる
    }
  });
  b.addEventListener('pointerup', () => set(false));
  b.addEventListener('pointercancel', () => set(false));
  b.addEventListener('lostpointercapture', () => set(false));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- ループ ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 88 : 72;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const startBtn = $<HTMLButtonElement>('start');
const savedRadio = document.querySelector<HTMLInputElement>(`input[name="difficulty"][value="${difficulty.id}"]`);
if (savedRadio) savedRadio.checked = true;
loadModels(lowSpec, (r) => (startBtn.textContent = `読み込み中… ${Math.round(r * 100)}%`))
  .then((m) => {
    models = m;
    // タイトル画面の背景として、止まった地車を見せる
    game = newGame(difficulty);
    assemble(m, game);
    syncScene(0);
    startBtn.disabled = false;
    startBtn.textContent = 'スタート';
  })
  .catch((err: unknown) => {
    console.error(err);
    startBtn.textContent = 'モデルを読み込めませんでした';
  });

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  advance(Math.min(clock.getDelta(), 0.05));
}

function advance(dt: number) {
  const playing = game && models && !paused && $('title').hidden && $('result').hidden;
  const inp = input.read(dt);
  if (game && playing && !game.ended) {
    game.update(dt, inp);
    handleEvents(game.drainEvents());
    audio.speedKmh = game.kmh;
    audio.slip = game.danjiri.slip;
  } else if (game && playing) {
    game.update(dt, inp);
    handleEvents(game.drainEvents());
  } else {
    audio.speedKmh = 0;
  }
  audio.update();
  const t0 = performance.now();
  if (game && models) {
    syncScene(playing ? dt : 0);
    updateCamera(dt);
    if (playing) updateHud(dt);
    updateControls();
  }
  if (!$('title').hidden && game) {
    // タイトルでは地車のまわりをゆっくり回る
    const t = performance.now() / 1000;
    const d = game.danjiri;
    setArmsVisible(false);
    camera.position.set(d.x + Math.cos(t * 0.15) * 9, 3.8, d.y + Math.sin(t * 0.15) * 9);
    camera.lookAt(d.x, 2.4, d.y);
  }
  if (devCam) {
    setArmsVisible(false);
    camera.position.fromArray(devCam.pos);
    camera.lookAt(new THREE.Vector3().fromArray(devCam.look));
  }
  skyDome.position.copy(camera.position);
  const t1 = performance.now();
  renderer.render(scene, camera);
  prof.sync += t1 - t0;
  prof.render += performance.now() - t1;
  prof.n++;
}
const prof = { sync: 0, render: 0, n: 0 };
frame();

// 開発時だけ: 画面が隠れていても検証できるよう、手動でフレームを進める
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__dj = {
    advance: (sec: number) => {
      for (let t = 0; t < sec; t += 1 / 60) advance(1 / 60);
    },
    game: () => game,
    audioState: () => audio.state,
    scene,
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    profile: () => {
      const r = { syncMs: prof.sync / prof.n, renderMs: prof.render / prof.n };
      prof.sync = prof.render = prof.n = 0;
      return r;
    },
    view: (fwd: number | null, right = 0, up = 0, lookUp = 2.5) => {
      if (fwd === null || !game) {
        devCam = null;
        return;
      }
      const d = game.danjiri;
      const p = d.toWorld(fwd, right);
      devCam = { pos: [p.x, up, p.y], look: [d.x, lookUp, d.y] };
      advance(0);
    },
  };
}
