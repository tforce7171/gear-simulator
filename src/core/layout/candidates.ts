import {
  DEFAULT_PLANET_COUNT,
  GEAR_SIZES,
  INTERNAL_MIN_TEETH,
  INTERNAL_MIN_TOOTH_DIFF,
  PERIMETER_CANDIDATE_COUNT,
  RACK_DEFAULT_TEETH,
  WORM_THREADS,
} from '../constants';
import { defaultPlanetTeeth } from '../geometry/planetary';
import { rackEndMargin, rackLength, rackPitch, snapRackPosition } from '../geometry/rack';
import type { Vec3 } from '../math/vec3';
import {
  assertNever,
  GEAR_KIND_LIST,
  gearShape,
  internalEncloseShape,
  makeGear,
  meshPartnerShape,
  newGearShape,
  skewPartnerShape,
} from '../scene/gear-shape';
import { withPlanetary } from '../scene/planetary';
import type {
  Axis,
  Gear,
  GearId,
  GearKind,
  GearShape,
  Rack,
  RackId,
  Scene,
  Shaft,
  SizeKey,
} from '../scene/types';
import { resolveAddition, resolveLayout } from './resolve';

// 生やす候補の列挙（要件 §6、design.md §5）。選んだ歯車について、
// 外周の候補（新しい mesh のシャフトを作る。親の軸まわりの 8 方向）を返す。外周の子は親とかみ合う形（ハスバ歯車なら逆の hand）。
// 同じ軸の両端の候補は S4-03 で廃止した（シャフトの上の好きな位置に、パレットで選んだ種類を置く。growGear の coaxial）。
// かさ歯車の親（S2-02）は外周の代わりに、直交する 2 軸 × 2 方向の 4 か所のかさ歯車（新しい bevel のシャフト）を返す。
// ウォーム・ホイールの親（S2-03）は外周の代わりに、ねじれた位置の 2 軸 × 2 方向の 4 か所に相手（skewPartnerShape。
// ウォームにはホイール、ホイールにはウォーム）を載せた新しい skew のシャフトを返す。
// 候補を足した仮のシーン（resolveAddition で、全体を解き直さずに求める）で新しく増えた干渉の組があるものは除く。
// S4-02 から、候補はパレットで選んだ種類（spec.kind）の歯車ができるものだけを出す（candidateKind が spec.kind のもの）

// パレットの「生やす歯車の種類」（S4-02）。歯車の種類（GearKind）に、ラックと遊星歯車機構を足したもの。
// ラック・遊星は歯車の種類ではない（ラックは別の部品、遊星はキャリア・遊星・リングの組）ので GearKind には足さない
export type PaletteKind = GearKind | 'rack' | 'planetary';

// パレットの種類の並び（S4-02）: 歯車の種類（GEAR_KIND_LIST の順）→ ラック → 遊星
export const PALETTE_KIND_LIST: readonly PaletteKind[] = [...GEAR_KIND_LIST, 'rack', 'planetary'];

export function isPaletteGearKind(kind: PaletteKind): kind is GearKind {
  return kind !== 'rack' && kind !== 'planetary';
}

export interface GrowSpec {
  perimeterTeeth: number; // 外周の新しい歯車の歯数（大きさは親と同じ）
  // パレットで選んだ種類（S4-02）。この種類の歯車ができる候補だけを出す
  kind: PaletteKind;
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
      // 平歯車の親を太陽とする遊星歯車機構（S3-03）。キャリア・遊星 DEFAULT_PLANET_COUNT 個・リングを 1 つのコマンドで作る。
      // 表示はリング（中心・位相）と遊星（planets）
      kind: 'planetary';
      parentGearId: GearId;
      size: SizeKey; // 親と同じ
      teeth: number; // リングの歯数 z_r
      planetTeeth: number; // 遊星の歯数 z_p
      shape: GearShape; // リングの形 { kind: 'internal', webSide: −1 }
      center: Vec3; // リングの中心
      axis: Axis;
      basePhase: number; // リングの位相
      planets: ReadonlyArray<{ readonly center: Vec3; readonly basePhase: number }>;
    }
  | {
      // 平歯車をピニオンにしたラック（S3-04）。同じ大きさ・RACK_DEFAULT_TEETH 歯で、中央でピニオンにかみ合う。
      // center はラックの基準位置、axis は動く向き（direction）
      kind: 'rack';
      parentGearId: GearId;
      axisStep: 1 | 2;
      normalSign: 1 | -1;
      size: SizeKey;
      teeth: number; // ラックの歯数
      center: Vec3;
      axis: Axis;
      normal: Axis;
      width: Axis;
      length: number;
      grooveOffset: number;
    }
  | {
      // ラックに載せる 2 つ目以降のピニオン（S3-04）。新しい 'rack' のシャフトの平歯車（同じ大きさ・spec.perimeterTeeth 歯）
      kind: 'rackPinion';
      rackId: RackId;
      position: number; // π·m の整数倍
      size: SizeKey;
      teeth: number;
      shape: GearShape; // { kind: 'spur' }
      center: Vec3;
      axis: Axis;
      basePhase: number;
    };

