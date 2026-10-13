import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Course, MAIN_COURSE, TUTORIAL_COURSE } from '../sim/course';
import type { Models, Part } from './models';
import { buildWorld } from './world';

vi.mock('./textures', () => ({ asphalt: () => new THREE.Texture() }));

describe('コースの町並み切替', () => {
  it('古い町並みを一度だけ解放し、共有する3D部品・材質・テクスチャを保つ', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const parts: Part[] = [{ geometry, material: 'happi' }];
    const models: Models = {
      danjiri: new THREE.Group(), poses: [parts], stand: parts, standLo: parts,
      town: Object.fromEntries(['machiya_a', 'machiya_b', 'machiya_c', 'pole', 'pole_padded', 'street_lantern'].map((name) => [name, parts])),
      torii: new THREE.Mesh(geometry, material), shrine: new THREE.Mesh(geometry, material),
      materials: { happi: material },
    };
    const shared = [vi.spyOn(geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(texture, 'dispose')];
    const scene = new THREE.Scene();
    const practice = buildWorld(new Course(TUTORIAL_COURSE), models, true);
    scene.add(practice.group);
    const ownedGeometry = new Set<THREE.BufferGeometry>();
    const ownedMaterials = new Set<THREE.Material>();
    const instances: THREE.InstancedMesh[] = [];
    practice.group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments)) return;
      if (obj.geometry !== geometry) ownedGeometry.add(obj.geometry);
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (mat !== material) ownedMaterials.add(mat);
      }
      if (obj instanceof THREE.InstancedMesh) instances.push(obj);
    });
    const owned = [...ownedGeometry, ...ownedMaterials, ...instances].map((resource) => vi.spyOn(resource, 'dispose'));
    const ground = practice.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    const groundTexture = vi.spyOn(ground.material.map!, 'dispose');
    practice.dispose();
    practice.dispose();
    expect(owned.length).toBeGreaterThan(0);
    owned.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
    expect(groundTexture).toHaveBeenCalledOnce();
    shared.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(scene.children).toEqual([]);
    expect(practice.group.children).toEqual([]);
    const main = buildWorld(new Course(MAIN_COURSE), models, true);
    scene.add(main.group);
    expect(main.course.corners).toHaveLength(7);
    expect(main.group.children.length).toBeGreaterThan(0);
    main.dispose();
    shared.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
