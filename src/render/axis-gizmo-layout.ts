// 軸の目印の球の並び（S1-14）。純粋関数のみ（three・DOM に触れない）
import { dot, type Vec3 } from '../core/math/vec3';
import type { ViewName } from '../input/views';

export type GizmoAxis = 'x' | 'y' | 'z';

export interface GizmoItem {
  readonly view: ViewName; // クリックしたときの視点（その軸の側から見る）
  readonly axis: GizmoAxis;
  readonly positive: boolean; // 正の向きの球（文字付き・大きい）か
  readonly x: number; // 目印の左上からの位置（px）
  readonly y: number;
  readonly depth: number; // 手前ほど大きい（-1〜1）。描く順に使う
}

const AXES: ReadonlyArray<{ axis: GizmoAxis; dir: Vec3; plus: ViewName; minus: ViewName }> = [
  { axis: 'x', dir: [1, 0, 0], plus: 'right', minus: 'left' },
  { axis: 'y', dir: [0, 1, 0], plus: 'top', minus: 'bottom' },
  { axis: 'z', dir: [0, 0, 1], plus: 'front', minus: 'back' },
];

// カメラの右・上・後ろ（視線の逆）の向き（ワールド座標の単位ベクトル）から、6 つの球の位置を求める。
// size は目印の一辺、radius は中心から球の中心までの長さ（px）。奥から手前の順に並べる
export function layoutGizmo(
  camera: { right: Vec3; up: Vec3; back: Vec3 },
  size: number,
  radius: number,
): GizmoItem[] {
  const c = size / 2;
  const items: GizmoItem[] = [];
  for (const { axis, dir, plus, minus } of AXES) {
    for (const positive of [true, false]) {
      const sign = positive ? 1 : -1;
      items.push({
        view: positive ? plus : minus,
        axis,
        positive,
        x: c + sign * dot(dir, camera.right) * radius,
        y: c - sign * dot(dir, camera.up) * radius,
        depth: sign * dot(dir, camera.back),
      });
    }
  }
  // 同じ深さなら正の球を手前に
  return items.sort((a, b) => a.depth - b.depth || Number(a.positive) - Number(b.positive));
}
