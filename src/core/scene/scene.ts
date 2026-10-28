import { assertNever } from './gear-shape';
import type { Anchor, Carrier, CarrierId, PlanetPlacement, Scene, Shaft, ShaftId } from './types';

export function emptyScene(): Scene {
  return { shafts: {}, gears: {}, motors: {}, anchors: {}, carriers: {} };
}

// シャフトを固定している固定具（S3-01）。無ければ null
export function anchorOfShaft(scene: Scene, shaftId: ShaftId): Anchor | null {
  for (const anchor of Object.values(scene.anchors)) {
    if (anchor.target.kind === 'shaft' && anchor.target.id === shaftId) return anchor;
  }
  return null;
}

// 固定されているシャフト（シーンにあるものだけ）の ID の集合（S3-01）
export function anchoredShaftIds(scene: Scene): Set<ShaftId> {
  const ids = new Set<ShaftId>();
  for (const anchor of Object.values(scene.anchors)) {
    if (anchor.target.kind === 'shaft' && scene.shafts[anchor.target.id] !== undefined) {
      ids.add(anchor.target.id);
    }
  }
  return ids;
}

// 遊星歯車（S3-03）の部品の関係

// キャリアに載った遊星のシャフト。キャリアの角度が 0 のときの角度の昇順（同じなら ID の昇順）
export function planetShaftsOf(scene: Scene, carrierId: CarrierId): Shaft[] {
  const list: Array<Shaft & { readonly placement: PlanetPlacement }> = [];
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (p.kind === 'planet' && p.carrierId === carrierId) list.push({ ...shaft, placement: p });
  }
  return list
    .sort((a, b) => a.placement.angle - b.placement.angle || compareIds(a.id, b.id))
    .map((s) => scene.shafts[s.id] as Shaft);
}

// 遊星のシャフトのキャリア。遊星のシャフトでなければ null
export function carrierOfPlanetShaft(scene: Scene, shaftId: ShaftId): Carrier | null {
  const p = scene.shafts[shaftId]?.placement;
  if (p?.kind !== 'planet') return null;
  return scene.carriers[p.carrierId] ?? null;
}

// シャフトに載ったキャリア（ID の昇順）
export function carriersOnShaft(scene: Scene, shaftId: ShaftId): Carrier[] {
  return Object.values(scene.carriers)
    .filter((c) => c.shaftId === shaftId)
    .sort((a, b) => compareIds(a.id, b.id));
}

// 同じ線上のシャフト（concentric の配置）を親へたどった先のシャフト（線の根）。
// concentric でないシャフトは自分自身。循環・参照切れは null
export function lineRootOf(scene: Scene, shaftId: ShaftId): ShaftId | null {
  const visited = new Set<ShaftId>();
  let current: ShaftId = shaftId;
  for (;;) {
    if (visited.has(current)) return null;
    visited.add(current);
    const p = scene.shafts[current]?.placement;
    if (p === undefined) return null;
    if (p.kind !== 'concentric') return current;
    current = p.parentShaftId;
  }
}

// 配置が位置を頼るシャフト（親）。mesh・bevel・skew は親の歯車のシャフト、planet は親の歯車のシャフトと
// キャリアのシャフト、concentric は親のシャフト、root・detached は無い。参照切れは含めない
export function placementParentShafts(scene: Scene, shaftId: ShaftId): ShaftId[] {
  const p = scene.shafts[shaftId]?.placement;
  if (p === undefined) return [];
  switch (p.kind) {
    case 'root':
    case 'detached':
      return [];
    case 'concentric':
      return scene.shafts[p.parentShaftId] === undefined ? [] : [p.parentShaftId];
    case 'mesh':
    case 'bevel':
    case 'skew':
    case 'planet': {
      const out: ShaftId[] = [];
      const parent = scene.gears[p.parentGearId];
      if (parent !== undefined) out.push(parent.shaftId);
      if (p.kind === 'planet') {
        const carrier = scene.carriers[p.carrierId];
        if (carrier !== undefined && !out.includes(carrier.shaftId)) out.push(carrier.shaftId);
      }
      return out;
    }
    default:
      return assertNever(p);
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
