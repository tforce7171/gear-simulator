import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Path,
  Shape,
  ShapeUtils,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CROSSED_HELIX_ANGLE,
  GEAR_SIZES,
  HELIX_ANGLE,
  INTERNAL_WEB_GAP,
  INTERNAL_WEB_THICKNESS,
} from '../core/constants';
import { BEVEL_COS, bevelConeDistance, bevelToothWidth } from '../core/geometry/bevel';
import { helicalSliceCount, helicalTwistAt, rotateOutline } from '../core/geometry/helical';
import { internalOutline, internalRimRadius, internalRootRadius } from '../core/geometry/internal';
import { spurOutline, type Vec2 } from '../core/geometry/involute';
import { gearShapeKey } from '../core/geometry/shape-key';
import {
  WORM_LEAD_ANGLE,
  wormAxialPitch,
  wormLength,
  wormRootRadius,
  wormThreadOffset,
  wormThreadRadius,
} from '../core/geometry/worm';
import { assertNever } from '../core/scene/gear-shape';
import type { GearShape, Hand, SizeKey } from '../core/scene/types';

// 2D 輪郭を、ローカルの z 方向に歯幅の分だけ押し出す。z は −faceWidth/2 〜 +faceWidth/2
// ローカルの x・y は 2D 輪郭の x・y と同じ。faceWidth は厚さ（S4-05。省けば大きさごとの歯幅）
export function buildSpurGeometry(
  size: SizeKey,
  teeth: number,
  faceWidth: number = GEAR_SIZES[size].faceWidth,
): BufferGeometry {
  const { module } = GEAR_SIZES[size];
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
// helixAngle は省くと HELIX_ANGLE（ウォームホイールは進み角 WORM_LEAD_ANGLE・右。S2-03）。
// faceWidth は厚さ（S4-05。省けば大きさごとの歯幅）。ねじれ角はそのままで、厚いほど全体のねじれが大きい
export function buildHelicalGeometry(
  size: SizeKey,
  teeth: number,
  hand: Hand,
  helixAngle: number = HELIX_ANGLE,
  faceWidth: number = GEAR_SIZES[size].faceWidth,
): BufferGeometry {
  const { module } = GEAR_SIZES[size];
  const outline = spurOutline(module, teeth);
  const slices = helicalSliceCount(size, teeth, helixAngle, faceWidth);
  const zAt = (k: number) => -faceWidth / 2 + (faceWidth * k) / slices;
  const sections = Array.from({ length: slices + 1 }, (_, k) => ({
    points: rotateOutline(outline, helicalTwistAt(size, teeth, hand, zAt(k), helixAngle)),
    z: zAt(k),
  }));
  return loftGeometry(outline, sections);
}

// ウォーム（S2-03）。ローカルの原点はねじ山の中央（区画の中央）、軸はローカルの z。
// 軸方向断面がラックの歯形（圧力角 20° の台形。wormThreadRadius）のねじ山を、右ねじのらせんに沿って掃いた形:
// 軸まわりの角度 θ・軸方向の位置 z の点の半径は wormThreadRadius(z − wormThreadOffset(θ))（位相 0 で、角度 θ の
// ねじ山の中心は z = π·m·θ/2π）。両端は 45° で歯底円まで面取りし、歯底円の円板で閉じる
export function buildWormGeometry(size: SizeKey): BufferGeometry {
  const half = wormLength(size) / 2;
  const root = wormRootRadius(size);
  const pitch = wormAxialPitch(size);
  const angular = WORM_ANGULAR_SEGMENTS;
  // 丸め誤差で 1 つ増えないように、わずかに引いてから切り上げる（中で 240 分割）
  const axial = Math.ceil((2 * half) / (pitch / WORM_AXIAL_SEGMENTS_PER_PITCH) - 1e-9);
  const positions: number[] = [];
  const indices: number[] = [];
  const radiusAt = (theta: number, z: number) =>
    Math.min(
      wormThreadRadius(size, z - wormThreadOffset(size, theta)),
      root + (half - Math.abs(z)), // 両端の面取り
    );
  // 側面: (axial + 1) 行 × (angular + 1) 列（列の最後は θ = 2π で最初と同じ位置）
  for (let i = 0; i <= axial; i++) {
    const z = -half + (2 * half * i) / axial;
    for (let j = 0; j <= angular; j++) {
      const theta = (2 * Math.PI * j) / angular;
      const r = radiusAt(theta, z);
      positions.push(r * Math.cos(theta), r * Math.sin(theta), z);
    }
  }
  const row = angular + 1;
  for (let i = 0; i < axial; i++) {
    for (let j = 0; j < angular; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row + 1;
      const d = a + row;
      // 外向き（θ が増える向き × z が増える向き = 外向き）
      indices.push(a, b, c, a, c, d);
    }
  }
  // 両端の円板（半径は歯底円。面取りで端の輪は歯底円になる）。側面と法線を分けるため頂点は別に持つ
  for (const [z, up] of [
    [-half, false],
    [half, true],
  ] as const) {
    const center = positions.length / 3;
    positions.push(0, 0, z);
    for (let j = 0; j <= angular; j++) {
      const theta = (2 * Math.PI * j) / angular;
      positions.push(root * Math.cos(theta), root * Math.sin(theta), z);
    }
    for (let j = 1; j <= angular; j++) {
      if (up) indices.push(center, center + j, center + j + 1);
      else indices.push(center, center + j + 1, center + j);
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

// 内歯車（S3-02）。ローカルの原点はリング（歯幅の区画）の中心、軸はローカルの z。ウェブは −z の側
// （webSide 1 の歯車は描画でローカルの z を反転する。gearBodyScaleZ）。
// - リング: z = −歯幅/2 〜 +歯幅/2。外側はリムの外側の円 R + 3.25m、内側は内歯の輪郭（internalOutline）
// - つなぎの筒: リングの −z の面から INTERNAL_WEB_GAP、半径 R + 2.25m 〜 R + 3.25m の薄い筒
// - ウェブ: 筒の端に厚さ m の円板（半径 R + 3.25m）
// - ボス: ウェブの外側の面から、ウェブと合わせて INTERNAL_WEB_THICKNESS になるまでの短い円柱（シャフトを通す）
// faceWidth はリングの厚さ（S4-05。省けば大きさごとの歯幅）
export function buildInternalGeometry(
  size: SizeKey,
  teeth: number,
  faceWidth: number = GEAR_SIZES[size].faceWidth,
): BufferGeometry {
  const { module } = GEAR_SIZES[size];
  const rim = internalRimRadius(size, teeth);
  const tubeInner = internalRootRadius(size, teeth) + module;
  const circle = (r: number, n: number): Vector2[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return new Vector2(r * Math.cos(a), r * Math.sin(a));
    });
  const segments = Math.max(64, teeth * 4);
  const extrude = (shape: Shape, from: number, depth: number): BufferGeometry => {
    const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, from);
    return g;
  };

  const ring = new Shape(circle(rim, segments));
  ring.holes.push(new Path(internalOutline(module, teeth).map(([x, y]) => new Vector2(x, y))));
  const tube = new Shape(circle(rim, segments));
  tube.holes.push(new Path(circle(tubeInner, segments)));
  const webZ = -faceWidth / 2 - INTERNAL_WEB_GAP;
  const bossRadius = 3 + module;
  const parts = [
    extrude(ring, -faceWidth / 2, faceWidth),
    extrude(tube, webZ, INTERNAL_WEB_GAP),
    extrude(new Shape(circle(rim, segments)), webZ - module, module),
    extrude(
      new Shape(circle(bossRadius, 24)),
      webZ - INTERNAL_WEB_THICKNESS,
      INTERNAL_WEB_THICKNESS - module,
    ),
  ];
  const geometry = mergeGeometries(parts); // ExtrudeGeometry はどれも index を持たない
  for (const g of parts) g.dispose();
  if (geometry === null) throw new Error('buildInternalGeometry: merge failed');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// ウォームの形の分割数（軸まわり、軸方向ピッチ 1 つあたり）
export const WORM_ANGULAR_SEGMENTS = 64;
export const WORM_AXIAL_SEGMENTS_PER_PITCH = 48;

function signedArea(outline: readonly Vec2[], [a, b, c]: readonly number[]): number {
  const [ax, ay] = outline[a as number] as Vec2;
  const [bx, by] = outline[b as number] as Vec2;
  const [cx, cy] = outline[c as number] as Vec2;
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// 形状データの共有。キーは (種類, 大きさ, 歯数, 形を変える属性, 厚さ)（core/geometry/shape-key.ts）。
// width は厚さ（S4-05。gearWidth の値。省けば大きさごとの歯幅）
export interface GeometryCache {
  // 同じキーなら同じインスタンス
  acquire(shape: GearShape, size: SizeKey, teeth: number, width?: number): BufferGeometry;
  // 使う所が 0 になったら dispose
  release(shape: GearShape, size: SizeKey, teeth: number, width?: number): void;
  size(): number; // 保持しているキーの数（テスト用）
}

// 厚さを変えられない種類（かさ歯車・ウォーム・ホイール）は width を使わない
function buildGeometry(
  shape: GearShape,
  size: SizeKey,
  teeth: number,
  width: number = GEAR_SIZES[size].faceWidth,
): BufferGeometry {
  switch (shape.kind) {
    case 'spur':
      return buildSpurGeometry(size, teeth, width);
    case 'helical':
      return buildHelicalGeometry(size, teeth, shape.hand, HELIX_ANGLE, width);
    case 'bevel':
      return buildBevelGeometry(size, teeth);
    case 'worm':
      return buildWormGeometry(size);
    case 'wormWheel':
      // 進み角と同じねじれ角の右ねじれのハスバ歯車（のどの凹みは省く。S2-03）
      return buildHelicalGeometry(size, teeth, 'right', WORM_LEAD_ANGLE);
    case 'crossedHelical':
      // ねじれ角 45° の右ねじれ（S2-04）。歯幅 b でのねじれの角度は b / r
      return buildHelicalGeometry(size, teeth, 'right', CROSSED_HELIX_ANGLE, width);
    case 'internal':
      return buildInternalGeometry(size, teeth, width);
    default:
      return assertNever(shape);
  }
}

export function createGeometryCache(): GeometryCache {
  const entries = new Map<string, { geometry: BufferGeometry; refs: number }>();
  return {
    acquire(shape, size, teeth, width) {
      const key = gearShapeKey(shape, size, teeth, width);
      const entry = entries.get(key);
      if (entry !== undefined) {
        entry.refs++;
        return entry.geometry;
      }
      const geometry = buildGeometry(shape, size, teeth, width);
      entries.set(key, { geometry, refs: 1 });
      return geometry;
    },
    release(shape, size, teeth, width) {
      const key = gearShapeKey(shape, size, teeth, width);
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
// （z について鏡映しても z まわりの回転は変わらないので、位相の意味はそのまま。面の向きは three が行列式で反転する）。
// webSide 1 の内歯車（S3-02。形状データはウェブが −z）も反転する
export function gearBodyScaleZ(shape: GearShape): 1 | -1 {
  if (shape.kind === 'bevel' && shape.apex === -1) return -1;
  if (shape.kind === 'internal' && shape.webSide === 1) return -1;
  return 1;
}
