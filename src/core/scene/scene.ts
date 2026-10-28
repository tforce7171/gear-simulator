import { stepAxis } from '../math/axis';
import { assertNever } from './gear-shape';
import type {
  Anchor,
  Axis,
  Carrier,
  CarrierId,
  GearId,
  PlanetPlacement,
  Rack,
  RackId,
  Scene,
  Shaft,
  ShaftId,
} from './types';

export function emptyScene(): Scene {
  return { shafts: {}, gears: {}, motors: {}, anchors: {}, carriers: {}, racks: {} };
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

// ラックを固定している固定具（S3-04）。無ければ null
export function anchorOfRack(scene: Scene, rackId: RackId): Anchor | null {
  for (const anchor of Object.values(scene.anchors)) {
    if (anchor.target.kind === 'rack' && anchor.target.id === rackId) return anchor;
  }
  return null;
}

// 固定されているラック（シーンにあるものだけ）の ID の集合（S3-04）
export function anchoredRackIds(scene: Scene): Set<RackId> {
  const ids = new Set<RackId>();
  for (const anchor of Object.values(scene.anchors)) {
    if (anchor.target.kind === 'rack' && scene.racks[anchor.target.id] !== undefined) {
      ids.add(anchor.target.id);
    }
  }
  return ids;
}

// ラック（S3-04）の部品の関係

// ラックの向き（動く向き direction、歯が向く軸 normal とその向き、歯幅の方向 width）。pinion はピニオンのシャフトの向き
// から導く（width = ピニオンの軸、direction = それを axisStep 回進めた軸、normal = 残りの軸）。参照切れ・循環は null
export function rackFrame(
  scene: Scene,
  rackId: RackId,
  axisOf: (shaftId: ShaftId) => Axis | null,
): { direction: Axis; normal: Axis; normalSign: 1 | -1; width: Axis } | null {
  const rack = scene.racks[rackId];
  if (rack === undefined) return null;
  const p = rack.placement;
  if (p.kind === 'detached') {
    if (p.direction === p.normal) return null;
    return {
      direction: p.direction,
      normal: p.normal,
      normalSign: p.normalSign,
      width: remainingAxis(p.direction, p.normal),
    };
  }
  const pinion = scene.gears[p.gearId];
  if (pinion === undefined) return null;
  const width = axisOf(pinion.shaftId);
  if (width === null) return null;
  const direction = stepAxis(width, p.axisStep);
  return {
    direction,
    normal: remainingAxis(width, direction),
    normalSign: p.normalSign,
    width,
  };
}

// ラックに載った 2 つ目以降のピニオンのシャフト（'rack' の配置。S3-04）。ID の昇順
export function rackShaftsOf(scene: Scene, rackId: RackId): Shaft[] {
  return Object.values(scene.shafts)
    .filter((s) => s.placement.kind === 'rack' && s.placement.rackId === rackId)
    .sort((a, b) => compareIds(a.id, b.id));
}

// 歯車をピニオンにして置いたラック（pinion の配置。S3-04）。ID の昇順
export function racksOfPinion(scene: Scene, gearId: GearId): Rack[] {
  return Object.values(scene.racks)
    .filter((r) => r.placement.kind === 'pinion' && r.placement.gearId === gearId)
    .sort((a, b) => compareIds(a.id, b.id));
}

function remainingAxis(a: Axis, b: Axis): Axis {
  for (const axis of ['x', 'y', 'z'] as const) if (axis !== a && axis !== b) return axis;
  return a;
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
// キャリアのシャフト、concentric は親のシャフト、rack（S3-04）はラックのピニオンのシャフト（浮いたラックなら無い）、
// root・detached は無い。参照切れは含めない
export function placementParentShafts(scene: Scene, shaftId: ShaftId): ShaftId[] {
  const p = scene.shafts[shaftId]?.placement;
  if (p === undefined) return [];
  switch (p.kind) {
    case 'root':
    case 'detached':
      return [];
    case 'concentric':
      return scene.shafts[p.parentShaftId] === undefined ? [] : [p.parentShaftId];
    case 'rack': {
      const rp = scene.racks[p.rackId]?.placement;
      if (rp?.kind !== 'pinion') return [];
      const pinion = scene.gears[rp.gearId];
      return pinion === undefined || scene.shafts[pinion.shaftId] === undefined
        ? []
        : [pinion.shaftId];
    }
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
