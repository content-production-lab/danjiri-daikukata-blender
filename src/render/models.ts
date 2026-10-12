// Blender で作った .glb を読み込み、材質を名前で three.js のテクスチャ付き材質に置き換える。

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as TX from './textures';

const BASE = import.meta.env.BASE_URL;

/** 1つの姿勢・部品を構成するジオメトリと材質名 */
export interface Part {
  geometry: THREE.BufferGeometry;
  material: string;
}

export interface Models {
  danjiri: THREE.Group;
  /** 走りの4姿勢と立ち姿勢 */
  poses: Part[][];
  stand: Part[];
  /** 遠景（見物人）用の簡易な立ち姿勢 */
  standLo: Part[];
  town: Record<string, Part[]>;
  torii: THREE.Object3D;
  shrine: THREE.Object3D;
  materials: Record<string, THREE.Material>;
}

function tex(t: THREE.Texture, repeat: number): THREE.Texture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** 材質名 → three.js の材質 */
export function buildMaterials(lowSpec: boolean): Record<string, THREE.Material> {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const wood = TX.keyaki();
  const dark = TX.keyaki(true);
  const m: Record<string, THREE.Material> = {
    wood: std({ map: tex(wood, 0.6), roughness: 0.6 }),
    wood_dark: std({ map: tex(dark.clone(), 0.6), roughness: 0.7 }),
    // 彫りの凹みの陰影は Blender で頂点色に焼き込んである
    carving: std({ map: tex(wood.clone(), 1.5), color: '#f6dcb4', roughness: 0.55, vertexColors: true }),
    roof_wood: std({ map: tex(wood.clone(), 0.45), color: '#d8b48a', roughness: 0.5, side: THREE.DoubleSide }),
    brass: std({ color: '#c9a44a', roughness: 0.3, metalness: 0.85 }),
    iron: std({ color: '#2a2622', roughness: 0.55, metalness: 0.5 }),
    cloth_red: std({ color: '#b8231d', roughness: 0.9 }),
    lantern: std({ map: TX.lantern(), emissive: '#ff6a2a', emissiveIntensity: 0.3, roughness: 0.6 }),
    drum_skin: std({ color: '#e7dcc4', roughness: 0.6 }),
    happi: std({ color: '#ffffff', roughness: 0.85 }),
    skin: std({ color: '#c99a76', roughness: 0.7 }),
    pants: std({ color: '#23232b', roughness: 0.9 }),
    tabi: std({ color: '#141414', roughness: 0.8 }),
    band: std({ color: '#f4f1ea', roughness: 0.8 }),
    hair: std({ color: '#1a1714', roughness: 0.7 }),
    facade: std({ map: tex(TX.plaster(), 0.25), color: '#efe8da', roughness: 0.9 }),
    plaster: std({ map: tex(TX.plaster(), 0.25), color: '#e9e1d0', roughness: 0.9 }),
    wall_wood: std({ map: tex(dark.clone(), 0.5), color: '#9a7a62', roughness: 0.85 }),
    tile: std({ map: tex(TX.roofTiles(), 0.45), roughness: 0.6, side: THREE.DoubleSide }),
    concrete: std({ color: '#8f8b84', roughness: 0.8 }),
    pad: std({ color: '#d14b3c', roughness: 0.95 }),
    torii_red: std({ color: '#c8361f', roughness: 0.6 }),
    torii_black: std({ color: '#1d1d1d', roughness: 0.7 }),
    shrine_wood: std({ map: tex(dark.clone(), 0.4), roughness: 0.8 }),
    shrine_roof: std({ color: '#6f8a6a', roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }),
  };
  if (lowSpec) for (const v of Object.values(m)) (v as THREE.MeshStandardMaterial).envMapIntensity = 0.8;
  return m;
}

function remap(root: THREE.Object3D, mats: Record<string, THREE.Material>, shadows = true): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.material = mats[name] ?? mesh.material;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
  });
}

/** オブジェクト以下のメッシュを、ワールド変換を焼き込んだ部品に分ける */
function parts(root: THREE.Object3D): Part[] {
  root.updateMatrixWorld(true);
  const out: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    out.push({ geometry: g, material: (mesh.material as THREE.Material).name });
  });
  return out;
}