export function listGrowCandidates(scene: Scene, gearId: GearId, spec: GrowSpec): GrowCandidate[] {
  const parent = scene.gears[gearId];
  if (parent === undefined) throw new Error(`listGrowCandidates: no gear ${gearId}`);
  assertTeeth(parent.size, spec.perimeterTeeth);

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
  // 遊星のシャフトの歯車（S3-03）からは候補を出さない（段付きの遊星は、シャフトの上に置く。S4-03）
  const orbiting = scene.shafts[parent.shaftId]?.placement.kind === 'planet';
  const meshShape = orbiting ? null : meshPartnerShape(gearShape(parent));
  const perimeterShape = meshShape?.kind === spec.kind ? meshShape : null;
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

  // 平歯車の親を囲む内歯車（S3-02）: k·π/4 の向きを順に試し、干渉の増えない最初の 1 つ。
  // パレットで内歯車を選んでいるとき（spec.kind が 'internal'）だけ出す（いつも出すと、親を覆う大きなリングの
  // 候補が、親をつかんで回す操作や外周の候補のクリックを奪うため。ピッキングでは候補が歯車より優先される）
  const encloseShape =
    spec.kind === 'internal' && !orbiting ? internalEncloseShape(gearShape(parent)) : null;
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

  // 遊星歯車機構（S3-03）: 平歯車の親を太陽にする。機構を足した仮のシーン全体を解き、新しい干渉が無ければ出す。
  // パレットで遊星を選んでいるときだけ（S4-02）
  const planetary =
    orbiting || spec.kind !== 'planetary'
      ? null
      : planetaryCandidate(scene, parent, baseInterferences);
  if (planetary !== null) candidates.push(planetary);

  // ラック（S3-04）: 平歯車の親に、axisStep 1 → 2、それぞれ normalSign −1 → 1 の 4 か所。
  // パレットでラックを選んでいるときだけ（S4-02）
  if (parent.kind === 'spur' && !orbiting && spec.kind === 'rack') {
    candidates.push(...rackCandidates(scene, parent, baseInterferences));
  }

  // かさ歯車の親: axisStep 1 → 2、それぞれ side −1 → 1 の 4 か所（パレットがかさ歯車のとき。S4-02）
  if (parent.kind === 'bevel' && !orbiting && spec.kind === 'bevel') {
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

  // ウォーム・ホイールの親: axisStep 1 → 2、それぞれ side −1 → 1 の 4 か所（パレットが相手の種類のとき。S4-02）
  const skewShape = orbiting ? null : skewPartnerShape(gearShape(parent));
  if (skewShape !== null && skewShape.kind === spec.kind) {
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

  return candidates;
}

// 候補を置くとできる歯車の種類（S4-02）。パレットの種類と比べる
export function candidateKind(candidate: GrowCandidate): PaletteKind {
  switch (candidate.kind) {
    case 'planetary':
      return 'planetary';
    case 'rack':
      return 'rack';
    case 'rackPinion':
    case 'perimeter':
    case 'bevel':
    case 'skew':
    case 'enclose':
      return candidate.shape.kind;
    default:
      return assertNever(candidate);
  }
}

// 選んだ部品とかみ合う向きに生やせる種類（S4-02）。パレットの種類がこの中に無ければ、外周などの候補は出ず
// シャフトの上に置くことだけができる（S4-03。パレットの注記に使う）。並びは PALETTE_KIND_LIST の順。
// 平歯車: 平歯車（外周）・内歯車（囲む）・ラック・遊星。内歯車: 平歯車（内側の外周）。ハスバ歯車: ハスバ歯車（逆の hand）。
// かさ歯車: かさ歯車。ウォーム: ホイール。ホイール: ウォーム。ねじ歯車: ねじ歯車。ラック: 平歯車（2 つ目以降のピニオン）。
// 遊星のシャフトの歯車（S3-03）は同じ軸だけなので []。歯車・ラックでない ID・根からたどれない部品も []
export function meshableKinds(scene: Scene, partId: string): PaletteKind[] {
  if (scene.racks[partId] !== undefined) return ['spur'];
  const gear = scene.gears[partId];
  if (gear === undefined) return [];
  if (scene.shafts[gear.shaftId]?.placement.kind === 'planet') return [];
  const shape = gearShape(gear);
  const kinds = new Set<PaletteKind>();
  const mesh = meshPartnerShape(shape);
  if (mesh !== null) kinds.add(mesh.kind);
  const skew = skewPartnerShape(shape);
  if (skew !== null) kinds.add(skew.kind);
  if (gear.kind === 'bevel') kinds.add('bevel');
  if (internalEncloseShape(shape) !== null) kinds.add('internal');
  if (gear.kind === 'spur') {
    kinds.add('rack');
    kinds.add('planetary');
  }
  return PALETTE_KIND_LIST.filter((k) => kinds.has(k));
}

// ラックの候補（S3-04）。ラックを足した仮のシーン全体を解き、新しい干渉の無いもの
function rackCandidates(
  scene: Scene,
  pinion: Gear,
  baseInterferences: ReadonlySet<string>,
): GrowCandidate[] {
  const rackId = unusedId(scene.racks, '__candidate_rack');
  const out: GrowCandidate[] = [];
  for (const axisStep of [1, 2] as const) {
    for (const normalSign of [-1, 1] as const) {
      const rack: Rack = {
        id: rackId,
        size: pinion.size,
        teeth: RACK_DEFAULT_TEETH,
        placement: { kind: 'pinion', gearId: pinion.id, axisStep, normalSign },
      };
      const layout = resolveLayout({ ...scene, racks: { ...scene.racks, [rackId]: rack } });
      const at = layout.racks[rackId];
      if (at === undefined) continue;
      if (layout.interferences.some(([a, b]) => !baseInterferences.has(pairKey(a, b)))) continue;
      out.push({
        kind: 'rack',
        parentGearId: pinion.id,
        axisStep,
        normalSign,
        size: pinion.size,
        teeth: RACK_DEFAULT_TEETH,
        center: at.origin,
        axis: at.direction,
        normal: at.normal,
        width: at.width,
        length: at.length,
        grooveOffset: at.grooveOffset,
      });
    }
  }
  return out;
}

// ラックを選んだときの候補（S3-04）: 2 つ目以降のピニオン。すでにかみ合っているピニオンの位置から両側（負 → 正）へ、
// 新しい干渉の無い最初の position（π·m の整数倍）を 1 つずつ。ピニオンは同じ大きさ・spec.perimeterTeeth 歯の平歯車。
// どのピニオンとも s の範囲が残る（位置の差が L − 2·余白 以下）ところまで探す
export function listRackCandidates(
  scene: Scene,
  rackId: RackId,
  spec: Pick<GrowSpec, 'perimeterTeeth'>,
): GrowCandidate[] {
  const rack = scene.racks[rackId];
  if (rack === undefined) throw new Error(`listRackCandidates: no rack ${rackId}`);
  assertTeeth(rack.size, spec.perimeterTeeth);
  const layout = resolveLayout(scene);
  if (layout.racks[rackId] === undefined) return [];
  const baseInterferences = new Set(layout.interferences.map(([a, b]) => pairKey(a, b)));
  const positions = layout.rackMeshes.filter((m) => m.rack === rackId).map((m) => m.position);
  const pitch = rackPitch(rack.size);
  const span = rackLength(rack.size, rack.teeth) - 2 * rackEndMargin(rack.size);
  const lo = positions.length === 0 ? 0 : Math.min(...positions);
  const hi = positions.length === 0 ? 0 : Math.max(...positions);
  const shaftId = unusedId(scene.shafts, '__candidate_shaft');
  const gearId = unusedId(scene.gears, '__candidate_gear');

  const tryAt = (position: number): GrowCandidate | null => {
    const shaft: Shaft = {
      id: shaftId,
      placement: { kind: 'rack', rackId, childGearId: gearId, position },
    };
    const gear = makeGear(
      { id: gearId, shaftId, size: rack.size, teeth: spec.perimeterTeeth, offset: 0 },
      newGearShape('spur'),
    );
    const next = resolveLayout({
      ...scene,
      shafts: { ...scene.shafts, [shaftId]: shaft },
      gears: { ...scene.gears, [gearId]: gear },
    });
    const placed = next.gears[gearId];
    if (placed === undefined) return null;
    if (next.interferences.some(([a, b]) => !baseInterferences.has(pairKey(a, b)))) return null;
    return {
      kind: 'rackPinion',
      rackId,
      position,
      size: rack.size,
      teeth: spec.perimeterTeeth,
      shape: { kind: 'spur' },
      center: placed.center,
      axis: placed.axis,
      basePhase: placed.basePhase,
    };
  };

  const out: GrowCandidate[] = [];
  const eps = 1e-9 * pitch;
  // 負の側: min(p) から下へ（max(p) − 位置 ≤ span）。正の側: max(p) から上へ（位置 − min(p) ≤ span）
  for (const sign of [-1, 1] as const) {
    const start = snapRackPosition(rack.size, sign === 1 ? hi : lo);
    for (let k = positions.length === 0 && sign === 1 ? 0 : 1; ; k++) {
      const position = start + sign * k * pitch + 0;
      if (sign === 1 ? position - lo > span + eps : hi - position > span + eps) break;
      const found = tryAt(position);
      if (found !== null) {
        out.push(found);
        break;
      }
    }
  }
  return out;
}

// 遊星歯車機構の候補（S3-03）。平歯車の親で、歯数の組（defaultPlanetTeeth）があり、機構を足しても新しい干渉が無いとき
function planetaryCandidate(
  scene: Scene,
  sun: Gear,
  baseInterferences: ReadonlySet<string>,
): GrowCandidate | null {
  if (sun.kind !== 'spur') return null;
  const teeth = defaultPlanetTeeth(sun, DEFAULT_PLANET_COUNT);
  if (teeth === null) return null;
  const shaftIds = scene.shafts;
  const ids = {
    carrierShaftId: unusedId(shaftIds, '__candidate_carrier_shaft'),
    carrierId: unusedId(scene.carriers, '__candidate_carrier'),
    planets: Array.from({ length: DEFAULT_PLANET_COUNT }, (_, k) => ({
      shaftId: unusedId(shaftIds, `__candidate_planet_shaft_${k}`),
      gearId: unusedId(scene.gears, `__candidate_planet_${k}`),
    })),
    ringShaftId: unusedId(shaftIds, '__candidate_ring_shaft'),
    ringId: unusedId(scene.gears, '__candidate_ring'),
  };
  const layout = resolveLayout(withPlanetary(scene, sun, ids, teeth));
  for (const [a, b] of layout.interferences) {
    if (!baseInterferences.has(pairKey(a, b))) return null;
  }
  const ring = layout.gears[ids.ringId];
  if (ring === undefined) return null;
  const planets: Array<{ center: Vec3; basePhase: number }> = [];
  for (const p of ids.planets) {
    const g = layout.gears[p.gearId];
    if (g === undefined) return null;
    planets.push({ center: g.center, basePhase: g.basePhase });
  }
  return {
    kind: 'planetary',
    parentGearId: sun.id,
    size: sun.size,
    teeth: teeth.zr,
    planetTeeth: teeth.zp,
    shape: { kind: 'internal', webSide: -1 },
    center: ring.center,
    axis: ring.axis,
    basePhase: ring.basePhase,
    planets,
  };
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
