import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  ShapeUtils,
  Vector2,
} from 'three';
import { GEAR_SIZES } from '../core/constants';
import { BEVEL_COS, bevelConeDistance, bevelToothWidth } from '../core/geometry/bevel';
import { helicalSliceCount, helicalTwistAt, rotateOutline } from '../core/geometry/helical';
import { spurOutline, type Vec2 } from '../core/geometry/involute';
import { gearShapeKey } from '../core/geometry/shape-key';
import { assertNever } from '../core/scene/gear-shape';
import type { GearShape, Hand, SizeKey } from '../core/scene/types';

// 2D 輪郭を、ローカルの z 方向に歯幅の分だけ押し出す。z は −faceWidth/2 〜 +faceWidth/2
// ローカルの x・y は 2D 輪郭の x・y と同じ
export function buildSpurGeometry(size: SizeKey, teeth: number): BufferGeometry {
  const { module, faceWidth } = GEAR_SIZES[size];
  const outline = spurOutline(module, teeth);
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: faceWidth,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.translate(0, 0, -faceWidth / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// 歯幅の方向に並んだ断面（どれも 2D 輪郭の点の並びが同じ）を側面でつなぎ、両端の面を閉じる。
// 側面は輪郭の辺ごとに頂点を分け、辺をまたいでは法線をなめらかにしない（平歯車の ExtrudeGeometry と同じ見た目）。
// 両端の面は元の輪郭を三角形に分けたもので、断面の点の並びに当てはめる（最初の断面が −z 向き、最後が +z 向き）
function loftGeometry(
  outline: readonly Vec2[],
  sections: ReadonlyArray<{ readonly points: readonly Vec2[]; readonly z: number }>,
): BufferGeometry {
  const n = outline.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const last = sections.length - 1;

  // 側面: 辺 (i, i+1) ごとに 2 列 × 断面の数の頂点。輪郭は反時計回りなので、外向きの面になる並び
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const base = positions.length / 3;
    for (const { points, z } of sections) {
      const [xi, yi] = points[i] as Vec2;
      const [xj, yj] = points[j] as Vec2;
      positions.push(xi, yi, z, xj, yj, z);
    }
    for (let k = 0; k < last; k++) {
      const a = base + 2 * k; // (i, k)
      const b = a + 1; // (j, k)
      const c = a + 3; // (j, k + 1)
      const d = a + 2; // (i, k + 1)
      indices.push(a, b, c, a, c, d);
    }
  }

  // 両端の面。三角形の並びは反時計回り（+z 向き）にそろえ、負側の面だけ裏返す
  const triangles = ShapeUtils.triangulateShape(
    outline.map(([x, y]) => new Vector2(x, y)),
    [],
  ).map((t) => (signedArea(outline, t) < 0 ? ([t[0], t[2], t[1]] as number[]) : t));
  for (const [k, up] of [
    [0, false],
    [last, true],
  ] as const) {
    const section = sections[k];
    if (section === undefined) continue;
    const base = positions.length / 3;
    for (const [x, y] of section.points) positions.push(x, y, section.z);
    for (const [a, b, c] of triangles as Array<[number, number, number]>) {
      if (up) indices.push(base + a, base + b, base + c);
      else indices.push(base + a, base + c, base + b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// かさ歯車（S2-02）。ローカルの原点は区画の中心、頂点は +z（apex −1 の歯車は描画でローカルの z を反転する）。
// 大端（z = −歯幅/2）の断面は歯数 z の平歯車の 2D 輪郭（簡略化）で、頂点に向かって相似に縮めながら、
// ピッチ円すい（45°）に沿って歯の幅 b だけ押し出す（軸方向には b·cos45°）。大端の背面は平らな面で閉じる
export function buildBevelGeometry(size: SizeKey, teeth: number): BufferGeometry {
  const { module, faceWidth } = GEAR_SIZES[size];
  const outline = spurOutline(module, teeth);
  const toothWidth = bevelToothWidth(size, teeth);
  const shrink = 1 - toothWidth / bevelConeDistance(size, teeth);
  const bigEnd = -faceWidth / 2;
  return loftGeometry(outline, [
    { points: outline, z: bigEnd },
    {
      points: outline.map(([x, y]): Vec2 => [x * shrink, y * shrink]),
      z: bigEnd + toothWidth * BEVEL_COS,
    },
  ]);
}

// ハスバ歯車（S2-01）。軸直角断面（平歯車と同じ 2D 輪郭）を、歯幅の方向に押し出しながらねじる
// （core/geometry/helical.ts の helicalTwistAt。歯幅の中央の断面が平歯車の歯形と一致する）。
// 両端の面は平歯車と同じ輪郭を三角形に分け、その断面のねじれの分だけ回す
export function buildHelicalGeometry(size: SizeKey, teeth: number, hand: Hand): BufferGeometry {
  const { module, faceWidth } = GEAR_SIZES[size];
  const outline = spurOutline(module, teeth);
  const slices = helicalSliceCount(size, teeth);
  const zAt = (k: number) => -faceWidth / 2 + (faceWidth * k) / slices;
  const sections = Array.from({ length: slices + 1 }, (_, k) => ({
    points: rotateOutline(outline, helicalTwistAt(size, teeth, hand, zAt(k))),
    z: zAt(k),
  }));
  return loftGeometry(outline, sections);
}

function signedArea(outline: readonly Vec2[], [a, b, c]: readonly number[]): number {
  const [ax, ay] = outline[a as number] as Vec2;
  const [bx, by] = outline[b as number] as Vec2;
  const [cx, cy] = outline[c as number] as Vec2;
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// 形状データの共有。キーは (種類, 大きさ, 歯数, 形を変える属性)（core/geometry/shape-key.ts）
export interface GeometryCache {
  acquire(shape: GearShape, size: SizeKey, teeth: number): BufferGeometry; // 同じキーなら同じインスタンス
  release(shape: GearShape, size: SizeKey, teeth: number): void; // 使う所が 0 になったら dispose
  size(): number; // 保持しているキーの数（テスト用）
}

function buildGeometry(shape: GearShape, size: SizeKey, teeth: number): BufferGeometry {
  switch (shape.kind) {
    case 'spur':
      return buildSpurGeometry(size, teeth);
    case 'helical':
      return buildHelicalGeometry(size, teeth, shape.hand);
    case 'bevel':
      return buildBevelGeometry(size, teeth);
    default:
      return assertNever(shape);
  }
}

export function createGeometryCache(): GeometryCache {
  const entries = new Map<string, { geometry: BufferGeometry; refs: number }>();
  return {
    acquire(shape, size, teeth) {
      const key = gearShapeKey(shape, size, teeth);
      const entry = entries.get(key);
      if (entry !== undefined) {
        entry.refs++;
        return entry.geometry;
      }
      const geometry = buildGeometry(shape, size, teeth);
      entries.set(key, { geometry, refs: 1 });
      return geometry;
    },
    release(shape, size, teeth) {
      const key = gearShapeKey(shape, size, teeth);
      const entry = entries.get(key);
      if (entry === undefined) return; // 持っていないキーは何もしない
      entry.refs--;
      if (entry.refs <= 0) {
        entries.delete(key);
        entry.geometry.dispose();
      }
    },
    size() {
      return entries.size;
    },
  };
}

// 形状データに含めない向きを、歯車の本体の拡大縮小で表す（S2-02）。apex −1 のかさ歯車はローカルの z を反転する
// （z について鏡映しても z まわりの回転は変わらないので、位相の意味はそのまま。面の向きは three が行列式で反転する）
export function gearBodyScaleZ(shape: GearShape): 1 | -1 {
  return shape.kind === 'bevel' && shape.apex === -1 ? -1 : 1;
}
