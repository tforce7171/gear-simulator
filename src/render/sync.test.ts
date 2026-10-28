import { readFileSync } from 'node:fs';
import { type Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { demoScene } from '../app/demo-scene';
import { initialMotionState } from '../core/kinematics/motion';
import { resolveLayout } from '../core/layout/resolve';
import { GEAR_KIND_LIST } from '../core/scene/gear-shape';
import type { GearKind, Scene } from '../core/scene/types';
import { createSceneSync } from './sync';

// すべての種類に同じ材質（S2-05 で歯車の材質は種類ごとになった）
function allKinds(
  material: MeshStandardMaterial,
  overrides: Partial<Record<GearKind, MeshStandardMaterial>> = {},
): Record<GearKind, MeshStandardMaterial> {
  return Object.fromEntries(
    GEAR_KIND_LIST.map((kind) => [kind, overrides[kind] ?? material]),
  ) as Record<GearKind, MeshStandardMaterial>;
}

import { LOCK_SHAKE_AMPLITUDE } from './warning-effects';

// userData の pickKind・pickId を持つ物を探す
function findTarget(root: Object3D, id: string): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((o) => {
    if (o.userData.pickId === id) found = o;
  });
  return found;
}

// その部品の、見えている（当たり判定用でない）メッシュの材質
function materialOf(root: Object3D, id: string): MeshStandardMaterial {
  const target = findTarget(root, id);
  if (target === undefined) throw new Error(`${id} が無い`);
  let mesh: Mesh | undefined;
  target.traverse((o) => {
    const m = o as Mesh;
    if (mesh === undefined && m.isMesh === true && (m.material as { visible: boolean }).visible) {
      mesh = m;
    }
  });
  if (mesh === undefined) throw new Error(`${id} のメッシュが無い`);
  return mesh.material as MeshStandardMaterial;
}

describe('createSceneSync のピッキングの目印とハイライト（S1-16）', () => {
  const layout = resolveLayout(demoScene);

  it('歯車・シャフト・モーターに pickKind と pickId が付く', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    expect(findTarget(sync.root, 'gear_1')?.userData.pickKind).toBe('gear');
    expect(findTarget(sync.root, 'shaft_1')?.userData.pickKind).toBe('shaft');
    expect(findTarget(sync.root, 'motor_1')?.userData.pickKind).toBe('motor');
  });

  it('選択は強く、マウスを乗せた部品は弱く光る。シャフトを選ぶとモーターも光る', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    expect(materialOf(sync.root, 'gear_1').emissiveIntensity).toBe(1);
    expect(materialOf(sync.root, 'gear_1').emissive.getHex()).toBe(0);

    sync.setHighlight({ selected: 'gear_1', hovered: 'gear_2' });
    const selected = materialOf(sync.root, 'gear_1');
    const hovered = materialOf(sync.root, 'gear_2');
    expect(selected.emissive.getHex()).not.toBe(0);
    expect(hovered.emissive.getHex()).not.toBe(0);
    expect(selected.emissiveIntensity).toBeGreaterThan(hovered.emissiveIntensity);
    expect(materialOf(sync.root, 'shaft_1').emissive.getHex()).toBe(0);

    sync.setHighlight({ selected: 'shaft_1', hovered: null });
    expect(materialOf(sync.root, 'gear_1').emissive.getHex()).toBe(0);
    expect(materialOf(sync.root, 'shaft_1').emissive.getHex()).not.toBe(0);
    expect(materialOf(sync.root, 'motor_1').emissive.getHex()).not.toBe(0);
  });

  it('作り直した部品にもハイライトが効く', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    sync.setHighlight({ selected: 'gear_2', hovered: null });
    const gear2 = demoScene.gears.gear_2;
    if (gear2 === undefined) throw new Error('gear_2 が無い');
    const edited = { ...demoScene, gears: { ...demoScene.gears, gear_2: { ...gear2, teeth: 30 } } };
    sync.sync(edited, resolveLayout(edited));
    expect(materialOf(sync.root, 'gear_2').emissive.getHex()).not.toBe(0);
  });
});

