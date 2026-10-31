import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  Shape,
} from 'three';
import type { SizeKey } from '../core/scene/types';

// モーターの形（S4-07）。130 型のような円筒の小型 DC モーターを three.js の形の組み合わせで作る。
// ローカルの z がシャフトの軸で、+z がシャフトの側。原点は本体（缶と端の蓋）の中心。
// 干渉・シャフトの範囲には含めない（見た目だけ）

// モーターの部分。材質はテーマの表（render/themes.ts の MOTOR_PART_MATERIALS）で決まる
export type MotorPart = 'body' | 'endCap' | 'terminal' | 'coupling' | 'mark';
export const MOTOR_PARTS: readonly MotorPart[] = ['body', 'endCap', 'terminal', 'coupling', 'mark'];

// 本体の直径（S1-20 の箱の一辺と同じ）と、長さの直径に対する割合
export const MOTOR_DIAMETER: Readonly<Record<SizeKey, number>> = { S: 6, M: 8, L: 11 };
export const MOTOR_LENGTH_RATIO = 1.3;
// シャフトの端とモーターの本体（缶の前の面）のすき間（mm）。軸受けと継手はこの中に出る
export const MOTOR_GAP = 1;

// 直径に対する割合で決める部分の寸法
const FLAT_RATIO = 0.82; // 両脇の平らな面の、中心からの距離（半径に対する割合）
const END_CAP_RATIO = 0.24; // 端の蓋の長さ（直径に対する割合）
const END_CAP_SHRINK = 0.97; // 端の蓋は缶より少しだけ細くし、継ぎ目を見せる
const BEARING_RADIUS_RATIO = 0.2; // 軸受けの半径（直径に対する割合）
const BEARING_LENGTH_RATIO = 0.06; // 軸受けの出っ張り（直径に対する割合。L でも MOTOR_GAP より短い）
const TERMINAL_OUT_RATIO = 0.07; // 端子が端の蓋から出る長さ（直径に対する割合。固定具とのすき間 1 mm より短い）
const TERMINAL_IN_RATIO = 0.03; // 端子が端の蓋に埋まる長さ
const TERMINAL_WIDTH_RATIO = 0.14; // 端子の幅（直径に対する割合）
const TERMINAL_THICKNESS_RATIO = 0.04;
const TERMINAL_X_RATIO = 0.25; // 端子の、中心からの距離（直径に対する割合）
// 継手: シャフトより一回り太い筒。シャフトの端に被さる長さ（直径に対する割合）
const COUPLING_OVERLAP_RATIO = 0.2;
const COUPLING_RADIAL_MARGIN = 0.8; // シャフトの半径に足す（mm）
// 継手の線（単位の継手に対する大きさ。継手の筒は半径 1・長さ 1 の形を scale で伸ばす）
const MARK_WIDTH = 0.4;
const MARK_THICKNESS = 0.24;
const MARK_RADIUS = 0.95; // 線の中心の、軸からの距離（継手の表面から少し出る）
const CURVE_SEGMENTS = 20;

export function motorDiameter(size: SizeKey): number {
  return MOTOR_DIAMETER[size];
}

// 本体（缶と端の蓋）の長さ。軸受け・端子はこの外に少し出る
export function motorLength(size: SizeKey): number {
  return MOTOR_DIAMETER[size] * MOTOR_LENGTH_RATIO;
}

// 継手の半径（シャフトの見た目の半径から）
export function couplingRadius(shaftRadius: number): number {
  return shaftRadius + COUPLING_RADIAL_MARGIN;
}

// 継手の長さ: 軸受けの先から、シャフトの端に被さるところまで
export function couplingLength(size: SizeKey): number {
  const d = MOTOR_DIAMETER[size];
  return MOTOR_GAP - BEARING_LENGTH_RATIO * d + COUPLING_OVERLAP_RATIO * d;
}

// 両脇（ローカルの ±x）を平らに削った円
function flatCircle(radius: number): Shape {
  const flat = radius * FLAT_RATIO;
  const a = Math.acos(FLAT_RATIO);
  const h = radius * Math.sin(a);
  const shape = new Shape();
  shape.moveTo(flat, -h);
  shape.lineTo(flat, h);
  shape.absarc(0, 0, radius, a, Math.PI - a, false);
  shape.lineTo(-flat, -h);
  shape.absarc(0, 0, radius, Math.PI + a, 2 * Math.PI - a, false);
  return shape;
}

// z0 から z0 + depth まで押し出した、両脇の平らな円柱
function flatCylinder(radius: number, z0: number, depth: number): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(flatCircle(radius), {
    depth,
    bevelEnabled: false,
    curveSegments: CURVE_SEGMENTS,
  });
  geometry.translate(0, 0, z0);
  return geometry;
}

