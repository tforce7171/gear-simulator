import {
  COLLISION_EPS,
  EMPTY_SHAFT_HALF_LENGTH,
  GEAR_SIZES,
  MESH_DISTANCE_EPS,
  SHAFT_END_MARGIN,
} from '../constants';
import { centerDistance, meshPhase, pitchRadius } from '../geometry/mesh';
import { axisVector, radialDirection } from '../math/axis';
import { add, dot, scale, sub, type Vec3 } from '../math/vec3';
import { gearCenter } from '../scene/gear-center';
import type { Axis, Gear, GearId, Scene, Shaft, ShaftId } from '../scene/types';
import { type Collider, findInterferences, gearCollider } from './collision';
import type { GearLayout, Layout, Mesh, ShaftLayout } from './types';

// 配置の木構造（design.md §5）。根（root・detached のシャフト）から幅優先でたどり、
// mesh のシャフトの位置・向き、歯車の中心・位相、シャフトの span、かみ合い（木の親子と偶然のかみ合い）、
// 干渉の組を求める。検証済みのシーンを前提とし、根から到達できない部品は含めない（例外にしない）

const cache = new WeakMap<Scene, Layout>();

// シーンの参照が同じなら、前回と同じ Layout のオブジェクトを返す
export function resolveLayout(scene: Scene): Layout {
  const hit = cache.get(scene);
  if (hit !== undefined) return hit;
  const layout = compute(scene);
  cache.set(scene, layout);
  return layout;
}

