import { GEAR_SIZES, PERIMETER_CANDIDATE_COUNT } from '../constants';
import type { Vec3 } from '../math/vec3';
import { gearShape, makeGear, meshPartnerShape, newGearShape } from '../scene/gear-shape';
import type {
  Axis,
  Gear,
  GearId,
  GearKind,
  GearShape,
  Scene,
  Shaft,
  ShaftId,
  SizeKey,
} from '../scene/types';
import { resolveAddition, resolveLayout } from './resolve';

// 生やす候補の列挙（要件 §6、design.md §5）。選んだ歯車について、
// 外周の候補（新しい mesh のシャフトを作る。親の軸まわりの 8 方向）と、
// 同じ軸の候補（選んだ歯車のシャフトに通す。歯車の並びの両端の外側）を返す。
// 外周の子は親とかみ合う形（ハスバ歯車なら逆の hand）、同じ軸は spec.coaxialKind の歯車（S2-01）。
// 候補を足した仮のシーン（resolveAddition で、全体を解き直さずに求める）で新しく増えた干渉の組があるものは除く

export interface GrowSpec {
  perimeterTeeth: number; // 外周の新しい歯車の歯数（大きさは親と同じ）
  coaxialSize: SizeKey; // 同じ軸の新しい歯車の大きさ
  coaxialTeeth: number; // 同じ軸の新しい歯車の歯数
  coaxialKind: GearKind; // 同じ軸の新しい歯車の種類（S2-01。ハスバ歯車は hand 'right'）
}

export type GrowCandidate =
  | {
      kind: 'perimeter';
      parentGearId: GearId;
      angle: number; // 親の軸まわり（rad）。k·π/4
      size: SizeKey; // 親と同じ
      teeth: number;
      shape: GearShape; // 親とかみ合う形（平歯車は平歯車、ハスバ歯車は逆の hand。S2-01）
      center: Vec3; // 新しい歯車の中心（仮の表示用）
      axis: Axis;
      basePhase: number; // 新しい歯車の位相（仮の表示を正しくかみ合わせて見せる用）
    }
  | {
      kind: 'coaxial';
      shaftId: ShaftId;
      offset: number; // 歯幅の負側の面の位置。AXIAL_SNAP の倍数
      size: SizeKey;
      teeth: number;
      shape: GearShape; // newGearShape(spec.coaxialKind)
      center: Vec3;
      axis: Axis;
    };

export function listGrowCandidates(scene: Scene, gearId: GearId, spec: GrowSpec): GrowCandidate[] {
  const parent = scene.gears[gearId];
  if (parent === undefined) throw new Error(`listGrowCandidates: no gear ${gearId}`);
  assertTeeth(parent.size, spec.perimeterTeeth);
  assertTeeth(spec.coaxialSize, spec.coaxialTeeth);

  const layout = resolveLayout(scene);
  if (layout.gears[gearId] === undefined) return [];
  const baseInterferences = new Set(layout.interferences.map(([a, b]) => pairKey(a, b)));

  const tempGearId = unusedId(scene.gears, '__candidate_gear');
  const tempShaftId = unusedId(scene.shafts, '__candidate_shaft');

  // 仮のシーン（選んだシーンに歯車と、外周ならシャフトを足したもの）で、新しく増えた干渉の組が無ければ
  // 新しい歯車のレイアウトを返す。新しい組は必ず新しい部品か伸びたシャフトを含む（それ以外の部品の位置と形は変わらないため）
  // ので、それらを含む組だけを resolveAddition で求める（全体を resolveLayout し直すと、候補ごとに全ての組を調べ直して遅い）
  const tryPlace = (shaft: Shaft | null, gear: Gear) => {
    const result = resolveAddition(scene, layout, shaft, gear);
    if (result === null) return null;
    for (const [a, b] of result.interferences) {
      if (!baseInterferences.has(pairKey(a, b))) return null;
    }
    return result.gear;
  };

  const candidates: GrowCandidate[] = [];
  const perimeterShape = meshPartnerShape(gearShape(parent));
  const coaxialShape = newGearShape(spec.coaxialKind);

  for (let k = 0; k < PERIMETER_CANDIDATE_COUNT; k++) {
    const angle = (k * 2 * Math.PI) / PERIMETER_CANDIDATE_COUNT;
    const shaft: Shaft = {
      id: tempShaftId,
      placement: { kind: 'mesh', parentGearId: gearId, childGearId: tempGearId, angle },
    };
    const child = makeGear(
      {
        id: tempGearId,
        shaftId: tempShaftId,
        size: parent.size,
        teeth: spec.perimeterTeeth,
        offset: 0,
      },
      perimeterShape,
    );
    const placed = tryPlace(shaft, child);
    if (placed === null) continue;
    candidates.push({
      kind: 'perimeter',
      parentGearId: gearId,
      angle,
      size: parent.size,
      teeth: spec.perimeterTeeth,
      shape: perimeterShape,
      center: placed.center,
      axis: placed.axis,
      basePhase: placed.basePhase,
    });
  }

  // 選んだ歯車のシャフトに載った歯車の並びの、最小と最大の面
  let minFace = Number.POSITIVE_INFINITY;
  let maxFace = Number.NEGATIVE_INFINITY;
  for (const g of Object.values(scene.gears)) {
    if (g.shaftId !== parent.shaftId) continue;
    minFace = Math.min(minFace, g.offset);
    maxFace = Math.max(maxFace, g.offset + GEAR_SIZES[g.size].faceWidth);
  }
  const width = GEAR_SIZES[spec.coaxialSize].faceWidth;
  for (const offset of [minFace - width, maxFace]) {
    const child = makeGear(
      {
        id: tempGearId,
        shaftId: parent.shaftId,
        size: spec.coaxialSize,
        teeth: spec.coaxialTeeth,
        offset,
      },
      coaxialShape,
    );
    const placed = tryPlace(null, child);
    if (placed === null) continue;
    candidates.push({
      kind: 'coaxial',
      shaftId: parent.shaftId,
      offset,
      size: spec.coaxialSize,
      teeth: spec.coaxialTeeth,
      shape: coaxialShape,
      center: placed.center,
      axis: placed.axis,
    });
  }

  return candidates;
}

function assertTeeth(size: SizeKey, teeth: number): void {
  const { minTeeth, maxTeeth } = GEAR_SIZES[size];
  if (!Number.isInteger(teeth) || teeth < minTeeth || teeth > maxTeeth) {
    throw new Error(`listGrowCandidates: teeth ${teeth} out of range for size ${size}`);
  }
}

// 既存の ID と重ならない仮の ID
function unusedId(existing: Readonly<Record<string, unknown>>, base: string): string {
  let id = base;
  for (let i = 1; Object.hasOwn(existing, id); i++) id = `${base}_${i}`;
  return id;
}

function pairKey(a: string, b: string): string {
  // ID に含まれない区切り（NUL）でつなぐ
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
