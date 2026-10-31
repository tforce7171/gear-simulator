import { AXIAL_SNAP, DEFAULT_TEETH, GEAR_SIZES } from '../core/constants';
import { applyCommand, type Command } from '../core/edit/commands';
import { sectionWidth, teethRange } from '../core/geometry/dimensions';
import { skewSign } from '../core/geometry/skew';
import { rackSign } from '../core/kinematics/mesh-coefficients';
import {
  type GrowCandidate,
  isPaletteGearKind,
  listGrowCandidates,
  listRackCandidates,
  type PaletteKind,
} from '../core/layout/candidates';
import { resolveLayout } from '../core/layout/resolve';
import { gearCenter } from '../core/scene/gear-center';
import { assertNever, makeGear, newGearShape } from '../core/scene/gear-shape';
import type { Gear, GearKind, Scene, ShaftId, SizeKey } from '../core/scene/types';
import type { CandidateSpec } from '../render/candidates';

// 歯車を生やす（S1-18）。純粋関数のみ。選んだ歯車の候補を列挙し、候補を編集コマンドに変換する

// 'perimeter' | 'bevel' | 'skew' | 'enclose' | 'planetary' | 'rack' | 'rackPinion'
// （S1-10、S2-02、S2-03、S3-02、S3-03、S3-04。同じ軸の 'coaxial' は S4-03 で廃止し、シャフトの上に置く方式にした）
export type CandidateKind = GrowCandidate['kind'];

// 生やす歯車の大きさと歯数。親と同じ大きさ（同じ大きさ同士しかかみ合わない）で、歯数は DEFAULT_TEETH[大きさ]
export function growSpec(parent: Gear): { size: SizeKey; teeth: number } {
  return { size: parent.size, teeth: DEFAULT_TEETH[parent.size] };
}

// 選択中の歯車の候補。選択が無い・歯車でない（シャフト）なら []
// paletteKind はパレットで選んだ種類（AppState.palette.kind）。この種類の歯車ができる候補だけを出す（S4-02）。
// ラック（S3-04）を選んでいれば、2 つ目以降のピニオンの候補（同じ大きさ・DEFAULT_TEETH の平歯車。
// パレットが平歯車のときだけ）
export function candidatesFor(
  scene: Scene,
  selection: string | null,
  paletteKind: PaletteKind,
): GrowCandidate[] {
  if (selection === null) return [];
  const rack = scene.racks[selection];
  if (rack !== undefined) {
    if (paletteKind !== 'spur') return [];
    return listRackCandidates(scene, rack.id, { perimeterTeeth: DEFAULT_TEETH[rack.size] });
  }
  const parent = scene.gears[selection];
  if (parent === undefined) return [];
  return listGrowCandidates(scene, parent.id, {
    perimeterTeeth: growSpec(parent).teeth,
    kind: paletteKind,
  });
}

// 候補をそのまま growGear のコマンドにする
export function growCommand(candidate: GrowCandidate): Command {
  if (candidate.kind === 'perimeter') {
    return {
      type: 'growGear',
      mode: 'perimeter',
      parentGearId: candidate.parentGearId,
      angle: candidate.angle,
      teeth: candidate.teeth,
    };
  }
  if (candidate.kind === 'bevel') {
    return {
      type: 'growGear',
      mode: 'bevel',
      parentGearId: candidate.parentGearId,
      axisStep: candidate.axisStep,
      side: candidate.side,
    };
  }
  if (candidate.kind === 'enclose') {
    return {
      type: 'growGear',
      mode: 'enclose',
      parentGearId: candidate.parentGearId,
      angle: candidate.angle,
      teeth: candidate.teeth,
    };
  }
  if (candidate.kind === 'planetary') {
    return { type: 'growGear', mode: 'planetary', parentGearId: candidate.parentGearId };
  }
  if (candidate.kind === 'rack') {
    return {
      type: 'growRack',
      gearId: candidate.parentGearId,
      axisStep: candidate.axisStep,
      normalSign: candidate.normalSign,
      teeth: candidate.teeth,
    };
  }
  if (candidate.kind === 'rackPinion') {
    return {
      type: 'growGear',
      mode: 'rack',
      rackId: candidate.rackId,
      position: candidate.position,
      teeth: candidate.teeth,
    };
  }
  if (candidate.kind === 'skew') {
    return {
      type: 'growGear',
      mode: 'skew',
      parentGearId: candidate.parentGearId,
      axisStep: candidate.axisStep,
      side: candidate.side,
      teeth: candidate.teeth,
    };
  }
  return assertNever(candidate);
}