export async function loadModels(lowSpec: boolean, onProgress?: (ratio: number) => void): Promise<Models> {
  const loader = new GLTFLoader();
  const files = ['danjiri.glb', 'people.glb', 'town.glb'];
  const done = [0, 0, 0];
  const load = (f: string, i: number) =>
    loader.loadAsync(`${BASE}models/${f}`, (e) => {
      if (e.total) done[i] = e.loaded / e.total;
      onProgress?.(done.reduce((a, b) => a + b, 0) / files.length);
    });
  const [dj, people, town] = await Promise.all(files.map(load));
  const materials = buildMaterials(lowSpec);

  remap(dj.scene, materials);
  const byName = (g: { scene: THREE.Object3D }, name: string) => {
    const o = g.scene.getObjectByName(name);
    if (!o) throw new Error(`モデルに ${name} がありません`);
    return o;
  };
  const poses = [0, 1, 2, 3].map((k) => parts(byName(people, `run${k}`)));
  const stand = parts(byName(people, 'stand'));
  const standLo = parts(byName(people, 'stand_lo'));
  const townParts: Record<string, Part[]> = {};
  for (const n of ['machiya_a', 'machiya_b', 'machiya_c', 'pole', 'pole_padded', 'street_lantern']) townParts[n] = parts(byName(town, n));
  const torii = byName(town, 'torii');
  const shrine = byName(town, 'shrine');
  remap(torii, materials);
  remap(shrine, materials);
  torii.removeFromParent();
  shrine.removeFromParent();
  return { danjiri: dj.scene, poses, stand, standLo, town: townParts, torii, shrine, materials };
}

/** 部品の集まりを InstancedMesh の組にする */
export class InstancedParts {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[];

  constructor(ps: Part[], mats: Record<string, THREE.Material>, count: number, opts: { castShadow?: boolean; colorPart?: string } = {}) {
    this.meshes = ps.map((p) => {
      const mesh = new THREE.InstancedMesh(p.geometry, mats[p.material], count);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = p.material;
      this.group.add(mesh);
      return mesh;
    });
  }

  setMatrix(i: number, m: THREE.Matrix4): void {
    for (const mesh of this.meshes) mesh.setMatrixAt(i, m);
  }

  /** 指定した材質の部品だけ色を変える（法被など） */
  setColor(i: number, part: string, c: THREE.Color): void {
    for (const mesh of this.meshes) if (mesh.name === part) mesh.setColorAt(i, c);
  }

  commit(): void {
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/**
 * 姿勢を切り替えて走る群衆。0〜3 が走り、4 が立ち。
 * 毎フレーム begin() → add() → commit()。各姿勢の InstancedMesh には、その姿勢の人だけを詰めて描く。
 */
export class PoseCrowd {
  readonly group = new THREE.Group();
  private sets: InstancedParts[];
  private counts: number[];
  private colors: THREE.Color[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  /** @param spectators true なら見物人（簡易な立ち姿勢だけ） */
  constructor(models: Models, count: number, colors: string[], castShadow = true, spectators = false) {
    const list = spectators ? [models.standLo] : [...models.poses, models.stand];
    this.sets = list.map((ps) => new InstancedParts(ps, models.materials, count, { castShadow }));
    this.counts = list.map(() => 0);
    this.colors = Array.from({ length: count }, (_, i) => {
      const c = new THREE.Color(colors[i % colors.length]);
      return c.offsetHSL(0, 0, (((i * 7919) % 13) / 13 - 0.5) * 0.08);
    });
    for (const set of this.sets) {
      for (const mesh of set.meshes) mesh.count = 0;
      // instanceColor を用意しておく
      set.setColor(0, 'happi', this.colors[0]);
      this.group.add(set.group);
    }
  }

  begin(): void {
    this.counts.fill(0);
  }

  /** @param pose 0..3 = 走り、4 = 立ち（見物人の群衆では無視） */
  add(i: number, pose: number, x: number, y: number, z: number, yaw: number, lean = 0, bob = 0, scale = 1): void {
    const p = Math.min(pose, this.sets.length - 1);
    const slot = this.counts[p]++;
    this.e.set(lean, yaw, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(x, y + bob, z);
    this.sc.setScalar(scale);
    this.m.compose(this.v, this.q, this.sc);
    this.sets[p].setMatrix(slot, this.m);
    this.sets[p].setColor(slot, 'happi', this.colors[i]);
  }

  commit(): void {
    this.sets.forEach((set, p) => {
      for (const mesh of set.meshes) mesh.count = this.counts[p];
      set.commit();
    });
  }
}
