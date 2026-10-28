import { describe, expect, it } from 'vitest';
import { parseSaveFileObject, toSaveFile } from '../core/io/save-file';
import { initialMotionState, solveMotion } from '../core/kinematics/motion';
import { resolveLayout } from '../core/layout/resolve';
import { validateScene } from '../core/scene/validate';
import { generatePerfScene } from './perf-scene';

describe('generatePerfScene', () => {
  const scene = generatePerfScene(200);
  const layout = resolveLayout(scene);

  it('歯車がちょうど 200 枚。干渉が無く、contact のかみ合いも無い', () => {
    expect(validateScene(scene)).toEqual({ ok: true });
    expect(Object.keys(scene.gears)).toHaveLength(200);
    expect(Object.keys(layout.gears)).toHaveLength(200);
    expect(layout.interferences).toEqual([]);
    expect(layout.meshes.filter((m) => m.source === 'contact')).toEqual([]);
  });

  it('力のつり合いで解くと locks が空で、全シャフトが回る', () => {
    const motion = solveMotion(scene, layout, initialMotionState());
    expect(motion.locks).toEqual([]);
    const shaftIds = Object.keys(scene.shafts);
    expect(Object.keys(motion.omegas).sort()).toEqual(shaftIds.sort());
    for (const id of shaftIds) {
      expect(Math.abs(motion.omegas[id] ?? 0), id).toBeGreaterThan(0);
    }
  });

  it('かみ合いは 180 組以上（同じシャフトに重ねた分だけ 199 より少ない）', () => {
    expect(layout.meshes.length).toBeGreaterThanOrEqual(180);
    expect(layout.meshes.length).toBeLessThan(199);
  });

  it('同じ seed なら同じシーン、seed が違うと歯数の並びが違う', () => {
    expect(generatePerfScene(200, 1)).toEqual(generatePerfScene(200, 1));
    const teeth = (seed: number) =>
      Object.values(generatePerfScene(200, seed).gears).map((g) => g.teeth);
    expect(teeth(2)).not.toEqual(teeth(1));
  });

  it('count を変えられる（20 枚）', () => {
    const small = generatePerfScene(20);
    expect(Object.keys(small.gears)).toHaveLength(20);
    expect(validateScene(small)).toEqual({ ok: true });
  });

  it('保存形式の読み込み（parseSaveFileObject）を通る', () => {
    const result = parseSaveFileObject(toSaveFile(scene));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.scene).toEqual(scene);
  });
});
