import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { initialMotionState } from '../core/kinematics/motion';
import { type CandidateSpec, createCandidateView } from './candidates';
import { createGeometryCache } from './gear-geometry';

const perimeter: CandidateSpec = {
  shape: { kind: 'spur' },
  size: 'M',
  teeth: 20,
  center: [0, 39, 40],
  axis: 'y',
  phase: 0.1,
  followShaftId: 'shaft_a',
  followRatio: -1.5,
  withShaft: true,
};
const coaxial: CandidateSpec = {
  ...perimeter,
  center: [0, 49, 0],
  phase: 0,
  followRatio: 1,
  withShaft: false,
};

function targets(root: Object3D): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.pickKind === 'candidate') found.push(o);
  });
  return found;
}

function meshes(o: Object3D): Mesh[] {
  const found: Mesh[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh === true) found.push(c as Mesh);
  });
  return found;
}

describe('createCandidateView', () => {
  it('候補ごとに pickKind candidate・pickId が番号の物を作る。外周にはシャフトも付く', () => {
    const view = createCandidateView(createGeometryCache());
    view.set([perimeter, coaxial], null);
    const found = targets(view.root);
    expect(found.map((o) => o.userData.pickId)).toEqual(['0', '1']);
    expect(meshes(found[0] as Object3D)).toHaveLength(2);
    expect(meshes(found[1] as Object3D)).toHaveLength(1);
    expect(found[1]?.position.toArray()).toEqual([0, 49, 0]);
  });

  it('形状データは本物の歯車と共有のキャッシュから取り、消したら返す', () => {
    const cache = createGeometryCache();
    const view = createCandidateView(cache);
    view.set([perimeter, coaxial], null);
    expect(cache.size()).toBe(1);
    view.set([], null);
    expect(cache.size()).toBe(0);
    expect(targets(view.root)).toHaveLength(0);
  });

  it('半透明で、マウスを乗せた候補は濃い。同じ一覧なら作り直さない', () => {
    const view = createCandidateView(createGeometryCache());
    const list = [perimeter, coaxial];
    view.set(list, null);
    const before = targets(view.root);
    view.set(list, 1);
    const after = targets(view.root);
    expect(after[0]).toBe(before[0]);
    const m0 = meshes(after[0] as Object3D)[0]?.material as MeshStandardMaterial;
    const m1 = meshes(after[1] as Object3D)[0]?.material as MeshStandardMaterial;
    expect(m0.transparent).toBe(true);
    expect(m0.opacity).toBeLessThan(m1.opacity);
    expect(m1.opacity).toBeLessThan(1);
  });

  it('update: 回転角 = phase + followRatio × シャフトの角度', () => {
    const view = createCandidateView(createGeometryCache());
    view.set([perimeter, coaxial], null);
    view.update({ ...initialMotionState(), angles: { shaft_a: 0.4 } });
    const [p, c] = targets(view.root).map((o) => meshes(o)[0]);
    expect(p?.rotation.z).toBeCloseTo(0.1 - 1.5 * 0.4, 9);
    expect(c?.rotation.z).toBeCloseTo(0.4, 9);
  });
});
