import { GEAR_SIZES, GRID_SNAP } from '../core/constants';
import { applyCommand, type Command } from '../core/edit/commands';
import { outsideRadius } from '../core/geometry/mesh';
import { newInterferences } from '../core/layout/interference-diff';
import { descendantShafts, resolveLayout } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import { axisVector } from '../core/math/axis';
import type { Vec3 } from '../core/math/vec3';
import { createSequentialIdGenerator } from '../core/scene/ids';
import type { Scene, ShaftId } from '../core/scene/types';
import { closestHeightOnVerticalLine, intersectRayPlane, snap } from './placement';

// ハンドルの一覧とドラッグの仕組み（S1-17）。three と DOM に触れない。
// 種類ごとの「ポインターのレイ → 編集コマンド」を HANDLE_DRAGS に登録する（S1-19 が 'arc'・'axial' を足す）。
// 共通の振る舞い: ドラッグ中は履歴に積まない仮のシーンを見せ、ドラッグ開始時に無かった干渉を新たに生む
// 値では invalid（赤）にし、離したら最後の「新たな干渉の無い」値を 1 つのコマンドで確定する

export type HandleKind = 'move' | 'height' | 'arc' | 'axial';

export interface HandleSpec {
  readonly kind: HandleKind;
  readonly targetId: string; // move・height はシャフトの ID
  readonly position: Vec3; // ドラッグを始めるのに適した点（ハンドルの見た目の中心）
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

// 高さのハンドル（矢印）を、シャフトの部品の最も低い所からこれだけ下に置く（mm）
export const HEIGHT_HANDLE_GAP = 6;
// 高さのハンドルを床の四角と重ならないように、これより下には置かない（mm）
export const HEIGHT_HANDLE_MIN_Y = 10;

const FLOOR_POINT: Vec3 = [0, 0, 0];
const UP: Vec3 = [0, 1, 0];

// ピッキングの ID（setPickTarget の id）。'<kind>:<targetId>'
export function handlePickId(handle: Pick<HandleSpec, 'kind' | 'targetId'>): string {
  return `${handle.kind}:${handle.targetId}`;
}

// 選択中の部品が載っている（または選択そのものの）シャフト。無ければ null
export function selectedShaftId(scene: Scene, selection: string | null): ShaftId | null {
  if (selection === null) return null;
  if (scene.shafts[selection] !== undefined) return selection;
  return scene.gears[selection]?.shaftId ?? null;
}

// シャフトの部品（シャフトの線分と、その上の歯車の円柱）の最も低い y
function lowestY(scene: Scene, layout: Layout, shaftId: ShaftId): number | null {
  const shaft = layout.shafts[shaftId];
  if (shaft === undefined) return null;
  const w = axisVector(shaft.axis);
  let lowest = Math.min(
    shaft.origin[1] + shaft.span[0] * w[1],
    shaft.origin[1] + shaft.span[1] * w[1],
  );
  for (const gear of Object.values(scene.gears)) {
    if (gear.shaftId !== shaftId) continue;
    const placed = layout.gears[gear.id];
    if (placed === undefined) continue;
    const extent =
      placed.axis === 'y'
        ? GEAR_SIZES[gear.size].faceWidth / 2
        : outsideRadius(gear.size, gear.teeth);
    lowest = Math.min(lowest, placed.center[1] - extent);
  }
  return lowest;
}

// 選択に応じて出すハンドル。root・detached のシャフト（またはその上の歯車）を選んでいるとき、
// 位置（原点の真下の床）と高さ（その上の縦の線の先。部品と重ならないよう、部品の最も低い所の下）
export function listHandles(scene: Scene, layout: Layout, selection: string | null): HandleSpec[] {
  const shaftId = selectedShaftId(scene, selection);
  if (shaftId === null) return [];
  const shaft = scene.shafts[shaftId];
  const placed = layout.shafts[shaftId];
  if (shaft === undefined || placed === undefined) return [];
  if (shaft.placement.kind !== 'root' && shaft.placement.kind !== 'detached') return [];
  const [x, , z] = placed.origin;
  const lowest = lowestY(scene, layout, shaftId) ?? placed.origin[1];
  const heightY = Math.max(lowest - HEIGHT_HANDLE_GAP, HEIGHT_HANDLE_MIN_Y);
  return [
    { kind: 'move', targetId: shaftId, position: [x, 0, z] },
    { kind: 'height', targetId: shaftId, position: [x, heightY, z] },
  ];
}

// 1 回のドラッグの「レイ → コマンド」。null は「この位置では値が決まらない」（前の値のまま）
export type HandleDragFn = (ray: Ray) => Command | null;

// 種類ごとのドラッグの作り方。ドラッグ開始時のシーン・レイから作る。始められなければ null
export type HandleDragFactory = (
  scene: Scene,
  layout: Layout,
  handle: HandleSpec,
  startRay: Ray,
) => HandleDragFn | null;

function freeOrigin(scene: Scene, shaftId: string): Vec3 | null {
  const p = scene.shafts[shaftId]?.placement;
  if (p === undefined || (p.kind !== 'root' && p.kind !== 'detached')) return null;
  return p.origin;
}

// 位置: 床の平面上の移動量を原点の x・z に足し、GRID_SNAP に吸着
const moveDrag: HandleDragFactory = (scene, _layout, handle, startRay) => {
  const origin = freeOrigin(scene, handle.targetId);
  const start = intersectRayPlane(startRay.origin, startRay.direction, FLOOR_POINT, UP);
  if (origin === null || start === null) return null;
  return (ray) => {
    const hit = intersectRayPlane(ray.origin, ray.direction, FLOOR_POINT, UP);
    if (hit === null) return null;
    return {
      type: 'moveShaft',
      shaftId: handle.targetId,
      origin: [
        snap(origin[0] + hit[0] - start[0], GRID_SNAP),
        origin[1],
        snap(origin[2] + hit[2] - start[2], GRID_SNAP),
      ],
    };
  };
};

// 高さ: 原点を通る縦の直線上の移動量を y に足し、GRID_SNAP に吸着、0 以上
const heightDrag: HandleDragFactory = (scene, _layout, handle, startRay) => {
  const origin = freeOrigin(scene, handle.targetId);
  if (origin === null) return null;
  const [x, y, z] = origin;
  const start = closestHeightOnVerticalLine(startRay.origin, startRay.direction, x, z);
  if (start === null) return null;
  return (ray) => {
    const h = closestHeightOnVerticalLine(ray.origin, ray.direction, x, z);
    if (h === null) return null;
    return {
      type: 'moveShaft',
      shaftId: handle.targetId,
      origin: [x, Math.max(0, snap(y + h - start, GRID_SNAP)), z],
    };
  };
};

export const HANDLE_DRAGS: Partial<Record<HandleKind, HandleDragFactory>> = {
  move: moveDrag,
  height: heightDrag,
};

// ドラッグで動いて見える部品（そのシャフトとその先のシャフト、その上の歯車とモーター）
export function movedParts(scene: Scene, shaftId: ShaftId): Set<string> {
  const shafts = new Set(descendantShafts(scene, shaftId));
  const ids = new Set<string>(shafts);
  for (const gear of Object.values(scene.gears)) if (shafts.has(gear.shaftId)) ids.add(gear.id);
  for (const motor of Object.values(scene.motors)) {
    if (shafts.has(motor.shaftId)) ids.add(motor.id);
  }
  return ids;
}

export interface HandleDragState {
  readonly scene: Scene; // 見せる仮のシーン（今のポインターの位置の値）
  readonly invalid: boolean; // 新たな干渉を生む（赤くする）
}

export interface HandleDragSession {
  readonly startScene: Scene;
  readonly handle: HandleSpec;
  // ポインターが動いた
  update(ray: Ray): void;
  state(): HandleDragState;
  // 離したときに確定するコマンド（最後の「新たな干渉の無い」値）。何も変わらなければ null
  finish(): Command | null;
}

// 仮のシーン。失敗するコマンドなら null（ハンドルの作るコマンドは部品を作らない）
function tryApply(scene: Scene, command: Command): Scene | null {
  const result = applyCommand(scene, command, { ids: createSequentialIdGenerator() });
  return result.ok ? result.scene : null;
}

export function startHandleDrag(
  scene: Scene,
  handle: HandleSpec,
  startRay: Ray,
): HandleDragSession | null {
  const factory = HANDLE_DRAGS[handle.kind];
  const startLayout = resolveLayout(scene);
  const commandAt = factory?.(scene, startLayout, handle, startRay) ?? null;
  if (commandAt === null) return null;
  let current: HandleDragState = { scene, invalid: false };
  let lastValid: Command | null = null;
  return {
    startScene: scene,
    handle,
    update(ray) {
      const command = commandAt(ray);
      if (command === null) return;
      const next = tryApply(scene, command);
      if (next === null) return;
      const invalid = newInterferences(startLayout, resolveLayout(next)).length > 0;
      current = { scene: next, invalid };
      if (!invalid) lastValid = next === scene ? null : command;
    },
    state: () => current,
    finish: () => lastValid,
  };
}
