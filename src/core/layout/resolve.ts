import {
  BEVEL_APEX_CLEARANCE,
  COLLISION_EPS,
  EMPTY_SHAFT_HALF_LENGTH,
  GEAR_SIZES,
  MESH_DISTANCE_EPS,
  SHAFT_END_MARGIN,
} from '../constants';
import {
  bevelApexOf,
  bevelBigEndOf,
  bevelChildFrame,
  bevelChildOrigin,
  bevelCollisionCylinder,
  bevelPhase,
} from '../geometry/bevel';
import { canMesh, meshKindOf } from '../geometry/can-mesh';
import { centerDistance, meshPhase, pitchRadius } from '../geometry/mesh';
import { axisVector, radialDirection } from '../math/axis';
import { add, dot, length, scale, sub, type Vec3 } from '../math/vec3';
import { gearCenter } from '../scene/gear-center';
import {
  type Axis,
  type ChildPlacement,
  type Gear,
  type GearId,
  isChildPlacement,
  type Scene,
  type Shaft,
  type ShaftId,
} from '../scene/types';
import { type Collider, findInterferences, gearCollider, interferingWith } from './collision';
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
  // 親の歯車 → それを親に持つ mesh・bevel のシャフト
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
    if (isChildPlacement(shaft.placement)) {
      push(childShaftsByParentGear, shaft.placement.parentGearId, shaft);
    }
  }
  return { gearsByShaft, childShaftsByParentGear };
}

interface QueueItem {
  readonly shaftId: ShaftId;
  readonly origin: Vec3;
  readonly axis: Axis;
  // mesh・bevel のシャフトの子の歯車とその basePhase（キューに積むときに決める）
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
    if (!isChildPlacement(p)) queue.push({ shaftId: shaft.id, origin: p.origin, axis: p.axis });
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
        if (!isChildPlacement(p) || shafts[childShaft.id] !== undefined) continue;
        const child = scene.gears[p.childGearId];
        if (child === undefined || child.shaftId !== childShaft.id) continue;
        const placed = placeChild(parent, origin, parentLayout, p, child);
        if (placed === null) continue;
        treePairs.push(ordered(parent.id, child.id));
        queue.push({
          shaftId: childShaft.id,
          origin: placed.origin,
          axis: placed.axis,
          child: { gearId: child.id, phase: placed.phase },
        });
      }
    }
  }

  const meshes = meshesOf(scene, gears, treePairs);
  return { shafts, gears, meshes, interferences: interferencesOf(scene, shafts, gears, meshes) };
}

