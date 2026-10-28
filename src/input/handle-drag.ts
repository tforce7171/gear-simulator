import { GEAR_SIZES, GRID_SNAP, PERIMETER_CANDIDATE_COUNT } from '../core/constants';
import { applyCommand, type Command } from '../core/edit/commands';
import { outsideRadius } from '../core/geometry/mesh';
import { newInterferences } from '../core/layout/interference-diff';
import { meshSnapTargets } from '../core/layout/mesh-snap';
import { descendantShafts, resolveLayout } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import { axisVector, radialDirection } from '../core/math/axis';
import { add, dot, length, scale, type Vec3 } from '../core/math/vec3';
import { createSequentialIdGenerator } from '../core/scene/ids';
import {
  type Axis,
  type GearId,
  isChildPlacement,
  type Scene,
  type ShaftId,
} from '../core/scene/types';
import {
  ARC_MESH_SNAP,
  angleAroundAxis,
  axialOffsetFromDrag,
  closestParamOnLine,
  crossedSnapAngles,
  meshSnapAngles,
  nearestSnapAngle,
  snapAngle,
  unwrapDelta,
} from './handle-math';
import { closestHeightOnVerticalLine, intersectRayPlane, snap } from './placement';

// ハンドルの一覧とドラッグの仕組み（S1-17）。three と DOM に触れない。
// 種類ごとの「ポインターのレイ → 編集コマンド」を HANDLE_DRAGS に登録する。
// S1-19: 外周の角度の円弧（'arc'。mesh のシャフト）と、シャフト上の位置（'axial'。歯車）を足した。
// 共通の振る舞い: ドラッグ中は履歴に積まない仮のシーンを見せ、ドラッグ開始時に無かった干渉を新たに生む
// 値では invalid（赤）にし、離したら最後の「新たな干渉の無い」値を 1 つのコマンドで確定する

export type HandleKind = 'move' | 'height' | 'arc' | 'axial';

// 円弧・軸方向のハンドルの置き方（描画が形を作るのに使う）。
// position = center + radialDirection(axis, angle) × radius
export interface HandleFrame {
  readonly center: Vec3; // arc: 親の歯車の中心、axial: 選んだ歯車の中心
  readonly axis: Axis;
  readonly radius: number; // arc: 円弧の半径、axial: 矢印を置く軸からの距離
  readonly angle: number; // arc: 今の角度（つまみの位置）、axial: 矢印を置く向き
}

