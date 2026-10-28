import { BoxGeometry, type BufferGeometry, CylinderGeometry } from 'three';

// キャリアの形（S3-03）。遊星のシャフトの数だけ腕のある板。ローカルの原点は板の中心、軸はローカルの z、
// 腕は軸の基底 u・v の面で、角度 α の腕は (cos α, sin α) の向き（遊星のシャフトの angle と同じ）

// 中央のボスの半径と、腕の幅・先の円板の半径（mm）
export const CARRIER_HUB_RADIUS = 6;
export const CARRIER_ARM_WIDTH = 6;
export const CARRIER_PAD_RADIUS = 5;

export interface CarrierShape {
  readonly thickness: number; // 板の厚み（軸方向）
  readonly reach: number; // 腕の長さ（板の中心から遊星のシャフトまで。公転半径）
  readonly angles: readonly number[]; // 腕の向き（キャリアの角度が 0 のとき）
}

// 形を作り直すかの判断に使うキー
export function carrierShapeKey(shape: CarrierShape): string {
  return `${shape.thickness}|${shape.reach.toFixed(6)}|${shape.angles.map((a) => a.toFixed(9)).join(',')}`;
}

// 部品ごとの形状データ（呼び出し側が dispose する）。円柱は rotateX でローカルの z に向ける
export function buildCarrierGeometries(shape: CarrierShape): BufferGeometry[] {
  const { thickness, reach, angles } = shape;
  const out: BufferGeometry[] = [];
  const hub = new CylinderGeometry(CARRIER_HUB_RADIUS, CARRIER_HUB_RADIUS, thickness, 24);
  hub.rotateX(Math.PI / 2);
  out.push(hub);
  for (const angle of angles) {
    if (reach > 0) {
      const arm = new BoxGeometry(reach, CARRIER_ARM_WIDTH, thickness);
      arm.translate(reach / 2, 0, 0);
      arm.rotateZ(angle);
      out.push(arm);
    }
    const pad = new CylinderGeometry(CARRIER_PAD_RADIUS, CARRIER_PAD_RADIUS, thickness, 20);
    pad.rotateX(Math.PI / 2);
    pad.translate(reach * Math.cos(angle), reach * Math.sin(angle), 0);
    out.push(pad);
  }
  return out;
}