// 木の子のシャフトの原点・向きと、子の歯車の basePhase（子の offset は 0 として置く）。
// mesh: 親の歯車の負側の面 + 外周の向き × 中心距離、向きは親と同じ。
// bevel（S2-02）: 子の大端の中心 = 親の大端の中心 + R·side·(子の軸) + R·親の apex·(親の軸)、
// 子の軸 = 親の軸を axisStep 回進めたもの、原点 = 子の大端の中心 − (歯幅/2)·(1 + side)·(子の軸)。
// 親子の種類が配置に合わなければ null（検証済みのシーンでは起きない）
function placeChild(
  parent: Gear,
  parentShaftOrigin: Vec3,
  parentLayout: GearLayout,
  p: ChildPlacement,
  child: Gear,
): { origin: Vec3; axis: Axis; phase: number } | null {
  const axis = parentLayout.axis;
  switch (p.kind) {
    case 'mesh': {
      const face = add(parentShaftOrigin, scale(axisVector(axis), parent.offset));
      const distance = centerDistance(parent.size, parent.teeth, child.teeth);
      return {
        origin: add(face, scale(radialDirection(axis, p.angle), distance)),
        axis,
        phase: meshPhase(parentLayout.basePhase, parent.teeth, child.teeth, p.angle),
      };
    }
    case 'bevel': {
      if (parent.kind !== 'bevel') return null;
      const bigEnd = bevelBigEndOf(parentLayout.center, axis, parent);
      const frame = bevelChildFrame(
        bigEnd,
        axis,
        parent.apex,
        parentLayout.pitchRadius,
        p.axisStep,
        p.side,
      );
      return {
        origin: bevelChildOrigin(
          frame.bigEnd,
          frame.axis,
          p.side,
          GEAR_SIZES[child.size].faceWidth,
        ),
        axis: frame.axis,
        phase: bevelPhase(
          parentLayout.basePhase,
          { axis, bigEnd },
          { axis: frame.axis, bigEnd: frame.bigEnd },
          parent.teeth,
        ),
      };
    }
  }
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

// 木の辺と、偶然ちょうどの距離にある組（contact）。a < b、一覧は (a, b) の辞書順。
// contact の組は、軸に垂直な距離がピッチ円半径の和 + MESH_DISTANCE_EPS 以下、軸方向の距離が歯幅未満なので、
// 中心の x の差は「両方の（ピッチ円半径 + 歯幅）の和 + MESH_DISTANCE_EPS」以下になる。
// 中心の x で並べ、x の差がその上限を超えたら打ち切る（sweep and prune。全ての組を調べるより速い）
function meshesOf(
  scene: Scene,
  gears: Readonly<Record<GearId, GearLayout>>,
  treePairs: ReadonlyArray<readonly [GearId, GearId]>,
): Mesh[] {
  const meshes: Mesh[] = treePairs.map(([a, b]) => ({
    a,
    b,
    source: 'tree',
    kind: meshKindOf(scene.gears[a] as Gear),
  }));
  const tree = new Set(treePairs.map(([a, b]) => pairKey(a, b)));
  const placed: Array<{ gear: Gear; layout: GearLayout; reach: number }> = [];
  let maxReach = 0;
  for (const [id, layout] of Object.entries(gears)) {
    const gear = scene.gears[id];
    if (gear === undefined) continue;
    const reach = layout.pitchRadius + GEAR_SIZES[gear.size].faceWidth;
    maxReach = Math.max(maxReach, reach);
    placed.push({ gear, layout, reach });
  }
  placed.sort((p, q) => p.layout.center[0] - q.layout.center[0]);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i] as (typeof placed)[number];
    const limit = p.layout.center[0] + p.reach + maxReach + MESH_DISTANCE_EPS;
    for (let j = i + 1; j < placed.length; j++) {
      const q = placed[j] as (typeof placed)[number];
      if (q.layout.center[0] > limit) break;
      // 数値の判定を先にする（木の組かどうかの文字列のキーは、ちょうどの距離の組だけで作る）
      if (!inContact(p.gear, p.layout, q.gear, q.layout)) continue;
      if (tree.has(pairKey(p.gear.id, q.gear.id))) continue;
      const [a, b] = ordered(p.gear.id, q.gear.id);
      meshes.push({ a, b, source: 'contact', kind: meshKindOf(p.gear) });
    }
  }
  return meshes.sort((m, n) => compare(m.a, n.a) || compare(m.b, n.b));
}

// かみ合える組（canMesh。同じ大きさで、平歯車同士かねじれの向きが逆のハスバ歯車同士）、軸が同じ、別のシャフト、
// 軸方向の区間の重なりが COLLISION_EPS より大きく、軸に垂直な方向の中心間の距離がピッチ円半径の和と
// MESH_DISTANCE_EPS 以内で一致する。安い数値の判定を先に、canMesh を最後にする。
// かさ歯車（S2-02）は、どちらもかさ歯車、同じ大きさ・同じ歯数、軸が直交、頂点の距離が MESH_DISTANCE_EPS 以内
function inContact(a: Gear, la: GearLayout, b: Gear, lb: GearLayout): boolean {
  if (a.size !== b.size || a.shaftId === b.shaftId) return false;
  if (a.kind === 'bevel' || b.kind === 'bevel') {
    if (a.kind !== 'bevel' || b.kind !== 'bevel') return false;
    if (a.teeth !== b.teeth || la.axis === lb.axis) return false;
    const d = sub(bevelApexOf(la.center, la.axis, a), bevelApexOf(lb.center, lb.axis, b));
    return length(d) <= MESH_DISTANCE_EPS;
  }
  if (la.axis !== lb.axis) return false;
  const w = axisVector(la.axis);
  const d = sub(lb.center, la.center);
  const axial = dot(d, w);
  const faceWidth = GEAR_SIZES[a.size].faceWidth;
  if (faceWidth - Math.abs(axial) <= COLLISION_EPS) return false;
  const radial = Math.sqrt(Math.max(0, dot(d, d) - axial * axial));
  if (Math.abs(radial - (la.pitchRadius + lb.pitchRadius)) > MESH_DISTANCE_EPS) return false;
  return canMesh(a, b);
}