export interface HandleSpec {
  readonly kind: HandleKind;
  // move・height・arc はシャフトの ID、axial は歯車の ID
  readonly targetId: string;
  readonly position: Vec3; // ドラッグを始めるのに適した点（ハンドルの見た目の中心）
  readonly frame?: HandleFrame; // arc・axial だけ
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

// 高さのハンドル（矢印）を、シャフトの部品の最も低い所からこれだけ下に置く（mm）
export const HEIGHT_HANDLE_GAP = 6;
// 高さのハンドルを床の四角と重ならないように、これより下には置かない（mm）
export const HEIGHT_HANDLE_MIN_Y = 10;

// 円弧のハンドルの半径 = 中心距離 + 子の歯先円半径 + これ（mm。子の歯車の外側を通る）
export const ARC_HANDLE_GAP = 8;
// 軸方向のハンドルを、選んだ歯車の歯先円からこれだけ外に置く（mm）
export const AXIAL_HANDLE_GAP = 6;
// Shift を押している間の円弧の吸着の単位
export const ARC_SHIFT_STEP = (15 * Math.PI) / 180;
// 円弧のドラッグで、レイの向きと親の軸の内積の絶対値がこれ未満なら、画面上の角度で代用する
export const ARC_EDGE_ON_DOT = 0.1;
// 軸方向のドラッグで、レイの向きと軸の内積の絶対値がこれより大きければ（ほぼ平行）動かさない
export const AXIAL_PARALLEL_DOT = 0.995;

const FLOOR_POINT: Vec3 = [0, 0, 0];
const UP: Vec3 = [0, 1, 0];
const TWO_PI = 2 * Math.PI;

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

function framed(kind: HandleKind, targetId: string, frame: HandleFrame): HandleSpec {
  const position = add(frame.center, scale(radialDirection(frame.axis, frame.angle), frame.radius));
  return { kind, targetId, position, frame };
}

// 2 つの角度の、2π の折り返しを考えた差の絶対値（0〜π）
function angularDistance(a: number, b: number): number {
  const d = (((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

// 軸方向の矢印を置く向き: 外周の 8 方向のうち、この歯車に生やした子（mesh のシャフト）の向きから
// 最も離れたもの（同じなら番号の小さいもの）。子と重ならず見つけやすくするため
function axialHandleAngle(scene: Scene, gearId: GearId): number {
  const used: number[] = [];
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (p.kind === 'mesh' && p.parentGearId === gearId) used.push(p.angle);
  }
  let best = 0;
  let bestScore = -1;
  for (let k = 0; k < PERIMETER_CANDIDATE_COUNT; k++) {
    const angle = (k * TWO_PI) / PERIMETER_CANDIDATE_COUNT;
    const score = Math.min(Math.PI, ...used.map((a) => angularDistance(a, angle)));
    if (score > bestScore + 1e-9) {
      best = angle;
      bestScore = score;
    }
  }
  return best;
}

// 選択に応じて出すハンドル（並びは move → height → arc → axial）。
// - root・detached のシャフト（またはその上の歯車）: 位置（原点の真下の床）と高さ（その上の縦の線の先。
//   部品と重ならないよう、部品の最も低い所の下）
// - mesh のシャフト（またはその上の歯車）: 外周の角度の円弧（親の軸まわり、子の歯車の外側）
// - 歯車で、mesh・bevel のシャフトの childGearId でないもの: シャフト上の位置の矢印（歯先円の少し外）
export function listHandles(scene: Scene, layout: Layout, selection: string | null): HandleSpec[] {
  const shaftId = selectedShaftId(scene, selection);
  if (shaftId === null) return [];
  const shaft = scene.shafts[shaftId];
  const placed = layout.shafts[shaftId];
  if (shaft === undefined || placed === undefined) return [];
  const handles: HandleSpec[] = [];
  const p = shaft.placement;
  if (p.kind === 'root' || p.kind === 'detached') {
    const [x, , z] = placed.origin;
    const lowest = lowestY(scene, layout, shaftId) ?? placed.origin[1];
    const heightY = Math.max(lowest - HEIGHT_HANDLE_GAP, HEIGHT_HANDLE_MIN_Y);
    handles.push(
      { kind: 'move', targetId: shaftId, position: [x, 0, z] },
      { kind: 'height', targetId: shaftId, position: [x, heightY, z] },
    );
  } else if (p.kind === 'mesh') {
    // bevel のシャフト（S2-02）は 4 か所の離散なので、円弧のハンドルを出さない
    const parent = layout.gears[p.parentGearId];
    const child = scene.gears[p.childGearId];
    const childLayout = layout.gears[p.childGearId];
    if (parent !== undefined && child !== undefined && childLayout !== undefined) {
      const distance = parent.pitchRadius + childLayout.pitchRadius;
      handles.push(
        framed('arc', shaftId, {
          center: parent.center,
          axis: parent.axis,
          radius: distance + outsideRadius(child.size, child.teeth) + ARC_HANDLE_GAP,
          angle: p.angle,
        }),
      );
    }
  }
  const gear = selection === null ? undefined : scene.gears[selection];
  const gearLayout = gear === undefined ? undefined : layout.gears[gear.id];
  const isChild = isChildPlacement(p) && gear !== undefined && p.childGearId === gear.id;
  if (gear !== undefined && gearLayout !== undefined && !isChild) {
    handles.push(
      framed('axial', gear.id, {
        center: gearLayout.center,
        axis: gearLayout.axis,
        radius: outsideRadius(gear.size, gear.teeth) + AXIAL_HANDLE_GAP,
        angle: axialHandleAngle(scene, gear.id),
      }),
    );
  }
  return handles;
}

// ポインターのレイ以外の入力（S1-19）
export interface DragInput {
  readonly shift?: boolean; // Shift を押している（円弧は 15° 単位）
  // 画面上の位置。円弧を真横から見ているときの代用の角度に使う
  readonly screen?: {
    readonly pointer: { readonly x: number; readonly y: number };
    readonly project: (world: Vec3) => { x: number; y: number };
  };
}

// 1 回のポインターの移動の「レイ → コマンド」。null は「この位置では値が決まらない」（前の値のまま）。
// 配列は、通ってきた途中の値を順に並べ、最後を今の値とする（途中の値も「最後の干渉の無い値」になれる）
export type HandleDragFn = (ray: Ray, input: DragInput) => Command | readonly Command[] | null;

// 種類ごとのドラッグの作り方。ドラッグ開始時のシーン・レイから作る。始められなければ null
export type HandleDragFactory = (
  scene: Scene,
  layout: Layout,
  handle: HandleSpec,
  startRay: Ray,
  startInput: DragInput,
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

function normalized(v: Vec3): Vec3 {
  const l = length(v);
  return l === 0 ? v : scale(v, 1 / l);
}

// 軸 axis（中心 center）まわりのポインターの角度（angleAroundAxis と同じ基準）。レイと「center を通り軸に
// 垂直な面」との交点の角度で、面を真横から見ている（|レイの向き·軸| < ARC_EDGE_ON_DOT）ときは、center を
// 画面に写した点のまわりのポインターの画面上の角度で代用する（mode: 'screen'。軸がカメラから遠ざかる向きなら
// 符号を反転）。円弧のハンドル（S1-19）と手で回す（S1-21）が使う。求められなければ null
export function pointerAngleAroundAxis(
  ray: Ray,
  input: DragInput,
  center: Vec3,
  axis: Axis,
): { mode: 'ray' | 'screen'; angle: number } | null {
  const w = axisVector(axis);
  const along = dot(normalized(ray.direction), w);
  if (Math.abs(along) >= ARC_EDGE_ON_DOT) {
    const hit = intersectRayPlane(ray.origin, ray.direction, center, w);
    if (hit !== null) return { mode: 'ray', angle: angleAroundAxis(hit, center, axis) };
  }
  if (input.screen === undefined) return null;
  const c = input.screen.project(center);
  const dx = input.screen.pointer.x - c.x;
  const dy = input.screen.pointer.y - c.y;
  if (dx === 0 && dy === 0) return null;
  // 画面の y は下向きなので、反時計回りを正にするため符号を反転する
  const screenAngle = Math.atan2(-dy, dx);
  return { mode: 'screen', angle: along > 0 ? -screenAngle : screenAngle };
}

// 外周の角度: 親の軸まわりのポインターの角度の、ドラッグ開始時からの変化量（−π〜π に巻き戻して積算）を
// angle に足す。子が別の歯車とちょうどかみ合う角度の ARC_MESH_SNAP 以内ならそこへ吸着し（Shift より優先）、
// そうでなく Shift を押していれば 15° 単位にする
const arcDrag: HandleDragFactory = (scene, layout, handle, startRay, startInput) => {
  const shaftId = handle.targetId;
  const p = scene.shafts[shaftId]?.placement;
  if (p?.kind !== 'mesh') return null;
  const parent = layout.gears[p.parentGearId];
  const child = layout.gears[p.childGearId];
  if (parent === undefined || child === undefined) return null;
  const snaps = meshSnapAngles(
    parent.center,
    parent.axis,
    parent.pitchRadius + child.pitchRadius,
    child.pitchRadius,
    meshSnapTargets(scene, layout, shaftId),
  );
  let prev = pointerAngleAroundAxis(startRay, startInput, parent.center, parent.axis);
  if (prev === null) return null;
  let total = 0;
  let lastRaw = p.angle;
  const command = (angle: number): Command => ({ type: 'setMeshAngle', shaftId, angle });
  return (ray, input) => {
    const now = pointerAngleAroundAxis(ray, input, parent.center, parent.axis);
    if (now === null) return null;
    // 角度の求め方が切り替わったら、その間の変化は数えない（飛ばないように）
    if (prev !== null && now.mode === prev.mode) total += unwrapDelta(prev.angle, now.angle);
    prev = now;
    const raw = p.angle + total;
    const from = lastRaw;
    lastRaw = raw;
    const meshed = nearestSnapAngle(raw, snaps, ARC_MESH_SNAP);
    const value =
      meshed !== null ? meshed : input.shift === true ? snapAngle(raw, ARC_SHIFT_STEP) : raw;
    // 吸着の範囲を飛び越えたときも、通ってきたかみ合いの角度を途中の値として試す
    const via = meshed === null ? crossedSnapAngles(from, raw, snaps) : [];
    return via.length === 0 ? command(value) : [...via.map(command), command(value)];
  };
};

// シャフト上の位置: レイに最も近い軸の直線上の点の、ドラッグ開始時からの軸方向の移動量を
// AXIAL_SNAP の単位に丸めて offset に足す。レイが軸とほぼ平行なら動かさない
const axialDrag: HandleDragFactory = (scene, layout, handle, startRay) => {
  const gear = scene.gears[handle.targetId];
  const placed = layout.gears[handle.targetId];
  if (gear === undefined || placed === undefined) return null;
  const w = axisVector(placed.axis);
  const paramOf = (ray: Ray): number | null => {
    if (Math.abs(dot(normalized(ray.direction), w)) > AXIAL_PARALLEL_DOT) return null;
    return closestParamOnLine(ray.origin, ray.direction, placed.center, w);
  };
  const start = paramOf(startRay);
  if (start === null) return null;
  return (ray) => {
    const t = paramOf(ray);
    if (t === null) return null;
    return {
      type: 'setGearOffset',
      gearId: gear.id,
      offset: axialOffsetFromDrag(gear.offset, t - start),
    };
  };
};

export const HANDLE_DRAGS: Partial<Record<HandleKind, HandleDragFactory>> = {
  move: moveDrag,
  height: heightDrag,
  arc: arcDrag,
  axial: axialDrag,
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

// ハンドルのドラッグで動いて見える部品。move・height・arc はそのシャフトとその先、
// axial はその歯車と、その歯車の外周に生やしたシャフトとその先
export function handleMovedParts(scene: Scene, handle: HandleSpec): Set<string> {
  if (handle.kind !== 'axial') return movedParts(scene, handle.targetId);
  const ids = new Set<string>([handle.targetId]);
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (!isChildPlacement(p) || p.parentGearId !== handle.targetId) continue;
    for (const id of movedParts(scene, shaft.id)) ids.add(id);
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
  update(ray: Ray, input?: DragInput): void;
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
  startInput: DragInput = {},
): HandleDragSession | null {
  const factory = HANDLE_DRAGS[handle.kind];
  const startLayout = resolveLayout(scene);
  const commandAt = factory?.(scene, startLayout, handle, startRay, startInput) ?? null;
  if (commandAt === null) return null;
  let current: HandleDragState = { scene, invalid: false };
  let lastValid: Command | null = null;
  return {
    startScene: scene,
    handle,
    update(ray, input = {}) {
      const result = commandAt(ray, input);
      if (result === null) return;
      const commands: readonly Command[] = Array.isArray(result) ? result : [result as Command];
      for (const command of commands) {
        const next = tryApply(scene, command);
        if (next === null) continue;
        const invalid = newInterferences(startLayout, resolveLayout(next)).length > 0;
        current = { scene: next, invalid };
        if (!invalid) lastValid = next === scene ? null : command;
      }
    },
    state: () => current,
    finish: () => lastValid,
  };
}
