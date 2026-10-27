import { GEAR_SIZES, PERIMETER_CANDIDATE_COUNT } from '../constants';
import type { Vec3 } from '../math/vec3';
import type { Axis, Gear, GearId, Scene, Shaft, ShaftId, SizeKey } from '../scene/types';
import { resolveLayout } from './resolve';

// 生やす候補の列挙（要件 §6、design.md §5）。選んだ歯車について、
// 外周の候補（新しい mesh のシャフトを作る。親の軸まわりの 8 方向）と、
// 同じ軸の候補（選んだ歯車のシャフトに通す。歯車の並びの両端の外側）を返す。
// 候補を足した仮のシーンを resolveLayout し、新しく増えた干渉の組があるものは除く

export interface GrowSpec {
  perimeterTeeth: number; // 外周の新しい歯車の歯数（大きさは親と同じ）
  coaxialSize: SizeKey; // 同じ軸の新しい歯車の大きさ
  coaxialTeeth: number; // 同じ軸の新しい歯車の歯数
}

export type GrowCandidate =
  | {
      kind: 'perimeter';
      parentGearId: GearId;
      angle: number; // 親の軸まわり（rad）。k·π/4
      size: SizeKey; // 親と同じ
      teeth: number;
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

  // 仮のシーンを resolveLayout し、新しく増えた干渉の組が無ければ新しい歯車のレイアウトを返す。
  // 新しい組は必ず新しい部品か伸びたシャフトを含む（それ以外の部品の位置と形は変わらないため）
  const tryPlace = (tentative: Scene) => {
    const result = resolveLayout(tentative);
    for (const [a, b] of result.interferences) {
      if (!baseInterferences.has(pairKey(a, b))) return null;
    }
    return result.gears[tempGearId] ?? null;
  };

  const candidates: GrowCandidate[] = [];

  for (let k = 0; k < PERIMETER_CANDIDATE_COUNT; k++) {
    const angle = (k * 2 * Math.PI) / PERIMETER_CANDIDATE_COUNT;
    const shaft: Shaft = {
      id: tempShaftId,
      placement: { kind: 'mesh', parentGearId: gearId, childGearId: tempGearId, angle },
    };
    const child: Gear = {
      id: tempGearId,
      kind: 'spur',
      shaftId: tempShaftId,
      size: parent.size,
      teeth: spec.perimeterTeeth,
      offset: 0,
    };
    const placed = tryPlace(withParts(scene, shaft, child));
    if (placed === null) continue;
    candidates.push({
      kind: 'perimeter',
      parentGearId: gearId,
      angle,
      size: parent.size,
      teeth: spec.perimeterTeeth,
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
    const child: Gear = {
      id: tempGearId,
      kind: 'spur',
      shaftId: parent.shaftId,
      size: spec.coaxialSize,
      teeth: spec.coaxialTeeth,
      offset,
    };
    const placed = tryPlace(withParts(scene, null, child));
    if (placed === null) continue;
    candidates.push({
      kind: 'coaxial',
      shaftId: parent.shaftId,
      offset,
      size: spec.coaxialSize,
      teeth: spec.coaxialTeeth,
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

// 入力のシーンは変えずに、部品を足した新しいシーンを作る
function withParts(scene: Scene, shaft: Shaft | null, gear: Gear): Scene {
  return {
    shafts: shaft === null ? scene.shafts : { ...scene.shafts, [shaft.id]: shaft },
    gears: { ...scene.gears, [gear.id]: gear },
    motors: scene.motors,
  };
}

function pairKey(a: string, b: string): string {
  // ID に含まれない区切り（NUL）でつなぐ
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