// 候補の仮の歯車の見た目（render/candidates.ts）。外周は親とかみ合う向きに、同じ軸は親と一緒に回す
export function candidateSpec(scene: Scene, candidate: GrowCandidate): CandidateSpec {
  if (candidate.kind === 'rack') {
    // ラック（S3-04）: 仮のラックは止めたまま見せる（ピニオンに合わせて動かすと、回り続けるうちに遠くへ行くため）
    const parent = scene.gears[candidate.parentGearId];
    return {
      shape: { kind: 'spur' },
      size: candidate.size,
      teeth: candidate.teeth,
      center: candidate.center,
      axis: candidate.axis,
      phase: 0,
      followShaftId: parent?.shaftId ?? '',
      followRatio: 0,
      withShaft: false,
      rack: {
        normal: candidate.normal,
        normalSign: candidate.normalSign,
        grooveOffset: candidate.grooveOffset,
      },
    };
  }
  if (candidate.kind === 'rackPinion') {
    // ラックに載せるピニオン（S3-04）: ラックの変位 s に合わせて回す（θ = s / (k·r)）
    const layout = resolveLayout(scene);
    const rack = layout.racks[candidate.rackId];
    const r = (GEAR_SIZES[candidate.size].module * candidate.teeth) / 2;
    const k = rack === undefined ? 1 : rackSign(candidate.axis, rack);
    return {
      shape: candidate.shape,
      size: candidate.size,
      teeth: candidate.teeth,
      center: candidate.center,
      axis: candidate.axis,
      phase: candidate.basePhase,
      followShaftId: '',
      followRatio: 1 / (k * r),
      followRackId: candidate.rackId,
      withShaft: true,
    };
  }
  const common = {
    shape: candidate.shape,
    size: candidate.size,
    teeth: candidate.teeth,
    center: candidate.center,
    axis: candidate.axis,
  };
  const parent = scene.gears[candidate.parentGearId];
  if (parent === undefined) throw new Error(`candidateSpec: no gear ${candidate.parentGearId}`);
  if (candidate.kind === 'planetary') {
    // 遊星歯車機構（S3-03）: リングの輪と遊星を、止めたまま見せる
    return {
      ...common,
      phase: candidate.basePhase,
      followShaftId: parent.shaftId,
      followRatio: 0,
      withShaft: false,
      planets: {
        teeth: candidate.planetTeeth,
        items: candidate.planets.map((p) => ({ center: p.center, phase: p.basePhase })),
      },
    };
  }
  // 外周は −(親の歯数 / 子の歯数)。かさ歯車（S2-02）は apex_親·z·ω_親 + apex_子·z·ω_子 = 0、apex_子 = −side から 親の apex × side。
  // ねじれた位置の組（S2-03）は z_子·ω_子 + s·z_親·ω_親 = 0（s = (e_親 × u)·e_子）から −s·z_親 / z_子。
  // 内歯車の組（S3-02。囲む候補、内歯車の親の内側の候補）は同じ向きに回るので +z_親 / z_子
  const parentLayout = resolveLayout(scene).gears[parent.id];
  const internalPair = candidate.kind === 'enclose' || parent.kind === 'internal';
  const followRatio = internalPair
    ? parent.teeth / candidate.teeth
    : candidate.kind === 'bevel'
      ? (parent.kind === 'bevel' ? parent.apex : 1) * candidate.side
      : candidate.kind === 'skew'
        ? (-(parentLayout === undefined
            ? 0
            : skewSign(parentLayout.axis, parentLayout.center, candidate.axis, candidate.center)) *
            parent.teeth) /
          candidate.teeth
        : -parent.teeth / candidate.teeth;
  return {
    ...common,
    phase: candidate.basePhase,
    followShaftId: parent.shaftId,
    followRatio,
    withShaft: true,
  };
}