describe('仮の部品の見た目（S1-17）', () => {
  const layout = resolveLayout(demoScene);

  it('ghost は半透明、invalid は赤。ハイライトより優先し、null で戻る。シャフトのモーターにも効く', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    sync.setHighlight({ selected: 'gear_1', hovered: null });
    sync.setPreviewStyle({ ids: new Set(['gear_1', 'shaft_1']), ghost: true, invalid: false });
    const ghost = materialOf(sync.root, 'gear_1');
    expect(ghost.transparent).toBe(true);
    expect(ghost.opacity).toBeLessThan(1);
    expect(materialOf(sync.root, 'motor_1').transparent).toBe(true);
    expect(materialOf(sync.root, 'gear_2').transparent).toBe(false);

    sync.setPreviewStyle({ ids: new Set(['gear_1']), ghost: false, invalid: true });
    const invalid = materialOf(sync.root, 'gear_1');
    expect(invalid.transparent).toBe(false);
    expect(invalid.color.r).toBeGreaterThan(invalid.color.g * 2);

    sync.setPreviewStyle({ ids: new Set(['gear_1']), ghost: true, invalid: true });
    const both = materialOf(sync.root, 'gear_1');
    expect(both.transparent).toBe(true);
    expect(both.color.r).toBeGreaterThan(both.color.g * 2);

    sync.setPreviewStyle(null);
    const back = materialOf(sync.root, 'gear_1');
    expect(back.transparent).toBe(false);
    expect(back.emissive.getHex()).not.toBe(0); // 選択のハイライトに戻る
  });
});

describe('ロックと干渉の表示（S1-22）', () => {
  const layout = resolveLayout(demoScene);
  const motion = initialMotionState();
  const warnings = (locked: string[], interfering: string[]) => ({
    locked: new Set(locked),
    interfering: new Set(interfering),
  });
  const isRed = (m: MeshStandardMaterial): boolean =>
    m.emissive.r > 0.5 && m.emissive.r > m.emissive.g * 3 && m.emissive.r > m.emissive.b * 3;

  it('ロック中の部品は赤く光り、その強さが時間で変わる（脈打つ）', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    sync.setWarnings(warnings(['gear_1', 'shaft_1', 'motor_1'], []));
    const intensities = new Set<number>();
    for (const t of [0, 0.1, 0.25, 0.4]) {
      sync.update(motion, layout, t);
      const m = materialOf(sync.root, 'gear_1');
      expect(isRed(m)).toBe(true);
      intensities.add(Math.round(m.emissiveIntensity * 1000));
    }
    expect(intensities.size).toBeGreaterThan(1);
    expect(isRed(materialOf(sync.root, 'shaft_1'))).toBe(true);
    expect(isRed(materialOf(sync.root, 'motor_1'))).toBe(true);
    expect(materialOf(sync.root, 'gear_2').emissive.getHex()).toBe(0);
  });

  it('干渉している部品は一定の赤。時間で変わらない', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    sync.setWarnings(warnings([], ['gear_2']));
    sync.update(motion, layout, 0);
    const a = materialOf(sync.root, 'gear_2').emissiveIntensity;
    expect(isRed(materialOf(sync.root, 'gear_2'))).toBe(true);
    sync.update(motion, layout, 0.25);
    expect(materialOf(sync.root, 'gear_2').emissiveIntensity).toBe(a);
  });

  it('震えは描画だけ。振幅は LOCK_SHAKE_AMPLITUDE 以内で、運動の状態は変えない', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    const body = (id: string) => {
      const target = findTarget(sync.root, id);
      const mesh = target?.children[0];
      if (mesh === undefined) throw new Error(`${id} が無い`);
      return mesh;
    };
    const m = { ...motion, angles: { shaft_1: 0.3, shaft_2: 0 } };
    const frozen = JSON.stringify(m);
    sync.update(m, layout, 0.1);
    const still = body('gear_1').rotation.z;
    sync.setWarnings(warnings(['gear_1', 'shaft_1'], []));
    const values = new Set<number>();
    for (const t of [0.1, 0.113, 0.127, 0.15]) {
      sync.update(m, layout, t);
      const d = body('gear_1').rotation.z - still;
      expect(Math.abs(d)).toBeLessThanOrEqual(LOCK_SHAKE_AMPLITUDE + 1e-12);
      values.add(Math.round(d * 1e6));
    }
    expect(values.size).toBeGreaterThan(1);
    expect(JSON.stringify(m)).toBe(frozen);
    sync.setWarnings(warnings([], []));
    sync.update(m, layout, 0.2);
    expect(body('gear_1').rotation.z).toBeCloseTo(still, 12);
  });

  it('選択と同時でも見分けられる。ロックは干渉より優先、仮の部品の見た目はさらに優先', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    sync.setHighlight({ selected: 'gear_1', hovered: null });
    const selectedOnly = materialOf(sync.root, 'gear_1');
    sync.setWarnings(warnings(['gear_1', 'gear_2'], []));
    sync.update(motion, layout, 0);
    const lockedSelected = materialOf(sync.root, 'gear_1');
    const lockedOnly = materialOf(sync.root, 'gear_2');
    expect(isRed(lockedSelected)).toBe(true);
    expect(lockedSelected).not.toBe(selectedOnly);
    // 選択中は色（albedo）を水色に寄せる。ロックだけの部品とは色で見分けられる
    expect(lockedSelected.color.b).toBeGreaterThan(lockedOnly.color.b);
    expect(lockedSelected.color.b).toBeGreaterThan(lockedSelected.color.r);

    // 干渉にも入っていればロックを優先（脈打つ）
    sync.setWarnings({ locked: new Set(['gear_2']), interfering: new Set(['gear_2']) });
    sync.update(motion, layout, 0);
    const a = materialOf(sync.root, 'gear_2').emissiveIntensity;
    sync.update(motion, layout, 0.25);
    expect(materialOf(sync.root, 'gear_2').emissiveIntensity).not.toBe(a);

    sync.setPreviewStyle({ ids: new Set(['gear_2']), ghost: true, invalid: false });
    expect(materialOf(sync.root, 'gear_2').transparent).toBe(true);
  });
});