// shaftId とその先（mesh で子孫になる）シャフトの ID を幅優先の順で返す。
// シーンに無いシャフトなら空。循環していても止まる
export function descendantShafts(scene: Scene, shaftId: ShaftId): ShaftId[] {
  if (scene.shafts[shaftId] === undefined) return [];
  const index = indexScene(scene);
  const order: ShaftId[] = [shaftId];
  const seen = new Set<ShaftId>(order);
  for (let head = 0; head < order.length; head++) {
    const current = order[head] as ShaftId;
    for (const parent of index.gearsByShaft.get(current) ?? []) {
      for (const child of index.childShaftsByParentGear.get(parent.id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        order.push(child.id);
      }
    }
  }
  return order;
}

interface SceneIndex {
  readonly gearsByShaft: ReadonlyMap<ShaftId, readonly Gear[]>;
  // 親の歯車 → その外周に生やした mesh のシャフト
  readonly childShaftsByParentGear: ReadonlyMap<GearId, readonly Shaft[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function indexScene(scene: Scene): SceneIndex {
  const gearsByShaft = new Map<ShaftId, Gear[]>();
  for (const gear of Object.values(scene.gears)) push(gearsByShaft, gear.shaftId, gear);
  const childShaftsByParentGear = new Map<GearId, Shaft[]>();
  for (const shaft of Object.values(scene.shafts)) {
    if (shaft.placement.kind === 'mesh') {
      push(childShaftsByParentGear, shaft.placement.parentGearId, shaft);
    }
  }
  return { gearsByShaft, childShaftsByParentGear };
}

interface QueueItem {
  readonly shaftId: ShaftId;
  readonly origin: Vec3;
  readonly axis: Axis;
  // mesh のシャフトの子の歯車とその basePhase（キューに積むときに決める）
  readonly child?: { readonly gearId: GearId; readonly phase: number };
}

function compute(scene: Scene): Layout {
  const index = indexScene(scene);
  const shafts: Record<ShaftId, ShaftLayout> = {};
  const gears: Record<GearId, GearLayout> = {};
  const treePairs: Array<[GearId, GearId]> = [];

  const queue: QueueItem[] = [];
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (p.kind !== 'mesh') queue.push({ shaftId: shaft.id, origin: p.origin, axis: p.axis });
  }

  for (let head = 0; head < queue.length; head++) {
    const item = queue[head] as QueueItem;
    if (shafts[item.shaftId] !== undefined) continue;
    const { shaftId, origin, axis } = item;
    const onShaft = index.gearsByShaft.get(shaftId) ?? [];
    shafts[shaftId] = { origin, axis, span: spanOf(onShaft) };

    for (const gear of onShaft) {
      gears[gear.id] = {
        center: gearCenter(origin, axis, gear),
        axis,
        pitchRadius: pitchRadius(gear.size, gear.teeth),
        basePhase: item.child?.gearId === gear.id ? item.child.phase : 0,
      };
    }

    for (const parent of onShaft) {
      const parentLayout = gears[parent.id] as GearLayout;
      for (const childShaft of index.childShaftsByParentGear.get(parent.id) ?? []) {
        const p = childShaft.placement;
        if (p.kind !== 'mesh' || shafts[childShaft.id] !== undefined) continue;
        const child = scene.gears[p.childGearId];
        if (child === undefined || child.shaftId !== childShaft.id) continue;
        // 親の歯車の負側の面 + 外周の向き × 中心距離（子の offset は 0 として置く）
        const face = add(origin, scale(axisVector(axis), parent.offset));
        const distance = centerDistance(parent.size, parent.teeth, child.teeth);
        treePairs.push(ordered(parent.id, child.id));
        queue.push({
          shaftId: childShaft.id,
          origin: add(face, scale(radialDirection(axis, p.angle), distance)),
          axis,
          child: {
            gearId: child.id,
            phase: meshPhase(parentLayout.basePhase, parent.teeth, child.teeth, p.angle),
          },
        });
      }
    }
  }

  const meshes = meshesOf(scene, gears, treePairs);
  return { shafts, gears, meshes, interferences: interferencesOf(scene, shafts, gears, meshes) };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ordered(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function pairKey(a: string, b: string): string {
  const [x, y] = ordered(a, b);
  return `${x}\u0000${y}`;
}

// 木の辺と、偶然ちょうどの距離にある組（contact）。a < b、一覧は (a, b) の辞書順
function meshesOf(
  scene: Scene,
  gears: Readonly<Record<GearId, GearLayout>>,
  treePairs: ReadonlyArray<readonly [GearId, GearId]>,
): Mesh[] {
  const meshes: Mesh[] = treePairs.map(([a, b]) => ({ a, b, source: 'tree' }));
  const tree = new Set(treePairs.map(([a, b]) => pairKey(a, b)));
  const placed = Object.entries(gears).flatMap(([id, layout]) => {
    const gear = scene.gears[id];
    return gear === undefined ? [] : [{ gear, layout }];
  });
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i] as (typeof placed)[number];
    for (let j = i + 1; j < placed.length; j++) {
      const q = placed[j] as (typeof placed)[number];
      // 数値の判定を先にする（木の組かどうかの文字列のキーは、ちょうどの距離の組だけで作る）
      if (!inContact(p.gear, p.layout, q.gear, q.layout)) continue;
      if (tree.has(pairKey(p.gear.id, q.gear.id))) continue;
      const [a, b] = ordered(p.gear.id, q.gear.id);
      meshes.push({ a, b, source: 'contact' });
    }
  }
  return meshes.sort((m, n) => compare(m.a, n.a) || compare(m.b, n.b));
}

// 同じ大きさ、軸が同じ、別のシャフト、軸方向の区間の重なりが COLLISION_EPS より大きく、
// 軸に垂直な方向の中心間の距離がピッチ円半径の和と MESH_DISTANCE_EPS 以内で一致する
function inContact(a: Gear, la: GearLayout, b: Gear, lb: GearLayout): boolean {
  if (a.size !== b.size || la.axis !== lb.axis || a.shaftId === b.shaftId) return false;
  const w = axisVector(la.axis);
  const d = sub(lb.center, la.center);
  const axial = dot(d, w);
  const faceWidth = GEAR_SIZES[a.size].faceWidth;
  if (faceWidth - Math.abs(axial) <= COLLISION_EPS) return false;
  const radial = Math.sqrt(Math.max(0, dot(d, d) - axial * axial));
  return Math.abs(radial - (la.pitchRadius + lb.pitchRadius)) <= MESH_DISTANCE_EPS;
}

// 全ての歯車の円柱と全てのシャフトの線分（origin + span × 軸）。exempt は meshes の組（contact を含む）
function interferencesOf(
  scene: Scene,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
  gears: Readonly<Record<GearId, GearLayout>>,
  meshes: readonly Mesh[],
): Array<[string, string]> {
  const colliders: Collider[] = [];
  for (const [id, g] of Object.entries(gears)) {
    const gear = scene.gears[id];
    if (gear === undefined) continue;
    colliders.push(gearCollider(id, gear.shaftId, g.center, g.axis, gear.size, gear.teeth));
  }
  for (const [id, s] of Object.entries(shafts)) {
    const w = axisVector(s.axis);
    colliders.push({
      kind: 'segment',
      id,
      start: add(s.origin, scale(w, s.span[0])),
      end: add(s.origin, scale(w, s.span[1])),
    });
  }
  return findInterferences(
    colliders,
    meshes.map((m) => [m.a, m.b] as const),
  );
}

// 載っている歯車の両面（offset と offset + 歯幅）の最小〜最大に、両側 SHAFT_END_MARGIN を足す。
// 歯車が無ければ [−EMPTY_SHAFT_HALF_LENGTH, +EMPTY_SHAFT_HALF_LENGTH]
function spanOf(gears: readonly Gear[]): [number, number] {
  if (gears.length === 0) return [-EMPTY_SHAFT_HALF_LENGTH, EMPTY_SHAFT_HALF_LENGTH];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const gear of gears) {
    lo = Math.min(lo, gear.offset);
    hi = Math.max(hi, gear.offset + GEAR_SIZES[gear.size].faceWidth);
  }
  return [lo - SHAFT_END_MARGIN, hi + SHAFT_END_MARGIN];
}
