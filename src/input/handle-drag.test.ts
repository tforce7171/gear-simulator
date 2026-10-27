import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../core/edit/commands';
import { resolveLayout } from '../core/layout/resolve';
import type { Vec3 } from '../core/math/vec3';
import { createSequentialIdGenerator } from '../core/scene/ids';
import { emptyScene } from '../core/scene/scene';
import type { Scene } from '../core/scene/types';
import {
  type HandleSpec,
  HEIGHT_HANDLE_MIN_Y,
  listHandles,
  movedParts,
  type Ray,
  startHandleDrag,
} from './handle-drag';

function build(commands: Command[]): Scene {
  const ctx = { ids: createSequentialIdGenerator() };
  let scene = emptyScene();
  for (const command of commands) {
    const result = applyCommand(scene, command, ctx);
    if (!result.ok) throw new Error(result.error.message);
    scene = result.scene;
  }
  return scene;
}

// A（縦の起点、原点 [0, 20, 0]）→ B（+Z）→ C（+Z）。どれも中・20 歯
function chain(): Scene {
  return build([
    { type: 'addRootShaft', axis: 'y', origin: [0, 20, 0], gear: { size: 'M', teeth: 20 } },
    { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: 0, teeth: 20 },
    { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_2', angle: 0, teeth: 20 },
  ]);
}

// 縦の起点を 2 本、x 方向に 100 離して置く
function twoRoots(): Scene {
  return build([
    { type: 'addRootShaft', axis: 'y', origin: [0, 35, 0], gear: { size: 'M', teeth: 20 } },
    { type: 'addRootShaft', axis: 'y', origin: [100, 35, 0], gear: { size: 'M', teeth: 20 } },
  ]);
}

// 真上から床の点 (x, z) を指すレイ
function downAt(x: number, z: number): Ray {
  return { origin: [x, 500, z], direction: [0, -1, 0] };
}

// 縦の直線 x = z = 0 を、+X の側から高さ y で水平に指すレイ
function sideAt(y: number, x = 0, z = 0): Ray {
  return { origin: [x + 300, y, z], direction: [-1, 0, 0] };
}

function handle(scene: Scene, kind: 'move' | 'height', selection: string): HandleSpec {
  const found = listHandles(scene, resolveLayout(scene), selection).find((h) => h.kind === kind);
  if (found === undefined) throw new Error(`${kind} が無い`);
  return found;
}

function originOf(scene: Scene, shaftId: string): Vec3 | undefined {
  const p = scene.shafts[shaftId]?.placement;
  return p !== undefined && p.kind !== 'mesh' ? p.origin : undefined;
}

describe('listHandles', () => {
  it('起点のシャフトかその上の歯車なら move と height。move は原点の真下の床', () => {
    const scene = chain();
    const layout = resolveLayout(scene);
    for (const selection of ['shaft_1', 'gear_1']) {
      const handles = listHandles(scene, layout, selection);
      expect(handles.map((h) => h.kind)).toEqual(['move', 'height']);
      expect(handles.every((h) => h.targetId === 'shaft_1')).toBe(true);
      expect(handles[0]?.position).toEqual([0, 0, 0]);
      // 高さの矢印は原点の真上の線の上で、部品（シャフトの下端 y = 16）より下、床の四角より上
      const height = handles[1]?.position;
      expect(height?.[0]).toBe(0);
      expect(height?.[2]).toBe(0);
      expect(height?.[1]).toBeLessThan(16);
      expect(height?.[1]).toBeGreaterThanOrEqual(HEIGHT_HANDLE_MIN_Y);
    }
  });

  it('mesh のシャフト・その歯車・未選択では出ない', () => {
    const scene = chain();
    const layout = resolveLayout(scene);
    expect(listHandles(scene, layout, 'shaft_2')).toEqual([]);
    expect(listHandles(scene, layout, 'gear_3')).toEqual([]);
    expect(listHandles(scene, layout, null)).toEqual([]);
  });

  it('detached のシャフトにも出る', () => {
    const scene = chain();
    const result = applyCommand(
      scene,
      { type: 'deleteParts', ids: ['gear_1'] },
      {
        ids: createSequentialIdGenerator(),
      },
    );
    if (!result.ok) throw new Error('delete failed');
    const kinds = listHandles(result.scene, resolveLayout(result.scene), 'gear_2').map(
      (h) => h.kind,
    );
    expect(kinds).toEqual(['move', 'height']);
  });
});

describe('startHandleDrag', () => {
  it('move: 床の移動量を 5mm に吸着して足し、その先もついてくる。確定は 1 コマンド', () => {
    const scene = chain();
    const session = startHandleDrag(scene, handle(scene, 'move', 'gear_1'), downAt(0, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAt(12.4, -3));
    const { scene: preview, invalid } = session.state();
    expect(invalid).toBe(false);
    expect(originOf(preview, 'shaft_1')).toEqual([10, 20, -5]);
    const before = resolveLayout(scene).gears.gear_3?.center;
    const after = resolveLayout(preview).gears.gear_3?.center;
    expect(after?.[0]).toBeCloseTo((before?.[0] ?? 0) + 10, 9);
    expect(session.finish()).toEqual({
      type: 'moveShaft',
      shaftId: 'shaft_1',
      origin: [10, 20, -5],
    });
    expect(movedParts(scene, 'shaft_1')).toEqual(
      new Set(['shaft_1', 'shaft_2', 'shaft_3', 'gear_1', 'gear_2', 'gear_3']),
    );
  });

  it('height: 縦の直線上の移動量を足し、0 未満にしない', () => {
    const scene = chain();
    const h = handle(scene, 'height', 'shaft_1');
    const session = startHandleDrag(scene, h, sideAt(h.position[1]));
    if (session === null) throw new Error('始められない');
    session.update(sideAt(h.position[1] + 23));
    expect(originOf(session.state().scene, 'shaft_1')).toEqual([0, 45, 0]);
    session.update(sideAt(h.position[1] - 100));
    expect(originOf(session.state().scene, 'shaft_1')).toEqual([0, 0, 0]);
  });

  it('動かさずに離したら（元の値に戻したら）何もしない', () => {
    const scene = chain();
    const session = startHandleDrag(scene, handle(scene, 'move', 'shaft_1'), downAt(0, 0));
    if (session === null) throw new Error('始められない');
    expect(session.finish()).toBeNull();
    session.update(downAt(20, 0));
    session.update(downAt(1, 0));
    expect(session.finish()).toBeNull();
  });

  it('新たな干渉を生む位置では invalid、離すと最後の干渉の無い値で確定', () => {
    const scene = twoRoots();
    const session = startHandleDrag(scene, handle(scene, 'move', 'shaft_1'), downAt(0, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAt(30, 0));
    expect(session.state().invalid).toBe(false);
    session.update(downAt(50, 0)); // 中心距離 50: まだ離れている
    expect(session.state().invalid).toBe(false);
    session.update(downAt(70, 0)); // 中心距離 30: 重なる
    expect(session.state().invalid).toBe(true);
    expect(originOf(session.state().scene, 'shaft_1')).toEqual([70, 35, 0]);
    session.update(downAt(100, 0));
    expect(session.state().invalid).toBe(true);
    expect(session.finish()).toEqual({
      type: 'moveShaft',
      shaftId: 'shaft_1',
      origin: [50, 35, 0],
    });
  });

  it('始めから干渉していても、新たな干渉でなければ invalid にしない', () => {
    const scene = build([
      { type: 'addRootShaft', axis: 'y', origin: [0, 35, 0], gear: { size: 'M', teeth: 20 } },
      { type: 'addRootShaft', axis: 'y', origin: [30, 35, 0], gear: { size: 'M', teeth: 20 } },
    ]);
    expect(resolveLayout(scene).interferences.length).toBeGreaterThan(0);
    const session = startHandleDrag(scene, handle(scene, 'move', 'shaft_1'), downAt(0, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAt(-5, 0));
    expect(session.state().invalid).toBe(false);
    expect(session.finish()).not.toBeNull();
  });

  it('床に当たらない向きのレイでは値を変えない', () => {
    const scene = chain();
    const session = startHandleDrag(scene, handle(scene, 'move', 'shaft_1'), downAt(0, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAt(10, 0));
    session.update({ origin: [0, 100, 0], direction: [1, 0.5, 0] });
    expect(originOf(session.state().scene, 'shaft_1')).toEqual([10, 20, 0]);
  });
});
