import { PERIMETER_CANDIDATE_COUNT } from '../core/constants';
import { applyCommand, type Command } from '../core/edit/commands';
import { canMesh } from '../core/geometry/can-mesh';
import { newInterferences } from '../core/layout/interference-diff';
import { descendantShafts, resolveLayout } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import { createSequentialIdGenerator } from '../core/scene/ids';
import type { GearId, Scene, ShaftId } from '../core/scene/types';

// 浮いた（detached）シャフトの付け直し（S1-19）。純粋関数のみ。
// 動かすシャフトとその先に含まれない歯車 G について、動かすシャフトに G とかみ合える歯車 c（canMesh。同じ大きさで種類と形が合う。S2-01）があれば、
// G の外周の 8 方向（S1-10 の外周の候補の角度）に c を付けた位置を候補にする。
// 付け直したシーンで新たな干渉ができるものと、循環になるもの（G が動かすシャフトかその先にある）は除く

export interface ReattachCandidate {
  parentGearId: GearId; // G
  childGearId: GearId; // 動かすシャフト上の c
  angle: number; // G の軸まわりの角度
  childCenter: Vec3; // 付け直した後の c の中心（表示とポインターの判定に使う）
}

// 候補を reattachShaft のコマンドにする
export function reattachCommand(
  shaftId: ShaftId,
  candidate: ReattachCandidate,
): Extract<Command, { type: 'reattachShaft' }> {
  return {
    type: 'reattachShaft',
    shaftId,
    childGearId: candidate.childGearId,
    parentGearId: candidate.parentGearId,
    angle: candidate.angle,
  };
}

// 候補を付け直したシーン。付け直せなければ null
export function applyReattach(
  scene: Scene,
  shaftId: ShaftId,
  candidate: ReattachCandidate,
): Scene | null {
  const result = applyCommand(scene, reattachCommand(shaftId, candidate), {
    ids: createSequentialIdGenerator(),
  });
  return result.ok ? result.scene : null;
}

// detached のシャフト shaftId を付け直せる候補。detached でなければ []。
// 並びは G の ID の昇順 → c の ID の昇順 → 角度の昇順
export function reattachCandidates(
  scene: Scene,
  layout: Layout,
  shaftId: ShaftId,
): ReattachCandidate[] {
  if (scene.shafts[shaftId]?.placement.kind !== 'detached') return [];
  const moving = new Set(descendantShafts(scene, shaftId));
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const children = Object.values(scene.gears)
    .filter((g) => g.shaftId === shaftId)
    .sort(byId);
  const parents = Object.values(scene.gears)
    .filter((g) => !moving.has(g.shaftId) && layout.gears[g.id] !== undefined)
    .sort(byId);
  const candidates: ReattachCandidate[] = [];
  for (const parent of parents) {
    for (const child of children) {
      if (!canMesh(child, parent)) continue;
      for (let k = 0; k < PERIMETER_CANDIDATE_COUNT; k++) {
        const angle = (k * 2 * Math.PI) / PERIMETER_CANDIDATE_COUNT;
        const base = { parentGearId: parent.id, childGearId: child.id, angle };
        const next = applyReattach(scene, shaftId, { ...base, childCenter: [0, 0, 0] });
        if (next === null) continue;
        const nextLayout = resolveLayout(next);
        if (newInterferences(layout, nextLayout).length > 0) continue;
        const childCenter = nextLayout.gears[child.id]?.center;
        if (childCenter === undefined) continue;
        candidates.push({ ...base, childCenter });
      }
    }
  }
  return candidates;
}
