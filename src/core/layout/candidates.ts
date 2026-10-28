import {
  GEAR_SIZES,
  INTERNAL_MIN_TEETH,
  INTERNAL_MIN_TOOTH_DIFF,
  PERIMETER_CANDIDATE_COUNT,
  WORM_THREADS,
} from '../constants';
import { axialExtent, teethRange } from '../geometry/dimensions';
import type { Vec3 } from '../math/vec3';
import {
  gearShape,
  internalEncloseShape,
  makeGear,
  meshPartnerShape,
  newGearShape,
  skewPartnerShape,
} from '../scene/gear-shape';
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
// かさ歯車の親（S2-02）は外周の代わりに、直交する 2 軸 × 2 方向の 4 か所のかさ歯車（新しい bevel のシャフト）を返す。
// ウォーム・ホイールの親（S2-03）は外周の代わりに、ねじれた位置の 2 軸 × 2 方向の 4 か所に相手（skewPartnerShape。
// ウォームにはホイール、ホイールにはウォーム）を載せた新しい skew のシャフトを返す。
// 候補を足した仮のシーン（resolveAddition で、全体を解き直さずに求める）で新しく増えた干渉の組があるものは除く

export interface GrowSpec {
  perimeterTeeth: number; // 外周の新しい歯車の歯数（大きさは親と同じ）
  coaxialSize: SizeKey; // 同じ軸の新しい歯車の大きさ
  coaxialTeeth: number; // 同じ軸の新しい歯車の歯数
  coaxialKind: GearKind; // 同じ軸の新しい歯車の種類（S2-01。ハスバ歯車は hand 'right'。ウォームは歯数によらず 1 条）
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
      kind: 'bevel'; // かさ歯車の親とかみ合う、直交する軸のかさ歯車（S2-02）
      parentGearId: GearId;
      axisStep: 1 | 2; // 新しいシャフトの軸 = 親の軸を axisStep 回進めた軸
      side: 1 | -1;
      size: SizeKey; // 親と同じ
      teeth: number; // 親と同じ（歯数比 1:1）
      shape: GearShape; // { kind: 'bevel', apex: −side }
      center: Vec3;
      axis: Axis;
      basePhase: number;
    }
  | {
      kind: 'skew'; // ねじれた位置の 90° でかみ合う相手（S2-03。ウォームにはホイール、ホイールにはウォーム）
      parentGearId: GearId;
      axisStep: 1 | 2; // 新しいシャフトの軸 = 親の軸を axisStep 回進めた軸
      side: 1 | -1;
      size: SizeKey; // 親と同じ
      teeth: number; // ホイールは spec.perimeterTeeth、ウォームは WORM_THREADS
      shape: GearShape; // skewPartnerShape(親の形)
      center: Vec3;
      axis: Axis;
      basePhase: number;
    }
  | {
      kind: 'enclose'; // 平歯車の親を囲む内歯車（S3-02）。新しい mesh のシャフト。内歯車の中心は親から angle の向きに R − r
      parentGearId: GearId;
      angle: number; // 親の軸まわり（rad）。k·π/4 のうち、干渉の増えない最初の向き
      size: SizeKey; // 親と同じ
      teeth: number; // 2 × 親の歯数を max(INTERNAL_MIN_TEETH, 親の歯数 + INTERNAL_MIN_TOOTH_DIFF) 〜 大きさの最大に収めたもの
      shape: GearShape; // { kind: 'internal', webSide: −1 }
      center: Vec3;
      axis: Axis;
      basePhase: number;
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
  // 内歯車の親（S3-02）の内側の子は、歯数差の条件を満たすように歯数を下げる（大きさの最小を下回るなら出さない）
  const perimeterTeeth =
    parent.kind === 'internal'
      ? Math.min(spec.perimeterTeeth, parent.teeth - INTERNAL_MIN_TOOTH_DIFF)
      : spec.perimeterTeeth;
  const perimeterOk = perimeterTeeth >= GEAR_SIZES[parent.size].minTeeth;

  for (let k = 0; perimeterShape !== null && perimeterOk && k < PERIMETER_CANDIDATE_COUNT; k++) {
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
        teeth: perimeterTeeth,
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
      teeth: perimeterTeeth,
      shape: perimeterShape,
      center: placed.center,
      axis: placed.axis,
      basePhase: placed.basePhase,
    });
  }

  // 平歯車の親を囲む内歯車（S3-02）: k·π/4 の向きを順に試し、干渉の増えない最初の 1 つ
  const encloseShape = internalEncloseShape(gearShape(parent));
  const encloseTeeth = encloseTeethOf(parent);
  for (let k = 0; encloseShape !== null && encloseTeeth !== null; k++) {
    if (k >= PERIMETER_CANDIDATE_COUNT) break;
    const angle = (k * 2 * Math.PI) / PERIMETER_CANDIDATE_COUNT;
    const shaft: Shaft = {
      id: tempShaftId,
      placement: { kind: 'mesh', parentGearId: gearId, childGearId: tempGearId, angle },
    };
    const child = makeGear(
      { id: tempGearId, shaftId: tempShaftId, size: parent.size, teeth: encloseTeeth, offset: 0 },
      encloseShape,
    );
    const placed = tryPlace(shaft, child);
    if (placed === null) continue;
    candidates.push({
      kind: 'enclose',
      parentGearId: gearId,
      angle,
      size: parent.size,
      teeth: encloseTeeth,
      shape: encloseShape,
      center: placed.center,
      axis: placed.axis,
      basePhase: placed.basePhase,
    });
    break;
  }

  // かさ歯車の親: axisStep 1 → 2、それぞれ side −1 → 1 の 4 か所
  if (parent.kind === 'bevel') {
    for (const axisStep of [1, 2] as const) {
      for (const side of [-1, 1] as const) {
        const shaft: Shaft = {
          id: tempShaftId,
          placement: {
            kind: 'bevel',
            parentGearId: gearId,
            childGearId: tempGearId,
            axisStep,
            side,
          },
        };
        const shape: GearShape = { kind: 'bevel', apex: side === 1 ? -1 : 1 };
        const child = makeGear(
          {
            id: tempGearId,
            shaftId: tempShaftId,
            size: parent.size,
            teeth: parent.teeth,
            offset: 0,
          },
          shape,
        );
        const placed = tryPlace(shaft, child);
        if (placed === null) continue;
        candidates.push({
          kind: 'bevel',
          parentGearId: gearId,
          axisStep,
          side,
          size: parent.size,
          teeth: parent.teeth,
          shape,
          center: placed.center,
          axis: placed.axis,
          basePhase: placed.basePhase,
        });
      }
    }
  }

  // ウォーム・ホイールの親: axisStep 1 → 2、それぞれ side −1 → 1 の 4 か所
  const skewShape = skewPartnerShape(gearShape(parent));
  if (skewShape !== null) {
    const teeth = skewShape.kind === 'worm' ? WORM_THREADS : spec.perimeterTeeth;
    for (const axisStep of [1, 2] as const) {
      for (const side of [-1, 1] as const) {
        const shaft: Shaft = {
          id: tempShaftId,
          placement: {
            kind: 'skew',
            parentGearId: gearId,
            childGearId: tempGearId,
            axisStep,
            side,
          },
        };
        const child = makeGear(
          { id: tempGearId, shaftId: tempShaftId, size: parent.size, teeth, offset: 0 },
          skewShape,
        );
        const placed = tryPlace(shaft, child);
        if (placed === null) continue;
        candidates.push({
          kind: 'skew',
          parentGearId: gearId,
          axisStep,
          side,
          size: parent.size,
          teeth,
          shape: skewShape,
          center: placed.center,
          axis: placed.axis,
          basePhase: placed.basePhase,
        });
      }
    }
  }

  // 選んだ歯車のシャフトに載った歯車の並びの、最小と最大の面（区画の両端。ウォームは区画の幅。S2-03。
  // 内歯車はウェブまで含めた全体。S3-02）
  let minFace = Number.POSITIVE_INFINITY;
  let maxFace = Number.NEGATIVE_INFINITY;
  for (const g of Object.values(scene.gears)) {
    if (g.shaftId !== parent.shaftId) continue;
    const [lo, hi] = axialExtent(g);
    minFace = Math.min(minFace, lo);
    maxFace = Math.max(maxFace, hi);
  }
  // 新しい歯車の歯数は種類の範囲に収める（ウォームは 1 条、内歯車は INTERNAL_MIN_TEETH 以上。S3-02）
  const coaxialRange = teethRange(spec.coaxialKind, spec.coaxialSize);
  const coaxialTeeth = Math.min(Math.max(spec.coaxialTeeth, coaxialRange.min), coaxialRange.max);
  // 新しい歯車が offset からどれだけの範囲を占めるか（内歯車はウェブの側に伸びる）
  const [extentLo, extentHi] = axialExtent(
    makeGear(
      {
        id: tempGearId,
        shaftId: parent.shaftId,
        size: spec.coaxialSize,
        teeth: coaxialTeeth,
        offset: 0,
      },
      coaxialShape,
    ),
  );
  for (const offset of [minFace - extentHi, maxFace - extentLo]) {
    const child = makeGear(
      {
        id: tempGearId,
        shaftId: parent.shaftId,
        size: spec.coaxialSize,
        teeth: coaxialTeeth,
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
      teeth: coaxialTeeth,
      shape: coaxialShape,
      center: placed.center,
      axis: placed.axis,
    });
  }

  return candidates;
}

// 平歯車を囲む内歯車の歯数（S3-02）。2 × 親の歯数を、max(INTERNAL_MIN_TEETH, 親 + INTERNAL_MIN_TOOTH_DIFF) 以上・
// 大きさの最大以下に収める。収まらなければ null
function encloseTeethOf(parent: Gear): number | null {
  const min = Math.max(INTERNAL_MIN_TEETH, parent.teeth + INTERNAL_MIN_TOOTH_DIFF);
  const max = GEAR_SIZES[parent.size].maxTeeth;
  if (min > max) return null;
  return Math.min(Math.max(2 * parent.teeth, min), max);
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
