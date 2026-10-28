import type { ShaftLayout } from '../core/layout/types';
import { axisVector } from '../core/math/axis';
import { add, scale, type Vec3 } from '../core/math/vec3';

// 固定具（S3-01）の見た目の配置。固定されたシャフトの負の端に四角い台座（留め具）を描き、
// 台座が床より上にあれば、台座から床まで細い支柱を下ろす（見た目だけ。重力はない）。
// モーター（シャフトの負の端の外側。sync.ts の motorCenter）があれば、台座はさらにその外に置く

// 台座の一辺（軸に垂直な面）と厚み（軸の方向）（mm）
export const ANCHOR_BASE_SIZE = 12;
export const ANCHOR_BASE_THICKNESS = 3;
// 支柱の太さ（半径）と、床の足の一辺・厚み（mm）
export const ANCHOR_PILLAR_RADIUS = 1.2;
export const ANCHOR_FOOT_SIZE = 8;
export const ANCHOR_FOOT_THICKNESS = 1;
// 床の高さ（ワールドの y = 0。renderer の床の平面と同じ）
export const ANCHOR_FLOOR_Y = 0;
// モーターの箱と台座のすき間（mm）
const ANCHOR_MOTOR_GAP = 1;

export interface AnchorFrame {
  // 台座の中心。台座はシャフトの軸に垂直な正方形の板（軸の方向に ANCHOR_BASE_THICKNESS）
  readonly baseCenter: Vec3;
  // 支柱: 台座の下の端から床まで（台座が床より上にあるときだけ）。top と bottom は x・z が同じ
  readonly pillar: { readonly top: Vec3; readonly bottom: Vec3 } | null;
}

// motorBox: そのシャフトのモーターの箱の一辺（無ければ null）。motorGap: シャフトの端とモーターの箱のすき間
export function anchorFrame(
  placed: ShaftLayout,
  motorBox: number | null,
  motorGap: number,
): AnchorFrame {
  // シャフトの端から台座の内側の面まで
  const outside = motorBox === null ? 0 : motorGap + motorBox + ANCHOR_MOTOR_GAP;
  const along = placed.span[0] - outside - ANCHOR_BASE_THICKNESS / 2;
  const baseCenter = add(placed.origin, scale(axisVector(placed.axis), along));
  // 台座の下の端: 縦のシャフトでは板が水平なので厚みの半分、横のシャフトでは板が立つので一辺の半分
  const halfHeight = placed.axis === 'y' ? ANCHOR_BASE_THICKNESS / 2 : ANCHOR_BASE_SIZE / 2;
  const bottomY = baseCenter[1] - halfHeight;
  const pillar =
    bottomY > ANCHOR_FLOOR_Y
      ? {
          top: [baseCenter[0], bottomY, baseCenter[2]] as Vec3,
          bottom: [baseCenter[0], ANCHOR_FLOOR_Y, baseCenter[2]] as Vec3,
        }
      : null;
  return { baseCenter, pillar };
}