// シャフトの上に置く仮の歯車（S4-03）。パレットで選んだ種類・大きさの歯車を、ポインターの位置に合わせて軸に沿って置く
export interface ShaftGhost {
  readonly shaftId: ShaftId;
  readonly kind: GearKind;
  readonly size: SizeKey;
  readonly teeth: number;
  readonly offset: number; // 歯幅の負側の面の位置。AXIAL_SNAP の倍数
  // 同じシャフトのほかの歯車やほかの部品と重なる（コマンドが拒否する）。赤く表示し、置けない
  readonly blocked: boolean;
  readonly command: Command; // growGear（coaxial）
  readonly spec: CandidateSpec; // 見た目（生やす候補と同じ描き方。blocked なら赤）
}

// シャフトの上の位置 along に置く仮の歯車の offset（shaftGhostAt と同じ。ポインターが動くたびに、仮の歯車を
// 作り直すか決めるのに使う）
export function shaftGhostOffset(
  span: readonly [number, number],
  along: number,
  kind: GearKind,
  size: SizeKey,
): number {
  const t = Math.min(Math.max(along, span[0]), span[1]);
  const width = sectionWidth({ kind, size });
  return Math.round((t - width / 2) / AXIAL_SNAP) * AXIAL_SNAP + 0;
}

// シャフトの上の位置 along（シャフトの原点から軸方向。mm）に、パレットの種類・大きさの歯車を置くときの仮の歯車。
// 歯車の中心が along に来るように offset を AXIAL_SNAP の倍数に丸める。along はシャフトの範囲に収める（ポインターが
// 仮の歯車の上にあるあいだ、シャフトの端より先へ追いかけていかないように）。
// 歯数は DEFAULT_TEETH[大きさ] を種類の範囲に収めたもの（ウォームは 1 条、内歯車は INTERNAL_MIN_TEETH 以上）。
// パレットがラック・遊星（歯車の種類でない）・シャフトが無い・置かれていなければ null
export function shaftGhostAt(
  scene: Scene,
  shaftId: ShaftId,
  along: number,
  paletteSize: SizeKey,
  paletteKind: PaletteKind,
): ShaftGhost | null {
  if (!isPaletteGearKind(paletteKind) || !Number.isFinite(along)) return null;
  const placed = resolveLayout(scene).shafts[shaftId];
  if (placed === undefined) return null;
  const kind = paletteKind;
  const size = paletteSize;
  const range = teethRange(kind, size);
  const teeth = Math.min(Math.max(DEFAULT_TEETH[size], range.min), range.max);
  const offset = shaftGhostOffset(placed.span, along, kind, size);
  const command: Command = {
    type: 'growGear',
    mode: 'coaxial',
    shaftId,
    offset,
    size,
    teeth,
    kind,
  };
  const result = applyCommand(scene, command, { ids: () => '__ghost_gear' });
  if (!result.ok && result.error.code !== 'notAllowed') return null;
  const shape = newGearShape(kind);
  const gear = makeGear({ id: '__ghost_gear', shaftId, size, teeth, offset }, shape);
  return {
    shaftId,
    kind,
    size,
    teeth,
    offset,
    blocked: !result.ok,
    command,
    spec: {
      shape,
      size,
      teeth: gear.teeth,
      center: gearCenter(placed.origin, placed.axis, gear),
      axis: placed.axis,
      phase: 0,
      followShaftId: shaftId,
      followRatio: 1,
      withShaft: false,
      blocked: !result.ok,
    },
  };
}
