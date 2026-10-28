import type { MeshKind } from '../geometry/can-mesh';
import type { Vec3 } from '../math/vec3';
import type { Axis, GearId, ShaftId } from '../scene/types';

export type { MeshKind } from '../geometry/can-mesh';

// 導出データ（design.md §5）。シーンから resolveLayout で毎回求める

export interface ShaftLayout {
  readonly origin: Vec3;
  readonly axis: Axis;
  // シャフトの原点からの軸方向の範囲（mm）。線分は origin + span × 軸
  readonly span: readonly [number, number];
}

export interface GearLayout {
  readonly center: Vec3;
  readonly axis: Axis;
  readonly pitchRadius: number;
  readonly basePhase: number;
}

export interface Mesh {
  readonly a: GearId;
  readonly b: GearId;
  readonly source: 'tree' | 'contact'; // 木の親子による / 偶然ちょうどの距離にある
  readonly kind: MeshKind; // かみ合いの種類（S2-01）
}

export interface Layout {
  readonly shafts: Readonly<Record<ShaftId, ShaftLayout>>;
  readonly gears: Readonly<Record<GearId, GearLayout>>;
  readonly meshes: readonly Mesh[];
  readonly interferences: ReadonlyArray<readonly [string, string]>; // 干渉している部品の組
}