describe('テーマの材質の差し替え（S1-24）', () => {
  const layout = resolveLayout(demoScene);

  it('基の材質を差し替えると部品の材質が変わり、古い材質は dispose される', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    const before = materialOf(sync.root, 'gear_1');
    let disposed = 0;
    before.addEventListener('dispose', () => {
      disposed++;
    });
    const gear = new MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.32 });
    sync.setBaseMaterials({
      gear: allKinds(gear),
      shaft: new MeshStandardMaterial(),
      motor: new MeshStandardMaterial(),
    });
    expect(materialOf(sync.root, 'gear_1')).toBe(gear);
    expect(disposed).toBe(1);
    // 選択の材質も新しい基から作り直す（色は基のまま、発光が水色）
    sync.setHighlight({ selected: 'gear_1', hovered: null });
    const selected = materialOf(sync.root, 'gear_1');
    expect(selected).not.toBe(gear);
    expect(selected.color.getHex()).toBe(0xc9a24a);
    expect(selected.metalness).toBe(1);
  });

  it('歯車の基の材質は種類ごと（S2-05）: ウォームとホイールは平歯車と別の材質', () => {
    const worm = JSON.parse(
      readFileSync(new URL('../../e2e/fixtures/worm-basic.json', import.meta.url), 'utf8'),
    ) as Scene;
    const sync = createSceneSync();
    sync.sync(worm, resolveLayout(worm));
    const brass = new MeshStandardMaterial({ color: 0xc9a24a });
    const steel = new MeshStandardMaterial({ color: 0xb9bec4 });
    const bronze = new MeshStandardMaterial({ color: 0xc07840 });
    let disposed = 0;
    for (const m of [steel, bronze, brass]) {
      m.addEventListener('dispose', () => {
        disposed++;
      });
    }
    sync.setBaseMaterials({
      gear: allKinds(brass, { worm: steel, wormWheel: bronze }),
      shaft: new MeshStandardMaterial(),
      motor: new MeshStandardMaterial(),
    });
    expect(materialOf(sync.root, 'gear_w')).toBe(steel);
    expect(materialOf(sync.root, 'gear_h')).toBe(bronze);
    // 選択の材質も種類ごとの基から作る
    sync.setHighlight({ selected: 'gear_w', hovered: null });
    expect(materialOf(sync.root, 'gear_w').color.getHex()).toBe(0xb9bec4);
    // 差し替えると、共有している基の材質も 1 回ずつ dispose される
    sync.setBaseMaterials({
      gear: allKinds(new MeshStandardMaterial()),
      shaft: new MeshStandardMaterial(),
      motor: new MeshStandardMaterial(),
    });
    expect(disposed).toBe(3);
  });

  it('歯車とシャフトは影を落とす', () => {
    const sync = createSceneSync();
    sync.sync(demoScene, layout);
    const meshes: Mesh[] = [];
    sync.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh === true && (m.material as { visible: boolean }).visible) meshes.push(m);
    });
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) expect(m.castShadow).toBe(true);
  });
});
