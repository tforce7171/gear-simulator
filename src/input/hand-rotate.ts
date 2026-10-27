import type { Layout } from '../core/layout/types';
import { axisVector } from '../core/math/axis';
import { add, dot, scale, sub, type Vec3 } from '../core/math/vec3';
import type { Axis, Scene, ShaftId } from '../core/scene/types';
import { type DragInput, pointerAngleAroundAxis, type Ray } from './handle-drag';
import { unwrapDelta } from './handle-math';
import type { PickKind } from './pick-priority';

// 手で回す（S1-21）: ポインターから、つかんだシャフトの目標の角度を求める。純粋関数のみで、three と DOM に
// 触れない。目標の角度 = 押したときのシャフトの角度 + 手の角度の変化量の積算（毎回 −π〜π に巻き戻して足す）。
// 手の角度は、レイと「つかんだ所の中心を通り、軸に垂直な面」との交点の軸まわりの角度（真横から見ているときは
// 画面上の角度で代用。円弧のハンドルと同じ pointerAngleAroundAxis）

// つかんだシャフトと、手の角度を測る中心・軸
export interface GrabTarget {
  readonly shaftId: ShaftId;
  readonly center: Vec3;
  readonly axis: Axis;
}

// ポインターの下の部品の本体（ピッキングの結果）から、つかむシャフトと中心を求める。
// 歯車はその中心、シャフト・モーターは当たった点を軸に下ろした点を中心にする。
// ハンドル・候補・配置の決まらない部品は null
export function grabTarget(
  scene: Scene,
  layout: Layout,
  body: { readonly kind: PickKind; readonly id: string; readonly point: Vec3 },
): GrabTarget | null {
  if (body.kind === 'gear') {
    const gear = scene.gears[body.id];
    const placed = layout.gears[body.id];
    if (gear === undefined || placed === undefined) return null;
    return { shaftId: gear.shaftId, center: placed.center, axis: placed.axis };
  }
  const shaftId =
    body.kind === 'shaft'
      ? body.id
      : body.kind === 'motor'
        ? scene.motors[body.id]?.shaftId
        : undefined;
  if (shaftId === undefined) return null;
  const shaft = layout.shafts[shaftId];
  if (shaft === undefined) return null;
  const w = axisVector(shaft.axis);
  const [x, y, z] = add(shaft.origin, scale(w, dot(sub(body.point, shaft.origin), w)));
  // −0 を 0 にそろえる
  return { shaftId, center: [x + 0, y + 0, z + 0], axis: shaft.axis };
}

export interface HandRotateStart extends GrabTarget {
  readonly startAngle: number; // 押したときのシャフトの角度（rad）
  readonly startRay: Ray; // 押した位置のレイ
  readonly startInput: DragInput;
}

export interface HandRotateSession {
  readonly shaftId: ShaftId;
  // ポインターが動いた: 目標の角度を求め直して返す
  update(ray: Ray, input: DragInput): number;
  // 今の目標の角度
  target(): number;
}

export function startHandRotate(start: HandRotateStart): HandRotateSession {
  const { shaftId, center, axis, startAngle } = start;
  let prev = pointerAngleAroundAxis(start.startRay, start.startInput, center, axis);
  let total = 0;
  return {
    shaftId,
    update(ray, input) {
      const now = pointerAngleAroundAxis(ray, input, center, axis);
      if (now === null) return startAngle + total;
      // 求め方が切り替わったら、その間の変化は数えない（飛ばないように）。押した位置で求められなかったときは
      // 最初に求められた位置を基準にする
      if (prev !== null && now.mode === prev.mode) total += unwrapDelta(prev.angle, now.angle);
      prev = now;
      return startAngle + total;
    },
    target: () => startAngle + total,
  };
}
