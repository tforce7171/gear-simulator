import { DEFAULT_TEETH } from '../core/constants';
import type { Command } from '../core/edit/commands';
import { type GrowCandidate, listGrowCandidates } from '../core/layout/candidates';
import type { Gear, GearKind, Scene, SizeKey } from '../core/scene/types';
import type { CandidateSpec } from '../render/candidates';

// 歯車を生やす（S1-18）。純粋関数のみ。選んだ歯車の候補を列挙し、候補を編集コマンドに変換する

export type CandidateKind = GrowCandidate['kind']; // 'perimeter' | 'coaxial'（S1-10）

// 生やす歯車の大きさと歯数。外周は親と同じ大きさ（同じ大きさ同士しかかみ合わない）、
// 同じ軸はパレットで選んでいる大きさ。歯数はどちらも DEFAULT_TEETH[大きさ]
export function growSpec(
  parent: Gear,
  kind: CandidateKind,
  paletteSize: SizeKey,
): { size: SizeKey; teeth: number } {
  const size = kind === 'perimeter' ? parent.size : paletteSize;
  return { size, teeth: DEFAULT_TEETH[size] };
}

// 選択中の歯車の候補。選択が無い・歯車でない（シャフト）なら []
// coaxialKind は同じ軸に作る歯車の種類（S2-01。パレットで種類を選ぶ UI は S2-05。それまで呼び出し側は 'spur'）
export function candidatesFor(
  scene: Scene,
  selection: string | null,
  paletteSize: SizeKey,
  coaxialKind: GearKind,
): GrowCandidate[] {
  if (selection === null) return [];
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
  return {
    ...common,
    phase: candidate.basePhase,
    followShaftId: parent.shaftId,
    followRatio: -parent.teeth / candidate.teeth,
    withShaft: true,
  };
}
