import { DEFAULT_TEETH, GEAR_SIZES } from '../core/constants';
import type { Command } from '../core/edit/commands';
import { skewSign } from '../core/geometry/skew';
import { rackSign } from '../core/kinematics/mesh-coefficients';
import {
  type GrowCandidate,
  listGrowCandidates,
  listRackCandidates,
} from '../core/layout/candidates';
import { resolveLayout } from '../core/layout/resolve';
import type { Gear, GearKind, Scene, SizeKey } from '../core/scene/types';
import type { CandidateSpec } from '../render/candidates';

// 歯車を生やす（S1-18）。純粋関数のみ。選んだ歯車の候補を列挙し、候補を編集コマンドに変換する

// 'perimeter' | 'bevel' | 'skew' | 'enclose' | 'planetary' | 'rack' | 'rackPinion' | 'coaxial'
// （S1-10、S2-02、S2-03、S3-02、S3-03、S3-04）
export type CandidateKind = GrowCandidate['kind'];

// 生やす歯車の大きさと歯数。外周は親と同じ大きさ（同じ大きさ同士しかかみ合わない）、
// 同じ軸はパレットで選んでいる大きさ。歯数はどちらも DEFAULT_TEETH[大きさ]
export function growSpec(
  parent: Gear,
  kind: CandidateKind,
  paletteSize: SizeKey,
): { size: SizeKey; teeth: number } {
  const size = kind === 'coaxial' ? paletteSize : parent.size;
  return { size, teeth: DEFAULT_TEETH[size] };
}

// 選択中の歯車の候補。選択が無い・歯車でない（シャフト）なら []
// coaxialKind は同じ軸に作る歯車の種類（S2-01。S2-05 からパレットで選んだ種類 AppState.palette.kind）。
// ラック（S3-04）を選んでいれば、2 つ目以降のピニオンの候補（同じ大きさ・DEFAULT_TEETH の平歯車）
export function candidatesFor(
  scene: Scene,
  selection: string | null,
  paletteSize: SizeKey,
  coaxialKind: GearKind,
): GrowCandidate[] {
  if (selection === null) return [];
  const rack = scene.racks[selection];
  if (rack !== undefined) {
    return listRackCandidates(scene, rack.id, { perimeterTeeth: DEFAULT_TEETH[rack.size] });
  }
  const parent = scene.gears[selection];
  if (parent === undefined) return [];
  const coaxial = growSpec(parent, 'coaxial', paletteSize);
  return listGrowCandidates(scene, parent.id, {
    perimeterTeeth: growSpec(parent, 'perimeter', paletteSize).teeth,
    coaxialSize: coaxial.size,
    coaxialTeeth: coaxial.teeth,
    coaxialKind,
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
  return {
    type: 'growGear',
    mode: 'coaxial',
    shaftId: candidate.shaftId,
    offset: candidate.offset,
    size: candidate.size,
    teeth: candidate.teeth,
    kind: candidate.shape.kind,
  };
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
  if (candidate.kind === 'coaxial') {
    return {
      ...common,
      phase: 0,
      followShaftId: candidate.shaftId,
      followRatio: 1,
      withShaft: false,
    };
  }
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