// z の向きの円柱（z0 から z0 + length）
function zCylinder(radius: number, z0: number, length: number): BufferGeometry {
  const geometry = new CylinderGeometry(radius, radius, length, CURVE_SEGMENTS);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, z0 + length / 2);
  return geometry;
}

interface SizeGeometries {
  readonly body: BufferGeometry;
  readonly bearing: BufferGeometry;
  readonly endCap: BufferGeometry;
  readonly terminal: BufferGeometry;
}

export interface MotorGeometries {
  of(size: SizeKey): SizeGeometries;
  readonly coupling: BufferGeometry; // 半径 1・長さ 1（z = 0〜1）
  readonly mark: BufferGeometry; // 継手の表面の線（単位の継手に合わせた大きさ）
}

function buildSizeGeometries(size: SizeKey): SizeGeometries {
  const d = MOTOR_DIAMETER[size];
  const r = d / 2;
  const half = motorLength(size) / 2;
  const capLength = END_CAP_RATIO * d;
  const terminalLength = (TERMINAL_OUT_RATIO + TERMINAL_IN_RATIO) * d;
  const terminal = new BoxGeometry(
    TERMINAL_THICKNESS_RATIO * d,
    TERMINAL_WIDTH_RATIO * d,
    terminalLength,
  );
  terminal.translate(0, 0, -half - TERMINAL_OUT_RATIO * d + terminalLength / 2);
  return {
    body: flatCylinder(r, -half + capLength, 2 * half - capLength),
    endCap: flatCylinder(r * END_CAP_SHRINK, -half, capLength),
    bearing: zCylinder(BEARING_RADIUS_RATIO * d, half, BEARING_LENGTH_RATIO * d),
    terminal,
  };
}

// 形状データ（大きさごとに 1 組作り、モーターどうしで共有する）
export function createMotorGeometries(): MotorGeometries {
  const bySize = new Map<SizeKey, SizeGeometries>();
  const coupling = zCylinder(1, 0, 1);
  const mark = new BoxGeometry(MARK_WIDTH, MARK_THICKNESS, 1.04);
  mark.translate(0, MARK_RADIUS, 0.5);
  return {
    of(size) {
      let hit = bySize.get(size);
      if (hit === undefined) {
        hit = buildSizeGeometries(size);
        bySize.set(size, hit);
      }
      return hit;
    },
    coupling,
    mark,
  };
}

export interface MotorModel {
  readonly group: Group; // モーターの中心に置き、u・v・w に合わせる
  readonly housing: Group; // 回らない本体（缶・軸受け・端の蓋・端子）
  readonly spin: Group; // 継手と線。ローカルの z まわりにシャフトと一緒に回す
  readonly meshes: ReadonlyArray<{ readonly part: MotorPart; readonly mesh: Mesh }>;
}

// モーター 1 個の形を組み立てる。材質は呼ぶ側が部分ごとに入れる（meshes の part）
export function buildMotorModel(
  geometries: MotorGeometries,
  size: SizeKey,
  shaftRadius: number,
): MotorModel {
  const g = geometries.of(size);
  const d = MOTOR_DIAMETER[size];
  const meshes: Array<{ part: MotorPart; mesh: Mesh }> = [];
  const add = (parent: Group, part: MotorPart, geometry: BufferGeometry): Mesh => {
    const mesh = new Mesh(geometry);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    meshes.push({ part, mesh });
    return mesh;
  };
  const housing = new Group();
  add(housing, 'body', g.body);
  add(housing, 'body', g.bearing); // 軸受けは缶と同じ金属
  add(housing, 'endCap', g.endCap);
  add(housing, 'terminal', g.terminal).position.x = TERMINAL_X_RATIO * d;
  add(housing, 'terminal', g.terminal).position.x = -TERMINAL_X_RATIO * d;

  const spin = new Group();
  add(spin, 'coupling', geometries.coupling);
  add(spin, 'mark', geometries.mark);
  spin.position.z = motorLength(size) / 2 + BEARING_LENGTH_RATIO * d;
  setCouplingRadius(spin, size, shaftRadius);

  const group = new Group();
  group.add(housing, spin);
  return { group, housing, spin, meshes };
}

// 継手の太さをシャフトの見た目の半径（入れ子の中空軸。S3-03）に合わせる
export function setCouplingRadius(spin: Group, size: SizeKey, shaftRadius: number): void {
  const radius = couplingRadius(shaftRadius);
  spin.scale.set(radius, radius, couplingLength(size));
}
