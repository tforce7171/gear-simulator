import { ExtrudeGeometry, Matrix4, type Object3D, Shape, Vector3 } from 'three';
import { GEAR_SIZES, PRESSURE_ANGLE } from '../core/constants';
import { rackHeightRange, rackLength, rackPitch } from '../core/geometry/rack';
import { axisVector } from '../core/math/axis';
import { add, cross, scale, type Vec3 } from '../core/math/vec3';
import type { Axis, SizeKey } from '../core/scene/types';
import { ANCHOR_BASE_SIZE, ANCHOR_BASE_THICKNESS, ANCHOR_FLOOR_Y } from './anchor';

// ラック（S3-04）の形と置き方。ローカルの x が動く向き（direction）、y が歯の向き（normalSign·normal）、
// z が歯幅の方向。原点はピッチ線の中央、歯溝の中心が x = k·π·m（k は整数）。歯形は圧力角 20° の直線歯（台形）。
// 本体は x が [−L/2, L/2] で、本体からはみ出す歯は描かない

// 1 つのラックの形（大きさ、歯数、厚さ）。形状データのキー。厚さ（S4-05）が大きさごとの歯幅と違えば `:w厚さ` を足す
export function rackShapeKey(
  size: SizeKey,
  teeth: number,
  width: number = GEAR_SIZES[size].faceWidth,
): string {
  const base = `rack:${size}:${teeth}`;
  return width === GEAR_SIZES[size].faceWidth ? base : `${base}:w${width}`;
}

// 断面の輪郭（反時計回り）。背 → 歯底 → 歯（右から左）
export function rackOutline(size: SizeKey, teeth: number): Array<readonly [number, number]> {
  const m = GEAR_SIZES[size].module;
  const p = rackPitch(size);
  const half = rackLength(size, teeth) / 2;
  const [back, tip] = rackHeightRange(size);
  const root = -1.25 * m;
  const tan = Math.tan(PRESSURE_ANGLE);
  const tipHalf = p / 4 - tip * tan;
  const rootHalf = p / 4 - root * tan;
  const points: Array<readonly [number, number]> = [
    [-half, back],
    [half, back],
    [half, root],
  ];
  // 歯の中心 (k + 1/2)·p のうち、歯底の幅が本体に収まるもの（右から左へ）
  const kMax = Math.floor((half - rootHalf) / p - 0.5);
  const kMin = Math.ceil((-half + rootHalf) / p - 0.5);
  for (let k = kMax; k >= kMin; k--) {
    const c = (k + 0.5) * p;
    points.push([c + rootHalf, root], [c + tipHalf, tip], [c - tipHalf, tip], [c - rootHalf, root]);
  }
  points.push([-half, root]);
  return points;
}

// 断面を歯幅だけ押し出した形（z は −歯幅/2 〜 歯幅/2）。width は厚さ（S4-05。省けば大きさごとの歯幅）
export function buildRackGeometry(
  size: SizeKey,
  teeth: number,
  width: number = GEAR_SIZES[size].faceWidth,
): ExtrudeGeometry {
  const shape = new Shape();
  const outline = rackOutline(size, teeth);
  outline.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  geometry.computeVertexNormals();
  return geometry;
}

const basis = new Matrix4();

// ローカルの x を direction、y を normalSign·normal に合わせ、position に置く
export function placeRack(
  object: Object3D,
  position: Vec3,
  direction: Axis,
  normal: Axis,
  normalSign: 1 | -1,
): void {
  const x = axisVector(direction);
  const y = scale(axisVector(normal), normalSign);
  const z = cross(x, y);
  basis.makeBasis(
    new Vector3(x[0], x[1], x[2]),
    new Vector3(y[0], y[1], y[2]),
    new Vector3(z[0], z[1], z[2]),
  );
  object.quaternion.setFromRotationMatrix(basis);
  object.position.set(position[0], position[1], position[2]);
}

// ロック中の震え（S1-22 の lockShakeAngle、rad）を、ラックの動く向きのずれ（mm）にする倍率
export const RACK_SHAKE_MM_PER_RAD = 40;

// ラックの固定具の見た目（S3-04）。ラックの背の中央に、背に接する四角い台座（シャフトの固定具と同じ一辺・厚み）を描き、
// 背が下か横を向いていて台座が床より上なら、台座の下の端から床まで支柱を下ろす（背が上を向く＝歯が下向きのラックは、
// 支柱がラックとピニオンを貫くので下ろさない）。center はラックの基準位置の今の位置（rackWorldOrigin）
export function rackAnchorFrame(
  center: Vec3,
  size: SizeKey,
  normal: Axis,
  normalSign: 1 | -1,
): { baseCenter: Vec3; pillar: { top: Vec3; bottom: Vec3 } | null } {
  const [back] = rackHeightRange(size);
  const n = scale(axisVector(normal), normalSign);
  const baseCenter = add(center, scale(n, back - ANCHOR_BASE_THICKNESS / 2));
  const facesUp = normal === 'y' && normalSign === -1;
  if (facesUp) return { baseCenter, pillar: null };
  const halfHeight = normal === 'y' ? ANCHOR_BASE_THICKNESS / 2 : ANCHOR_BASE_SIZE / 2;
  const bottomY = baseCenter[1] - halfHeight;
  if (bottomY <= ANCHOR_FLOOR_Y) return { baseCenter, pillar: null };
  return {
    baseCenter,
    pillar: {
      top: [baseCenter[0], bottomY, baseCenter[2]],
      bottom: [baseCenter[0], ANCHOR_FLOOR_Y, baseCenter[2]],
    },
  };
}
