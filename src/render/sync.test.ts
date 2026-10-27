import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { demoScene } from '../app/demo-scene';
import { resolveLayout } from '../core/layout/resolve';
import { createSceneSync } from './sync';

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