// 全ての歯車の円柱と全てのシャフトの線分（origin + span × 軸）。exempt は meshes の組（contact を含む）
function interferencesOf(
  scene: Scene,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
  gears: Readonly<Record<GearId, GearLayout>>,
  meshes: readonly Mesh[],
): Array<[string, string]> {
  return findInterferences(
    collidersOf(scene, shafts, gears),
    meshes.map((m) => [m.a, m.b] as const),
  );
}

function collidersOf(
  scene: Scene,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
  gears: Readonly<Record<GearId, GearLayout>>,
): Collider[] {
  const colliders: Collider[] = [];
  for (const [id, g] of Object.entries(gears)) {
    const gear = scene.gears[id];
    if (gear === undefined) continue;
    colliders.push(gearColliderOf(gear, g));
  }
  for (const [id, s] of Object.entries(shafts)) colliders.push(shaftCollider(id, s));
  return colliders;
}

// 歯車の円柱。かさ歯車（S2-02）は、歯のある円すい台に外接する円柱（大端の中心から頂点の側へ b·cos45°、
// 半径は大端の歯先）
function gearColliderOf(gear: Gear, layout: GearLayout): Collider {
  if (gear.kind === 'bevel') {
    const c = bevelCollisionCylinder(layout.center, layout.axis, gear);
    return { kind: 'cylinder', id: gear.id, shaftId: gear.shaftId, axis: layout.axis, ...c };
  }
  return gearCollider(gear.id, gear.shaftId, layout.center, layout.axis, gear.size, gear.teeth);
}

function shaftCollider(id: ShaftId, s: ShaftLayout): Collider {
  const w = axisVector(s.axis);
  return {
    kind: 'segment',
    id,
    start: add(s.origin, scale(w, s.span[0])),
    end: add(s.origin, scale(w, s.span[1])),
  };
}

// 歯車を 1 枚足したときの、足した歯車のレイアウトと、変わった部品を含む干渉の組
export interface Addition {
  readonly gear: GearLayout;
  // 足した歯車・足したシャフト・（同じ軸に足したなら）伸びたシャフトのどれかを含む干渉の組。
  // 組の中は [小さい ID, 大きい ID]、一覧は辞書順
  readonly interferences: Array<[string, string]>;
}

// scene（base = resolveLayout(scene)）に歯車 gear を 1 枚足したシーン（shaft が null でなければ、そのシャフトも足す）の、
// 足した歯車のレイアウトと、変わった部品を含む干渉の組を、全体を解き直さずに求める（生やす候補の列挙を速くするため。S2-01）。
// 結果は resolveLayout(足したシーン) の該当する部分と一致する。足した歯車が根から届かなければ null。
// gear と shaft の ID はシーンに無いものとする。それ以外の部品の位置・形・かみ合いは変わらないので、
// 変わった部品（歯車の円柱と、足したか伸びたシャフトの線分）と残りの全ての部品の組だけを調べればよい
export function resolveAddition(
  scene: Scene,
  base: Layout,
  shaft: Shaft | null,
  gear: Gear,
): Addition | null {
  const placed = placeAddition(scene, base, shaft, gear);
  if (placed === null) return null;
  const { layout, shaftLayout, treePartner } = placed;

  // 足した歯車とかみ合う組（木の親と、偶然ちょうどの距離にある歯車）は干渉としない
  const meshing = new Set<GearId>();
  if (treePartner !== null) meshing.add(treePartner);
  for (const [id, other] of Object.entries(base.gears)) {
    const g = scene.gears[id];
    if (g !== undefined && inContact(gear, layout, g, other)) meshing.add(id);
  }

  const cylinder = gearColliderOf(gear, layout);
  const segment = shaftCollider(gear.shaftId, shaftLayout);
  // 伸びたシャフトの元の線分は、新しい線分に置き換わる（足した歯車とシャフトの組は、載った組なので除かれる）
  const others = collidersOf(scene, base.shafts, base.gears).filter((c) => c.id !== segment.id);
  const found = new Map<string, [string, string]>();
  const record = (a: string, b: string) => {
    found.set(pairKey(a, b), a < b ? [a, b] : [b, a]);
  };
  for (const id of interferingWith(
    cylinder,
    others,
    (c) => c.kind === 'cylinder' && meshing.has(c.id),
  )) {
    record(cylinder.id, id);
  }
  for (const id of interferingWith(segment, others, () => false)) record(segment.id, id);
  const interferences = [...found.values()].sort(
    (p, q) => compare(p[0], q[0]) || compare(p[1], q[1]),
  );
  return { gear: layout, interferences };
}

