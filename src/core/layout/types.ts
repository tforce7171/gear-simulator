import type { MeshKind } from '../geometry/can-mesh';
import type { Vec3 } from '../math/vec3';
import type { Axis, CarrierId, GearId, ShaftId } from '../scene/types';

export type { MeshKind } from '../geometry/can-mesh';

// 導出データ（design.md §5）。シーンから resolveLayout で毎回求める

export interface ShaftLayout {
  readonly origin: Vec3;
  readonly axis: Axis;
  // シャフトの原点からの軸方向の範囲（mm）。線分は origin + span × 軸
  readonly span: readonly [number, number];
  // 遊星のシャフト（S3-03）。origin は基準配置（すべてのキャリアの角度が 0）の位置で、実際の位置は
  // キャリアのシャフトの回転角だけ、center を通るキャリアの軸まわりに回したもの（shaftWorldOrigin）
  readonly orbit?: Orbit;
}

// 公転（S3-03）。center はキャリアの軸の上の点（キャリアのシャフトの原点）
export interface Orbit {
  readonly carrierId: CarrierId;
  readonly carrierShaftId: ShaftId;
  readonly center: Vec3;
}

// キャリア（S3-03）。center は板の中心、radius は板の腕の半径（公転半径 + 余白）、
// planetShaftIds は遊星のシャフト（キャリアの角度が 0 のときの角度の昇順）
export interface CarrierLayout {
  readonly center: Vec3;
  readonly axis: Axis;
  readonly radius: number;
  readonly planetShaftIds: readonly ShaftId[];
}

export interface GearLayout {
  readonly center: Vec3;
  readonly axis: Axis;
  readonly pitchRadius: number;
  readonly basePhase: number;
  readonly orbit?: Orbit; // 遊星のシャフトに載った歯車（S3-03）。center は基準配置の位置
}

export interface Mesh {
  readonly a: GearId;
  readonly b: GearId;
  readonly source: 'tree' | 'contact'; // 木の親子による / 偶然ちょうどの距離にある
  readonly kind: MeshKind; // かみ合いの種類（S2-01）
  // 遊星のシャフトの歯車がかかわるかみ合い（S3-03）の、キャリアのシャフト。拘束はこのシャフトの ω を引いた
  // 相対値で書く（ウィリスの式。design.md §6）
  readonly carrierShaftId?: ShaftId;
}

export interface Layout {
  readonly shafts: Readonly<Record<ShaftId, ShaftLayout>>;
  readonly gears: Readonly<Record<GearId, GearLayout>>;
  readonly carriers: Readonly<Record<CarrierId, CarrierLayout>>; // S3-03
  readonly meshes: readonly Mesh[];
  readonly interferences: ReadonlyArray<readonly [string, string]>; // 干渉している部品の組
}
