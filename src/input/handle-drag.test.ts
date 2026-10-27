import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../core/edit/commands';
import { resolveLayout } from '../core/layout/resolve';
import type { Vec3 } from '../core/math/vec3';
import { createSequentialIdGenerator } from '../core/scene/ids';
import { emptyScene } from '../core/scene/scene';
import type { Scene } from '../core/scene/types';
import {
  ARC_HANDLE_GAP,
  AXIAL_HANDLE_GAP,
  type HandleKind,
  type HandleSpec,
  HEIGHT_HANDLE_MIN_Y,
  handleMovedParts,
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

function handle(scene: Scene, kind: HandleKind, selection: string): HandleSpec {
  const found = listHandles(scene, resolveLayout(scene), selection).find((h) => h.kind === kind);
  if (found === undefined) throw new Error(`${kind} が無い`);
  return found;
}

function originOf(scene: Scene, shaftId: string): Vec3 | undefined {
  const p = scene.shafts[shaftId]?.placement;
  return p !== undefined && p.kind !== 'mesh' ? p.origin : undefined;
}

describe('listHandles', () => {
  it('起点のシャフトかその上の歯車なら move と height（歯車なら axial も）。move は原点の真下の床', () => {
    const scene = chain();
    const layout = resolveLayout(scene);
    expect(listHandles(scene, layout, 'shaft_1').map((h) => h.kind)).toEqual(['move', 'height']);
    expect(listHandles(scene, layout, 'gear_1').map((h) => h.kind)).toEqual([
      'move',
      'height',
      'axial',
    ]);
    for (const selection of ['shaft_1', 'gear_1']) {
      const handles = listHandles(scene, layout, selection).filter((h) => h.kind !== 'axial');
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

  it('mesh のシャフト・その子の歯車では arc だけ（move・height・axial は出ない）。未選択では何も出ない', () => {
    const scene = chain();
    const layout = resolveLayout(scene);
    for (const [selection, shaftId] of [
      ['shaft_2', 'shaft_2'],
      ['gear_2', 'shaft_2'],
      ['gear_3', 'shaft_3'],
    ] as const) {
      const handles = listHandles(scene, layout, selection);
      expect(handles.map((h) => [h.kind, h.targetId])).toEqual([['arc', shaftId]]);
    }
    expect(listHandles(scene, layout, null)).toEqual([]);
  });

  it('arc: 親の軸まわり、半径 = 中心距離 + 子の歯先円半径 + 8mm の円弧の、今の角度の位置', () => {
    const scene = chain();
    const layout = resolveLayout(scene);
    const arc = listHandles(scene, layout, 'gear_2')[0];
    // A の中心 [0, 24, 0]、B は angle 0（+Z）。半径 = 40 + 22 + 8 = 70
    expect(arc?.frame).toEqual({ center: [0, 24, 0], axis: 'y', radius: 70, angle: 0 });
    expect(arc?.position[0]).toBeCloseTo(0, 9);
    expect(arc?.position[1]).toBeCloseTo(24, 9);
    expect(arc?.position[2]).toBeCloseTo(40 + 22 + ARC_HANDLE_GAP, 9);
  });

  it('axial: mesh のシャフトの子でない歯車に出る（同じ mesh のシャフトの 2 枚目の歯車にも）', () => {
    const scene = build([
      { type: 'addRootShaft', axis: 'y', origin: [0, 35, 0], gear: { size: 'M', teeth: 20 } },
      { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: 0, teeth: 20 },
      { type: 'growGear', mode: 'coaxial', shaftId: 'shaft_2', offset: 8, size: 'S', teeth: 30 },
    ]);
    const layout = resolveLayout(scene);
    const handles = listHandles(scene, layout, 'gear_3');
    expect(handles.map((h) => [h.kind, h.targetId])).toEqual([
      ['arc', 'shaft_2'],
      ['axial', 'gear_3'],
    ]);
    const axial = handles[1];
    // 歯先円（小・30 歯で 16mm）の少し外、中心と同じ高さ
    const center = layout.gears.gear_3?.center ?? [0, 0, 0];
    expect(axial?.frame?.radius).toBe(16 + AXIAL_HANDLE_GAP);
    expect(axial?.position[1]).toBeCloseTo(center[1], 9);
    expect(
      Math.hypot((axial?.position[0] ?? 0) - center[0], (axial?.position[2] ?? 0) - center[2]),
    ).toBeCloseTo(16 + AXIAL_HANDLE_GAP, 9);
  });

  it('axial の矢印は、その歯車に生やした子の向きから離れた向きに置く', () => {
    const scene = chain();
    const axial = listHandles(scene, resolveLayout(scene), 'gear_1').find(
      (h) => h.kind === 'axial',
    );
    // A の子 B は angle 0。反対の π に置く
    expect(axial?.frame?.angle).toBeCloseTo(Math.PI, 12);
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
    const kinds = listHandles(result.scene, resolveLayout(result.scene), 'shaft_2').map(
      (h) => h.kind,
    );
    expect(kinds).toEqual(['move', 'height']);
    const gearKinds = listHandles(result.scene, resolveLayout(result.scene), 'gear_2').map(
      (h) => h.kind,
    );
    expect(gearKinds).toEqual(['move', 'height', 'axial']);
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

// 真上から、高さ y の水平な面の点 (x, z) を指すレイ（縦軸の親の面と交わる）
function downTo(x: number, z: number): Ray {
  return { origin: [x, 500, z], direction: [0, -1, 0] };
}

// 縦軸の親（中心 c）の面で、angle の向き・距離 r の点を真上から指すレイ
function downAtAngle(c: Vec3, angle: number, r = 70): Ray {
  // 軸 y の基底は u = +Z、v = +X
  return downTo(c[0] + r * Math.sin(angle), c[2] + r * Math.cos(angle));
}

function meshAngle(scene: Scene, shaftId: string): number {
  const p = scene.shafts[shaftId]?.placement;
  if (p?.kind !== 'mesh') throw new Error(`${shaftId} は mesh でない`);
  return p.angle;
}

// 縦軸の起点 A（[0, 35, 0]）の外周に B（angle 0）と D（angle π/2）。どれも中・20 歯（arc-blocked.json 相当）
function arcBlocked(): Scene {
  return build([
    { type: 'addRootShaft', axis: 'y', origin: [0, 35, 0], gear: { size: 'M', teeth: 20 } },
    { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: 0, teeth: 20 },
    { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: Math.PI / 2, teeth: 20 },
  ]);
}

describe('startHandleDrag: arc', () => {
  const A: Vec3 = [0, 24, 0];

  it('親の軸まわりのポインターの角度の変化を angle に足す。C もついてくる。確定は setMeshAngle 1 つ', () => {
    const scene = chain();
    const session = startHandleDrag(scene, handle(scene, 'arc', 'gear_2'), downAtAngle(A, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAtAngle(A, 0.3));
    session.update(downAtAngle(A, 0.6));
    const preview = session.state().scene;
    expect(meshAngle(preview, 'shaft_2')).toBeCloseTo(0.6, 9);
    const layout = resolveLayout(preview);
    const b = layout.gears.gear_2?.center ?? [0, 0, 0];
    const c = layout.gears.gear_3?.center ?? [0, 0, 0];
    expect(Math.hypot(b[0] - A[0], b[2] - A[2])).toBeCloseTo(40, 9);
    expect(Math.hypot(c[0] - b[0], c[2] - b[2])).toBeCloseTo(40, 9);
    const finish = session.finish();
    expect(finish?.type).toBe('setMeshAngle');
  });

  it('負の向きにも回せて、2π の折り返しをまたいでも連続（−0.4 → angle は 2π − 0.4）', () => {
    const scene = chain();
    const session = startHandleDrag(scene, handle(scene, 'arc', 'gear_2'), downAtAngle(A, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAtAngle(A, -0.2));
    session.update(downAtAngle(A, -0.4));
    expect(meshAngle(session.state().scene, 'shaft_2')).toBeCloseTo(2 * Math.PI - 0.4, 9);
  });

  it('Shift を押している間は 15° 単位', () => {
    const scene = chain();
    const session = startHandleDrag(scene, handle(scene, 'arc', 'gear_2'), downAtAngle(A, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAtAngle(A, 0.5), { shift: true });
    expect(meshAngle(session.state().scene, 'shaft_2')).toBeCloseTo(Math.PI / 6, 12);
    session.update(downAtAngle(A, 0.5), { shift: false });
    expect(meshAngle(session.state().scene, 'shaft_2')).toBeCloseTo(0.5, 9);
  });

  it('別の歯車とちょうどかみ合う角度の 5° 以内で吸着する（Shift より優先）', () => {
    const scene = arcBlocked();
    const a: Vec3 = [0, 39, 0];
    const session = startHandleDrag(scene, handle(scene, 'arc', 'gear_2'), downAtAngle(a, 0));
    if (session === null) throw new Error('始められない');
    // D は π/2 の向き。D とかみ合う角度は π/2 − π/3 = π/6
    session.update(downAtAngle(a, Math.PI / 6 - 0.06), { shift: true });
    const preview = session.state().scene;
    expect(meshAngle(preview, 'shaft_2')).toBeCloseTo(Math.PI / 6, 12);
    expect(session.state().invalid).toBe(false);
    expect(resolveLayout(preview).meshes).toContainEqual({
      a: 'gear_2',
      b: 'gear_3',
      source: 'contact',
    });
  });

  it('相手を越えてドラッグ → 赤くなり、離すと通ってきた吸着の角度で確定（1 回で大きく飛び越えても）', () => {
    const scene = arcBlocked();
    const a: Vec3 = [0, 39, 0];
    const session = startHandleDrag(scene, handle(scene, 'arc', 'gear_2'), downAtAngle(a, 0));
    if (session === null) throw new Error('始められない');
    session.update(downAtAngle(a, 0.2));
    session.update(downAtAngle(a, Math.PI / 2));
    expect(session.state().invalid).toBe(true);
    const finish = session.finish();
    if (finish?.type !== 'setMeshAngle') throw new Error('setMeshAngle でない');
    expect(finish.angle).toBeCloseTo(Math.PI / 6, 12);
  });

  it('親の面を真横から見ている（レイが面にほぼ平行）ときは、画面上の角度で代用する', () => {
    const scene = chain();
    const side = (y: number): Ray => ({ origin: [300, y, 0], direction: [-1, 0.05, 0] });
    // 画面: 親の中心が (100, 100)。ポインターが (200, 100) → (100, 0) で画面上 +90°（反時計回り）
    const project = (): { x: number; y: number } => ({ x: 100, y: 100 });
    const session = startHandleDrag(scene, handle(scene, 'arc', 'gear_2'), side(24), {
      screen: { pointer: { x: 200, y: 100 }, project },
    });
    if (session === null) throw new Error('始められない');
    session.update(side(24), { screen: { pointer: { x: 100, y: 0 }, project } });
    // 軸 +Y はカメラから見て上（レイの向きと同じ側）なので符号を反転する
    expect(meshAngle(session.state().scene, 'shaft_2')).toBeCloseTo(2 * Math.PI - Math.PI / 2, 9);
  });
});

// stacked.json 相当: 縦軸の起点（[0, 35, 0]）に A（中・20 歯、offset 0）と E（小・30 歯、offset 8）、
// E の外周に F（小・30 歯、angle π/2）
function stacked(): Scene {
  return build([
    { type: 'addRootShaft', axis: 'y', origin: [0, 35, 0], gear: { size: 'M', teeth: 20 } },
    { type: 'growGear', mode: 'coaxial', shaftId: 'shaft_1', offset: 8, size: 'S', teeth: 30 },
    { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_2', angle: Math.PI / 2, teeth: 30 },
  ]);
}

describe('startHandleDrag: axial', () => {
  it('軸上の移動量を 4mm に丸めて offset に足す。F もついてくる', () => {
    const scene = stacked();
    const h = handle(scene, 'axial', 'gear_2');
    const session = startHandleDrag(scene, h, sideAt(45, 0, 0));
    if (session === null) throw new Error('始められない');
    session.update(sideAt(45 + 9.5, 0, 0));
    const preview = session.state().scene;
    expect(preview.gears.gear_2?.offset).toBe(16);
    const before = resolveLayout(scene).gears.gear_3?.center ?? [0, 0, 0];
    const after = resolveLayout(preview).gears.gear_3?.center ?? [0, 0, 0];
    expect(after[1] - before[1]).toBeCloseTo(8, 9);
    expect(session.finish()).toEqual({ type: 'setGearOffset', gearId: 'gear_2', offset: 16 });
    expect(handleMovedParts(scene, h)).toEqual(new Set(['gear_2', 'shaft_2', 'gear_3']));
  });

  it('A に重なる所では invalid、離すと最後の干渉の無い値（元の値なら何もしない）', () => {
    const scene = stacked();
    const session = startHandleDrag(scene, handle(scene, 'axial', 'gear_2'), sideAt(45, 0, 0));
    if (session === null) throw new Error('始められない');
    session.update(sideAt(41, 0, 0));
    expect(session.state().invalid).toBe(true);
    expect(session.finish()).toBeNull();
  });

  it('レイが軸とほぼ平行なら動かさない（始められない）', () => {
    const scene = stacked();
    expect(startHandleDrag(scene, handle(scene, 'axial', 'gear_2'), downTo(0.1, 0))).toBeNull();
  });
});