// 足した歯車のレイアウト、載ったシャフトの（新しい）レイアウト、木の親の歯車
function placeAddition(
  scene: Scene,
  base: Layout,
  shaft: Shaft | null,
  gear: Gear,
): { layout: GearLayout; shaftLayout: ShaftLayout; treePartner: GearId | null } | null {
  const make = (origin: Vec3, axis: Axis, basePhase: number): GearLayout => ({
    center: gearCenter(origin, axis, gear),
    axis,
    pitchRadius: pitchRadius(gear.size, gear.teeth),
    basePhase,
  });

  if (shaft === null) {
    // 既にあるシャフトに通す。位相は 0（mesh のシャフトの子ではないため）、span は載った歯車ごと求め直す
    const s = base.shafts[gear.shaftId];
    if (s === undefined) return null;
    const onShaft = Object.values(scene.gears).filter((g) => g.shaftId === gear.shaftId);
    onShaft.push(gear);
    return {
      layout: make(s.origin, s.axis, 0),
      shaftLayout: { origin: s.origin, axis: s.axis, span: spanOf(onShaft) },
      treePartner: null,
    };
  }

  if (gear.shaftId !== shaft.id) return null;
  const span = spanOf([gear]);
  const p = shaft.placement;
  if (!isChildPlacement(p)) {
    return {
      layout: make(p.origin, p.axis, 0),
      shaftLayout: { origin: p.origin, axis: p.axis, span },
      treePartner: null,
    };
  }
  // compute と同じ置き方（placeChild）
  const parent = scene.gears[p.parentGearId];
  if (parent === undefined || p.childGearId !== gear.id) return null;
  const parentLayout = base.gears[parent.id];
  const parentShaft = base.shafts[parent.shaftId];
  if (parentLayout === undefined || parentShaft === undefined) return null;
  const placed = placeChild(parent, parentShaft.origin, parentLayout, p, gear);
  if (placed === null) return null;
  return {
    layout: make(placed.origin, placed.axis, placed.phase),
    shaftLayout: { origin: placed.origin, axis: placed.axis, span },
    treePartner: parent.id,
  };
}

// 載っている歯車ごとに、両面（offset と offset + 歯幅）から SHAFT_END_MARGIN ずつ伸ばした区間を求め、
// その最小〜最大をとる。かさ歯車（S2-02）は、頂点側の端を「頂点 − BEVEL_APEX_CLEARANCE」より先へ伸ばさない
// （頂点の先は相手のシャフトとぶつかるため）。同じシャフトの頂点側にほかの部品があれば、その部品の区間で伸びる。
// 歯車が無ければ [−EMPTY_SHAFT_HALF_LENGTH, +EMPTY_SHAFT_HALF_LENGTH]
export function spanOf(gears: readonly Gear[]): [number, number] {
  if (gears.length === 0) return [-EMPTY_SHAFT_HALF_LENGTH, EMPTY_SHAFT_HALF_LENGTH];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const gear of gears) {
    const faceWidth = GEAR_SIZES[gear.size].faceWidth;
    let gearLo = gear.offset - SHAFT_END_MARGIN;
    let gearHi = gear.offset + faceWidth + SHAFT_END_MARGIN;
    if (gear.kind === 'bevel') {
      // 大端は区画の頂点と反対側の面、頂点はそこから apex の向きに R
      const bigEnd = gear.offset + (faceWidth / 2) * (1 - gear.apex);
      const apex = bigEnd + gear.apex * pitchRadius(gear.size, gear.teeth);
      if (gear.apex === 1) gearHi = Math.min(gearHi, apex - BEVEL_APEX_CLEARANCE);
      else gearLo = Math.max(gearLo, apex + BEVEL_APEX_CLEARANCE);
    }
    lo = Math.min(lo, gearLo);
    hi = Math.max(hi, gearHi);
  }
  return [lo, hi];
}
