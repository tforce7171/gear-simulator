import {
  BEVEL_APEX_CLEARANCE,
  CARRIER_RADIUS_MARGIN,
  CARRIER_THICKNESS,
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
import { canMesh, meshGeometryOf, meshKindOf } from '../geometry/can-mesh';
import {
  centerDistance,
  gearEnvelope,
  gearPitchRadius,
  sectionWidth,
} from '../geometry/dimensions';
import {
  internalHollowRange,
  internalMeshPhase,
  internalRimRadius,
  internalTipRadius,
  internalWebRange,
} from '../geometry/internal';
import { meshPhase, pitchRadius, toothPitchAngle } from '../geometry/mesh';
import {
  rackLength,
  rackPitch,
  rackSectionCircle,
  rackTravel,
  wrapCentered,
} from '../geometry/rack';
import {
  crossedHelicalPhase,
  skewChildFrame,
  wheelPhaseFromWorm,
  wormPhaseFromWheel,
} from '../geometry/skew';
import { axisFrame, axisVector, radialDirection } from '../math/axis';
import { add, cross, dot, length, scale, sub, type Vec3 } from '../math/vec3';
import { gearCenter } from '../scene/gear-center';
import { assertNever } from '../scene/gear-shape';
import { lineRootOf, rackFrame } from '../scene/scene';
import {
  type Axis,
  type Carrier,
  type CarrierId,
  type ChildPlacement,
  type Gear,
  type GearId,
  isChildPlacement,
  isFreePlacement,
  type Rack,
  type RackId,
  type Scene,
  type Shaft,
  type ShaftId,
} from '../scene/types';
import { type Collider, findInterferences, gearCollider, interferingWith } from './collision';
import type {
  CarrierLayout,
  GearLayout,
  Layout,
  Mesh,
  Orbit,
  RackLayout,
  RackMesh,
  ShaftLayout,
} from './types';

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

// shaftId とその先（mesh・bevel・skew・planet で子孫になる。concentric の子、キャリアの遊星のシャフトも。S3-03）
// シャフトの ID を幅優先の順で返す。
// シーンに無いシャフトなら空。循環していても止まる
export function descendantShafts(scene: Scene, shaftId: ShaftId): ShaftId[] {
  if (scene.shafts[shaftId] === undefined) return [];
  const index = indexScene(scene);
  const order: ShaftId[] = [shaftId];
  const seen = new Set<ShaftId>(order);
  for (let head = 0; head < order.length; head++) {
    const current = order[head] as ShaftId;
    const children: Shaft[] = [...(index.concentricChildren.get(current) ?? [])];
    for (const parent of index.gearsByShaft.get(current) ?? []) {
      children.push(...(index.childShaftsByParentGear.get(parent.id) ?? []));
    }
    // キャリアに載った遊星のシャフト（S3-03。位置はキャリアのシャフトの回転で決まる）
    for (const carrier of index.carriersByShaft.get(current) ?? []) {
      children.push(...(index.planetsByCarrier.get(carrier.id) ?? []));
    }
    // 歯車をピニオンにしたラックに載った 2 つ目以降のピニオンのシャフト（S3-04）
    for (const pinion of index.gearsByShaft.get(current) ?? []) {
      for (const rack of index.racksByPinion.get(pinion.id) ?? []) {
        children.push(...(index.rackShaftsByRack.get(rack.id) ?? []));
      }
    }
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      order.push(child.id);
    }
  }
  return order;
}

interface SceneIndex {
  readonly gearsByShaft: ReadonlyMap<ShaftId, readonly Gear[]>;
  // 親の歯車 → それを親に持つ mesh・bevel・skew・planet のシャフト
  readonly childShaftsByParentGear: ReadonlyMap<GearId, readonly Shaft[]>;
  // 親のシャフト → それを親に持つ concentric のシャフト（S3-03）
  readonly concentricChildren: ReadonlyMap<ShaftId, readonly Shaft[]>;
  // シャフト → それに載ったキャリア、キャリア → それに載った遊星のシャフト（S3-03）
  readonly carriersByShaft: ReadonlyMap<ShaftId, readonly Carrier[]>;
  readonly planetsByCarrier: ReadonlyMap<CarrierId, readonly Shaft[]>;
  // ピニオンの歯車 → それにかみ合わせて置いたラック（pinion の配置）、ラック → それに載ったシャフト（'rack' の配置。S3-04）
  readonly racksByPinion: ReadonlyMap<GearId, readonly Rack[]>;
  readonly rackShaftsByRack: ReadonlyMap<RackId, readonly Shaft[]>;
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
  const concentricChildren = new Map<ShaftId, Shaft[]>();
  const planetsByCarrier = new Map<CarrierId, Shaft[]>();
  const rackShaftsByRack = new Map<RackId, Shaft[]>();
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (isChildPlacement(p)) push(childShaftsByParentGear, p.parentGearId, shaft);
    if (p.kind === 'concentric') push(concentricChildren, p.parentShaftId, shaft);
    if (p.kind === 'planet') push(planetsByCarrier, p.carrierId, shaft);
    if (p.kind === 'rack') push(rackShaftsByRack, p.rackId, shaft);
  }
  const racksByPinion = new Map<GearId, Rack[]>();
  for (const rack of Object.values(scene.racks)) {
    if (rack.placement.kind === 'pinion') push(racksByPinion, rack.placement.gearId, rack);
  }
  const carriersByShaft = new Map<ShaftId, Carrier[]>();
  for (const carrier of Object.values(scene.carriers))
    push(carriersByShaft, carrier.shaftId, carrier);
  return {
    gearsByShaft,
    childShaftsByParentGear,
    concentricChildren,
    carriersByShaft,
    planetsByCarrier,
    racksByPinion,
    rackShaftsByRack,
  };
}

interface QueueItem {
  readonly shaftId: ShaftId;
  readonly origin: Vec3;
  readonly axis: Axis;
  // mesh・bevel のシャフトの子の歯車とその basePhase（キューに積むときに決める）
  readonly child?: { readonly gearId: GearId; readonly phase: number };
  readonly orbit?: Orbit; // 遊星のシャフト（S3-03）
}

function compute(scene: Scene): Layout {
  const index = indexScene(scene);
  const shafts: Record<ShaftId, ShaftLayout> = {};
  const gears: Record<GearId, GearLayout> = {};
  const treePairs: Array<[GearId, GearId]> = [];

  const queue: QueueItem[] = [];
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (isFreePlacement(p)) queue.push({ shaftId: shaft.id, origin: p.origin, axis: p.axis });
  }
  // キャリアのシャフトがまだ置かれていない遊星のシャフト（S3-03）。置かれたら置き直す
  let pending: Array<{ parent: Gear; shaft: Shaft }> = [];

  // ラック（S3-04）。浮いたラックは最初に、pinion のラックはピニオンを置いたときに置き、続けて載ったシャフトを積む
  const racks: Record<RackId, RackDraft> = {};
  const rackTreeMeshes: RackMesh[] = [];
  const placeRackChildren = (rack: Rack): void => {
    const at = racks[rack.id];
    if (at === undefined) return;
    for (const childShaft of index.rackShaftsByRack.get(rack.id) ?? []) {
      const p = childShaft.placement;
      if (p.kind !== 'rack' || shafts[childShaft.id] !== undefined) continue;
      const child = scene.gears[p.childGearId];
      if (child === undefined || child.shaftId !== childShaft.id) continue;
      const placed = placeRackPinion(rack, at, child, p.position);
      rackTreeMeshes.push({ gear: child.id, rack: rack.id, position: p.position, source: 'tree' });
      queue.push({
        shaftId: childShaft.id,
        origin: placed.origin,
        axis: at.width,
        child: { gearId: child.id, phase: placed.phase },
      });
    }
  };
  for (const rack of Object.values(scene.racks)) {
    const p = rack.placement;
    if (p.kind !== 'detached') continue;
    const frame = rackFrame(scene, rack.id, () => null);
    if (frame === null) continue;
    racks[rack.id] = { ...frame, origin: p.origin, grooveOffset: 0 };
    placeRackChildren(rack);
  }

  // 親の歯車 parent の木の子のシャフト childShaft を置いてキューに積む。遊星のシャフトでキャリアのシャフトがまだなら false
  const placeTreeChild = (parent: Gear, childShaft: Shaft): boolean => {
    const p = childShaft.placement;
    if (!isChildPlacement(p) || shafts[childShaft.id] !== undefined) return true;
    const child = scene.gears[p.childGearId];
    const parentLayout = gears[parent.id];
    const parentShaft = shafts[parent.shaftId];
    if (child === undefined || child.shaftId !== childShaft.id) return true;
    if (parentLayout === undefined || parentShaft === undefined) return true;
    let orbit: Orbit | undefined;
    if (p.kind === 'planet') {
      const carrier = scene.carriers[p.carrierId];
      if (carrier === undefined) return true;
      const carrierShaft = shafts[carrier.shaftId];
      if (carrierShaft === undefined) return false;
      orbit = {
        carrierId: carrier.id,
        carrierShaftId: carrier.shaftId,
        center: carrierShaft.origin,
      };
    }
    const placed = placeChild(parent, parentShaft.origin, parentLayout, p, child);
    if (placed === null) return true;
    treePairs.push(ordered(parent.id, child.id));
    queue.push({
      shaftId: childShaft.id,
      origin: placed.origin,
      axis: placed.axis,
      child: { gearId: child.id, phase: placed.phase },
      ...(orbit === undefined ? {} : { orbit }),
    });
    return true;
  };

  for (;;) {
    for (let head = 0; head < queue.length; head++) {
      const item = queue[head] as QueueItem;
      if (shafts[item.shaftId] !== undefined) continue;
      const { shaftId, origin, axis } = item;
      const onShaft = index.gearsByShaft.get(shaftId) ?? [];
      shafts[shaftId] = {
        origin,
        axis,
        span: spanOf(onShaft),
        ...(item.orbit === undefined ? {} : { orbit: item.orbit }),
      };

      for (const gear of onShaft) {
        gears[gear.id] = {
          center: gearCenter(origin, axis, gear),
          axis,
          pitchRadius: gearPitchRadius(gear),
          basePhase: item.child?.gearId === gear.id ? item.child.phase : 0,
          ...(item.orbit === undefined ? {} : { orbit: item.orbit }),
        };
      }

      // 同じ線上のシャフト（S3-03）は原点・向きが親と同じ
      for (const c of index.concentricChildren.get(shaftId) ?? []) {
        queue.push({ shaftId: c.id, origin, axis });
      }
      for (const parent of onShaft) {
        for (const childShaft of index.childShaftsByParentGear.get(parent.id) ?? []) {
          if (!placeTreeChild(parent, childShaft)) pending.push({ parent, shaft: childShaft });
        }
        // この歯車をピニオンにしたラック（S3-04。公転する歯車には置かない）
        const pinionLayout = gears[parent.id] as GearLayout;
        if (pinionLayout.orbit !== undefined) continue;
        for (const rack of index.racksByPinion.get(parent.id) ?? []) {
          if (racks[rack.id] !== undefined || rack.placement.kind !== 'pinion') continue;
          if (parent.kind !== 'spur' || parent.size !== rack.size) continue;
          racks[rack.id] = placeRackOnPinion(parent, pinionLayout, rack.placement);
          rackTreeMeshes.push({ gear: parent.id, rack: rack.id, position: 0, source: 'tree' });
          placeRackChildren(rack);
        }
      }
    }
    queue.length = 0;
    const waiting = pending;
    pending = [];
    for (const { parent, shaft } of waiting) {
      if (!placeTreeChild(parent, shaft)) pending.push({ parent, shaft });
    }
    if (queue.length === 0) break;
  }

  const carriers = carriersOf(scene, index, shafts);
  extendSpansForCarriers(index, shafts);
  const meshes = meshesOf(scene, gears, treePairs);
  phaseCoaxialPlanetPartners(scene, gears, meshes);
  const rackMeshes = rackMeshesOf(scene, gears, racks, rackTreeMeshes);
  const rackLayouts = rackLayoutsOf(scene, racks, rackMeshes);
  return {
    shafts,
    gears,
    carriers,
    meshes,
    racks: rackLayouts,
    rackMeshes,
    interferences: interferencesOf(scene, shafts, gears, carriers, meshes, rackLayouts, rackMeshes),
  };
}

// 置いたラックの、travel を決める前の形（S3-04）
type RackDraft = Omit<RackLayout, 'travel' | 'length'>;

// ピニオンにかみ合わせて置くラック（pinion の配置。S3-04）。歯幅の方向 = ピニオンの軸、direction = それを axisStep 回進めた軸、
// normal = 残りの軸。基準位置 = ピニオンの中心 − r·normalSign·normal。ピニオンの位相は先に決まっているので、
// その歯の中心が接点に来るように歯溝をずらす（grooveOffset）
function placeRackOnPinion(
  pinion: Gear,
  layout: GearLayout,
  p: Extract<Rack['placement'], { kind: 'pinion' }>,
): RackDraft {
  const width = layout.axis;
  const direction = stepAxisOf(width, p.axisStep);
  const normal = remaining(width, direction);
  const n = scale(axisVector(normal), p.normalSign);
  const origin = sub(layout.center, scale(n, layout.pitchRadius));
  // 接点の向き u = −normalSign·normal、k = (e × u)·d（ピニオンが正に回るとき、接点の歯が direction の向きに進むなら 1）
  const u = scale(n, -1);
  const k = dot(cross(axisVector(width), u), axisVector(direction));
  const beta = angleAround(width, u);
  const dphi = wrapCentered(layout.basePhase - beta, toothPitchAngle(pinion.teeth));
  return {
    origin,
    direction,
    normal,
    normalSign: p.normalSign,
    width,
    grooveOffset: wrapCentered(layout.pitchRadius * k * dphi, rackPitch(pinion.size)),
  };
}

// ラックに載せたピニオン（'rack' の配置。S3-04）の原点と basePhase。子の中心 = 基準位置 + position·d + r·normalSign·n、
// 子の offset は 0（区画の中心がラックの歯幅の中心にそろう）。接点に一番近い歯溝の中心に、子の歯の中心が来るようにする
function placeRackPinion(
  rack: Rack,
  at: RackDraft,
  child: Gear,
  position: number,
): { origin: Vec3; phase: number } {
  const r = gearPitchRadius(child);
  const d = axisVector(at.direction);
  const n = scale(axisVector(at.normal), at.normalSign);
  const center = add(add(at.origin, scale(d, position)), scale(n, r));
  const origin = sub(center, scale(axisVector(at.width), sectionWidth(child) / 2));
  const u = scale(n, -1);
  const k = dot(cross(axisVector(at.width), u), d);
  const beta = angleAround(at.width, u);
  const delta = wrapCentered(at.grooveOffset - position, rackPitch(rack.size));
  const pitch = toothPitchAngle(child.teeth);
  const raw = beta + delta / (r * k);
  return { origin, phase: raw - Math.floor(raw / pitch) * pitch };
}

// ベクトル p の、軸 axis まわりの角度（radialDirection の逆）
function angleAround(axis: Axis, p: Vec3): number {
  const { u, v } = axisFrame(axis);
  return Math.atan2(dot(p, v), dot(p, u));
}

function stepAxisOf(axis: Axis, step: number): Axis {
  const order: readonly Axis[] = ['x', 'y', 'z'];
  return order[(order.indexOf(axis) + step) % 3] as Axis;
}

function remaining(a: Axis, b: Axis): Axis {
  return (['x', 'y', 'z'] as const).find((x) => x !== a && x !== b) ?? a;
}

// ラックとピニオンのかみ合い（S3-04）。木（pinion の配置のピニオンと、'rack' のシャフトのピニオン）に、偶然のかみ合い（contact）を
// 足す: 同じ大きさの平歯車で、軸がラックの歯幅の方向、中心がピッチ線から歯の側へ r（MESH_DISTANCE_EPS 以内）、歯幅の区画が
// 重なり、接点が s = 0 のラックの長さの範囲にある。公転する歯車は除く。位相は問わない。並びはラックの ID、歯車の ID の昇順
function rackMeshesOf(
  scene: Scene,
  gears: Readonly<Record<GearId, GearLayout>>,
  racks: Readonly<Record<RackId, RackDraft>>,
  tree: readonly RackMesh[],
): RackMesh[] {
  const out = [...tree];
  const treeKeys = new Set(tree.map((m) => pairKey(m.gear, m.rack)));
  for (const [rackId, at] of Object.entries(racks)) {
    const rack = scene.racks[rackId] as Rack;
    const half = rackLength(rack.size, rack.teeth) / 2;
    const d = axisVector(at.direction);
    const n = axisVector(at.normal);
    const w = axisVector(at.width);
    const faceWidth = GEAR_SIZES[rack.size].faceWidth;
    for (const [gearId, g] of Object.entries(gears)) {
      const gear = scene.gears[gearId];
      if (gear === undefined || gear.kind !== 'spur' || gear.size !== rack.size) continue;
      if (g.orbit !== undefined || g.axis !== at.width) continue;
      if (treeKeys.has(pairKey(gearId, rackId))) continue;
      const rel = sub(g.center, at.origin);
      if (Math.abs(dot(rel, n) * at.normalSign - g.pitchRadius) > MESH_DISTANCE_EPS) continue;
      if (faceWidth - Math.abs(dot(rel, w)) <= COLLISION_EPS) continue;
      const position = dot(rel, d);
      if (Math.abs(position) > half) continue;
      out.push({ gear: gearId, rack: rackId, position, source: 'contact' });
    }
  }
  return out.sort((a, b) => compare(a.rack, b.rack) || compare(a.gear, b.gear));
}

// ラックの長さと s の範囲（かみ合うピニオンの位置から。S3-04）
function rackLayoutsOf(
  scene: Scene,
  racks: Readonly<Record<RackId, RackDraft>>,
  rackMeshes: readonly RackMesh[],
): Record<RackId, RackLayout> {
  const out: Record<RackId, RackLayout> = {};
  for (const [id, at] of Object.entries(racks)) {
    const rack = scene.racks[id] as Rack;
    const positions = rackMeshes.filter((m) => m.rack === id).map((m) => m.position);
    out[id] = {
      ...at,
      length: rackLength(rack.size, rack.teeth),
      travel: rackTravel(rack.size, rack.teeth, positions),
    };
  }
  return out;
}

// ラックの干渉の円柱（S3-04）。動く範囲全体（s の最小 − L/2 〜 最大 + L/2）を長さとし、断面の外接円を半径とする、direction 向きの円柱
export function rackCollider(rack: Rack, at: RackLayout): Collider {
  const d = axisVector(at.direction);
  const n = scale(axisVector(at.normal), at.normalSign);
  const { radius, height } = rackSectionCircle(rack.size);
  const [lo, hi] = at.travel;
  return {
    kind: 'cylinder',
    id: rack.id,
    shaftId: rack.id,
    center: add(add(at.origin, scale(d, (lo + hi) / 2)), scale(n, height)),
    axis: at.direction,
    radius,
    halfWidth: (hi - lo) / 2 + at.length / 2,
  };
}

// キャリアのレイアウト（S3-03）。板の中心 = キャリアのシャフトの原点 + (offset + 厚み/2)·軸、
// 半径 = 遊星のシャフトの公転半径の最大 + CARRIER_RADIUS_MARGIN（遊星が無ければ余白の 2 倍）
function carriersOf(
  scene: Scene,
  index: SceneIndex,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
): Record<CarrierId, CarrierLayout> {
  const out: Record<CarrierId, CarrierLayout> = {};
  for (const carrier of Object.values(scene.carriers)) {
    const at = shafts[carrier.shaftId];
    if (at === undefined) continue;
    const w = axisVector(at.axis);
    const planets = (index.planetsByCarrier.get(carrier.id) ?? [])
      .filter((s) => shafts[s.id] !== undefined)
      .sort((a, b) => planetAngle(a) - planetAngle(b) || compare(a.id, b.id));
    let orbitRadius = 0;
    for (const planet of planets) {
      const origin = (shafts[planet.id] as ShaftLayout).origin;
      orbitRadius = Math.max(orbitRadius, distanceToLine(origin, at.origin, at.axis));
    }
    out[carrier.id] = {
      center: add(at.origin, scale(w, carrier.offset + CARRIER_THICKNESS[carrier.size] / 2)),
      axis: at.axis,
      radius:
        planets.length === 0 ? 2 * CARRIER_RADIUS_MARGIN : orbitRadius + CARRIER_RADIUS_MARGIN,
      planetShaftIds: planets.map((s) => s.id),
    };
  }
  return out;
}

function planetAngle(shaft: Shaft): number {
  return shaft.placement.kind === 'planet' ? shaft.placement.angle : 0;
}

// 点 p から、点 origin を通る軸 axis の直線までの距離
function distanceToLine(p: Vec3, origin: Vec3, axis: Axis): number {
  const d = sub(p, origin);
  const along = dot(d, axisVector(axis));
  return Math.sqrt(Math.max(0, dot(d, d) - along * along));
}

// キャリアの板の区間（S3-03）。キャリアのシャフトの原点からの [offset, offset + 厚み]
function carrierPlateRange(carrier: Carrier): readonly [number, number] {
  return [carrier.offset, carrier.offset + CARRIER_THICKNESS[carrier.size]];
}

// キャリアのシャフトの span に板（両面から SHAFT_END_MARGIN）を含め、遊星のシャフトの span を板の遠い側の面まで伸ばす（S3-03）
function extendSpansForCarriers(index: SceneIndex, shafts: Record<ShaftId, ShaftLayout>): void {
  for (const [shaftId, carriers] of index.carriersByShaft) {
    const at = shafts[shaftId];
    if (at === undefined) continue;
    const hasGears = (index.gearsByShaft.get(shaftId) ?? []).length > 0;
    let [lo, hi] = hasGears ? at.span : [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const carrier of carriers) {
      const [plateLo, plateHi] = carrierPlateRange(carrier);
      lo = Math.min(lo, plateLo - SHAFT_END_MARGIN);
      hi = Math.max(hi, plateHi + SHAFT_END_MARGIN);
      // 遊星のシャフトは板の遠い側の面まで伸ばす（板を貫いて支えられる）
      for (const planet of index.planetsByCarrier.get(carrier.id) ?? []) {
        const pl = shafts[planet.id];
        if (pl === undefined) continue;
        const shift = dot(sub(at.origin, pl.origin), axisVector(pl.axis));
        shafts[planet.id] = {
          ...pl,
          span: [Math.min(pl.span[0], plateLo + shift), Math.max(pl.span[1], plateHi + shift)],
        };
      }
    }
    shafts[shaftId] = { ...at, span: [lo, hi] };
  }
}

// 同じ線上のシャフト（concentric）の歯車で、遊星の歯車と contact でかみ合うもの（リングなど。S3-03）の basePhase を、
// かみ合う遊星のうち最初のもの（遊星のシャフトの angle の昇順、次に ID の昇順。候補から作ったものでは 0 番の遊星）に
// 合わせる。等配の条件を満たせば、残りの遊星とも位相が合う
function phaseCoaxialPlanetPartners(
  scene: Scene,
  gears: Record<GearId, GearLayout>,
  meshes: readonly Mesh[],
): void {
  const best = new Map<GearId, { planet: Gear; angle: number }>();
  for (const m of meshes) {
    if (m.source !== 'contact' || m.carrierShaftId === undefined) continue;
    const la = gears[m.a];
    const lb = gears[m.b];
    if (la === undefined || lb === undefined) continue;
    if ((la.orbit === undefined) === (lb.orbit === undefined)) continue;
    const [planetId, otherId] = la.orbit !== undefined ? [m.a, m.b] : [m.b, m.a];
    const planet = scene.gears[planetId];
    const other = scene.gears[otherId];
    if (planet === undefined || other === undefined) continue;
    if (scene.shafts[other.shaftId]?.placement.kind !== 'concentric') continue;
    const shaft = scene.shafts[planet.shaftId];
    if (shaft === undefined) continue;
    const angle = planetAngle(shaft);
    const current = best.get(otherId);
    if (
      current === undefined ||
      angle < current.angle ||
      (angle === current.angle && compare(planet.shaftId, current.planet.shaftId) < 0)
    ) {
      best.set(otherId, { planet, angle });
    }
  }
  for (const [otherId, { planet }] of best) {
    const other = scene.gears[otherId] as Gear;
    const lo = gears[otherId] as GearLayout;
    const lp = gears[planet.id] as GearLayout;
    // 遊星から見た相手の中心の向き（相手は遊星の公転の中心の線上にある）
    const { u, v } = axisFrame(lo.axis);
    const d = sub(lo.center, lp.center);
    const toOther = Math.atan2(dot(d, v), dot(d, u));
    const phase =
      other.kind === 'internal'
        ? internalMeshPhase(lp.basePhase, planet.teeth, false, other.teeth, toOther)
        : meshPhase(lp.basePhase, planet.teeth, other.teeth, toOther);
    gears[otherId] = { ...lo, basePhase: phase };
  }
}

// 木の子のシャフトの原点・向きと、子の歯車の basePhase（子の offset は 0 として置く）。
// mesh: 親の歯車の負側の面 + 外周の向き × 中心距離、向きは親と同じ。
// bevel（S2-02）: 子の大端の中心 = 親の大端の中心 + R·side·(子の軸) + R·親の apex·(親の軸)、
// 子の軸 = 親の軸を axisStep 回進めたもの、原点 = 子の大端の中心 − (歯幅/2)·(1 + side)·(子の軸)。
// skew（S2-03）: 子の軸 = 親の軸を axisStep 回進めたもの、子の中心 = 親の中心 + (r_親 + r_子)·side·u
// （u は 2 本の軸のどちらとも直交する座標軸）、原点 = 子の中心 − (区画の幅/2)·(子の軸)。
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
    // 遊星のシャフト（S3-03）の基準配置は mesh と同じ求め方（キャリアの角度が 0 のとき）
    case 'planet':
    case 'mesh': {
      // 中心距離は組の種類で決まる（外歯車同士は r_a + r_b、内歯車と外歯車は R − r。S3-02）。
      // 外歯車が親で子が内歯車なら、子の中心が親の中心から angle の向きに R − r 離れた位置（親を囲む）
      const face = add(parentShaftOrigin, scale(axisVector(axis), parent.offset));
      const distance = centerDistance(parent, child);
      const internal = parent.kind === 'internal' || child.kind === 'internal';
      return {
        origin: add(face, scale(radialDirection(axis, p.angle), distance)),
        axis,
        phase: internal
          ? internalMeshPhase(
              parentLayout.basePhase,
              parent.teeth,
              parent.kind === 'internal',
              child.teeth,
              p.angle,
            )
          : meshPhase(parentLayout.basePhase, parent.teeth, child.teeth, p.angle),
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
    case 'skew': {
      if (meshGeometryOf(parent) !== 'skew' || meshGeometryOf(child) !== 'skew') return null;
      const frame = skewChildFrame(
        parentLayout.center,
        axis,
        parentLayout.pitchRadius,
        gearPitchRadius(child),
        p.axisStep,
        p.side,
      );
      return {
        origin: sub(frame.center, scale(axisVector(frame.axis), sectionWidth(child) / 2)),
        axis: frame.axis,
        phase: skewPhase(parent, parentLayout, child, frame),
      };
    }
  }
}

// skew の子の basePhase（S2-03）。ウォームとホイールは、接点でウォームのねじ山の中心とホイールの歯溝の中心が重なる
// ように決める（core/geometry/skew.ts）。ねじ歯車の組（S2-04）は、接点で親の歯の中心と子の歯溝の中心が重なるように決める
function skewPhase(
  parent: Gear,
  parentLayout: GearLayout,
  child: Gear,
  childPlaced: { readonly center: Vec3; readonly axis: Axis },
): number {
  switch (child.kind) {
    case 'wormWheel':
      return wheelPhaseFromWorm(
        { center: parentLayout.center, axis: parentLayout.axis, phase: parentLayout.basePhase },
        childPlaced,
        child.teeth,
      );
    case 'worm':
      return wormPhaseFromWheel(
        { center: parentLayout.center, axis: parentLayout.axis, phase: parentLayout.basePhase },
        parent.teeth,
        childPlaced,
      );
    case 'crossedHelical':
      return crossedHelicalPhase(
        { center: parentLayout.center, axis: parentLayout.axis, phase: parentLayout.basePhase },
        parent.teeth,
        childPlaced,
        child.teeth,
      );
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'internal':
      return 0; // skew の配置の子にはならない（検証で弾く）
    default:
      return assertNever(child);
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
  const meshes: Mesh[] = treePairs.map(([a, b]) =>
    withCarrier(
      { a, b, source: 'tree', kind: meshKindOf(scene.gears[a] as Gear, scene.gears[b] as Gear) },
      gears[a],
      gears[b],
    ),
  );
  const tree = new Set(treePairs.map(([a, b]) => pairKey(a, b)));
  const placed: Array<{ gear: Gear; layout: GearLayout; reach: number }> = [];
  let maxReach = 0;
  for (const [id, layout] of Object.entries(gears)) {
    const gear = scene.gears[id];
    if (gear === undefined) continue;
    const reach = layout.pitchRadius + sectionWidth(gear);
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
      const [la, lb] = a === p.gear.id ? [p.layout, q.layout] : [q.layout, p.layout];
      meshes.push(
        withCarrier({ a, b, source: 'contact', kind: meshKindOf(p.gear, q.gear) }, la, lb),
      );
    }
  }
  return meshes.sort((m, n) => compare(m.a, n.a) || compare(m.b, n.b));
}

// 遊星のシャフトの歯車がかかわるかみ合い（S3-03）に、キャリアのシャフトを添える（ウィリスの式。design.md §6）
function withCarrier(mesh: Mesh, la: GearLayout | undefined, lb: GearLayout | undefined): Mesh {
  const orbit = la?.orbit ?? lb?.orbit;
  return orbit === undefined ? mesh : { ...mesh, carrierShaftId: orbit.carrierShaftId };
}

// 公転する歯車（遊星のシャフトの歯車）との組で、扱えるかみ合いか（S3-03）。同じキャリアで公転する組と、
// 公転する歯車とキャリアと同じ線上の歯車（太陽歯車・リング）の組だけ。それ以外（公転する歯車と、キャリアと
// 同じ軸でない歯車の偶然のかみ合い、別のキャリアで公転する組）は扱わない
function orbitCompatible(la: GearLayout, lb: GearLayout): boolean {
  const oa = la.orbit;
  const ob = lb.orbit;
  if (oa === undefined && ob === undefined) return true;
  if (oa !== undefined && ob !== undefined) return oa.carrierId === ob.carrierId;
  const orbit = (oa ?? ob) as Orbit;
  const other = oa === undefined ? la : lb;
  return distanceToLine(other.center, orbit.center, other.axis) <= MESH_DISTANCE_EPS;
}

// かみ合える組（canMesh。同じ大きさで、平歯車同士かねじれの向きが逆のハスバ歯車同士）、軸が同じ、別のシャフト、
// 軸方向の区間の重なりが COLLISION_EPS より大きく、軸に垂直な方向の中心間の距離が中心距離（centerDistance。
// 外歯車同士はピッチ円半径の和、内歯車と平歯車は R − r。S3-02）と MESH_DISTANCE_EPS 以内で一致する。安い数値の判定を先に、canMesh を最後にする。
// かさ歯車（S2-02）は、どちらもかさ歯車、同じ大きさ・同じ歯数、軸が直交、頂点の距離が MESH_DISTANCE_EPS 以内。
// ねじれた位置の組（S2-03 のウォームとホイール、S2-04 のねじ歯車）は、かみ合える組、軸が直交、中心を結ぶ線が両方の軸に直交し
// （軸方向の成分が MESH_DISTANCE_EPS 以内）、その長さがピッチ円半径の和と MESH_DISTANCE_EPS 以内で一致する
function inContact(a: Gear, la: GearLayout, b: Gear, lb: GearLayout): boolean {
  if (a.size !== b.size || a.shaftId === b.shaftId) return false;
  if (!orbitCompatible(la, lb)) return false;
  const geometry = meshGeometryOf(a);
  if (geometry !== meshGeometryOf(b)) return false;
  if (geometry === 'bevel') {
    if (a.kind !== 'bevel' || b.kind !== 'bevel') return false;
    if (a.teeth !== b.teeth || la.axis === lb.axis) return false;
    const d = sub(bevelApexOf(la.center, la.axis, a), bevelApexOf(lb.center, lb.axis, b));
    return length(d) <= MESH_DISTANCE_EPS;
  }
  if (geometry === 'skew') {
    if (la.axis === lb.axis) return false;
    const d = sub(lb.center, la.center);
    if (Math.abs(dot(d, axisVector(la.axis))) > MESH_DISTANCE_EPS) return false;
    if (Math.abs(dot(d, axisVector(lb.axis))) > MESH_DISTANCE_EPS) return false;
    if (Math.abs(length(d) - (la.pitchRadius + lb.pitchRadius)) > MESH_DISTANCE_EPS) return false;
    return canMesh(a, b);
  }
  if (la.axis !== lb.axis) return false;
  const w = axisVector(la.axis);
  const d = sub(lb.center, la.center);
  const axial = dot(d, w);
  const faceWidth = GEAR_SIZES[a.size].faceWidth;
  if (faceWidth - Math.abs(axial) <= COLLISION_EPS) return false;
  const radial = Math.sqrt(Math.max(0, dot(d, d) - axial * axial));
  // 外歯車同士は r_a + r_b、内歯車と外歯車は R − r（S3-02）
  if (Math.abs(radial - centerDistance(a, b)) > MESH_DISTANCE_EPS) return false;
  return canMesh(a, b);
}

// 全ての歯車の円柱と全てのシャフトの線分（origin + span × 軸）。exempt は meshes の組（contact を含む）
// 遊星歯車（S3-03）: キャリアの板の円柱を足し、次の組を除く（exempt に足す）。
// - 同じ線上のシャフト同士（concentric でつながる組。入れ子の中空軸）
// - 機構の部品（キャリアとそのシャフト、遊星のシャフトとその親とかみ合う歯車、親の歯車、それらとかみ合う同じ線上の歯車
//   （リング）、親とリングのシャフト）の間（かみ合いと支えの関係にあるため）
// 公転する部品（遊星のシャフトとその歯車）は、同じキャリアで公転する部品とは基準配置で、それ以外の部品とは
// 公転で掃く範囲（キャリアの軸まわりの中空の円柱）で判定する
function interferencesOf(
  scene: Scene,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
  gears: Readonly<Record<GearId, GearLayout>>,
  carriers: Readonly<Record<CarrierId, CarrierLayout>>,
  meshes: readonly Mesh[],
  racks: Readonly<Record<RackId, RackLayout>>,
  rackMeshes: readonly RackMesh[],
): Array<[string, string]> {
  const colliders = collidersOf(scene, shafts, gears, racks);
  const exempt: Array<readonly [string, string]> = meshes.map((m) => [m.a, m.b] as const);
  // ラックとかみ合うピニオンは干渉にしない（S3-04）
  for (const m of rackMeshes) exempt.push([m.gear, m.rack]);
  if (Object.keys(carriers).length === 0 && !Object.values(shafts).some((x) => x.orbit)) {
    return findInterferences(colliders, exempt);
  }
  for (const [id, c] of Object.entries(carriers)) {
    const carrier = scene.carriers[id] as Carrier;
    colliders.push({
      kind: 'cylinder',
      id,
      shaftId: carrier.shaftId,
      center: c.center,
      axis: c.axis,
      radius: c.radius,
      halfWidth: CARRIER_THICKNESS[carrier.size] / 2,
    });
  }
  exempt.push(...mechanismExemptions(scene, shafts, carriers, meshes));

  // 公転する部品 → そのキャリア
  const orbitOf = new Map<string, Orbit>();
  for (const [id, x] of Object.entries(shafts)) if (x.orbit) orbitOf.set(id, x.orbit);
  for (const [id, g] of Object.entries(gears)) if (g.orbit) orbitOf.set(id, g.orbit);
  const sameOrbit = ([a, b]: readonly [string, string]) =>
    orbitOf.get(a)?.carrierId === orbitOf.get(b)?.carrierId;
  const still = findInterferences(colliders, exempt).filter(sameOrbit);
  if (orbitOf.size === 0) return still;
  const swept = colliders.map((c) => {
    const orbit = orbitOf.get(c.id);
    return orbit === undefined ? c : sweep(c, orbit, shafts);
  });
  const moving = findInterferences(swept, exempt).filter((pair) => !sameOrbit(pair));
  return [...still, ...moving].sort((p, q) => compare(p[0], q[0]) || compare(p[1], q[1]));
}

// 公転する部品が、キャリアの軸まわりに掃く範囲（中空の円柱。S3-03）。円柱（半径 ρ、軸からの距離 d）は内側 d − ρ・
// 外側 d + ρ、線分（シャフト）は内側・外側とも d。軸方向の範囲はそのまま
function sweep(
  c: Collider,
  orbit: Orbit,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
): Collider {
  const axis = shafts[orbit.carrierShaftId]?.axis;
  if (axis === undefined) return c;
  const w = axisVector(axis);
  const onAxis = (p: Vec3): Vec3 => add(orbit.center, scale(w, dot(sub(p, orbit.center), w)));
  if (c.kind === 'segment') {
    const mid = scale(add(c.start, c.end), 0.5);
    const d = distanceToLine(c.start, orbit.center, axis);
    return {
      kind: 'hollow',
      id: c.id,
      shaftId: c.id,
      center: onAxis(mid),
      axis,
      innerRadius: d,
      radius: d,
      halfWidth: Math.abs(dot(sub(c.end, c.start), w)) / 2,
    };
  }
  const d = distanceToLine(c.center, orbit.center, axis);
  return {
    kind: 'hollow',
    id: c.id,
    shaftId: c.shaftId,
    center: onAxis(c.center),
    axis,
    innerRadius: Math.max(0, d - c.radius),
    radius: d + c.radius,
    halfWidth: c.halfWidth,
  };
}

// 遊星歯車の機構の中で、互いに干渉としない組（S3-03）
function mechanismExemptions(
  scene: Scene,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
  carriers: Readonly<Record<CarrierId, CarrierLayout>>,
  meshes: readonly Mesh[],
): Array<readonly [string, string]> {
  const pairs: Array<readonly [string, string]> = [];
  const allPairs = (ids: readonly string[]) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i] as string, ids[j] as string]);
    }
  };
  // 同じ線上のシャフト同士
  const lines = new Map<ShaftId, ShaftId[]>();
  for (const id of Object.keys(shafts)) {
    const root = lineRootOf(scene, id);
    if (root === null) continue;
    const list = lines.get(root);
    if (list === undefined) lines.set(root, [id]);
    else list.push(id);
  }
  for (const ids of lines.values()) if (ids.length > 1) allPairs(ids);
  // 機構の部品
  for (const [carrierId, c] of Object.entries(carriers)) {
    const carrier = scene.carriers[carrierId] as Carrier;
    const members = new Set<string>([carrierId, carrier.shaftId]);
    const childGears = new Set<GearId>();
    for (const planetId of c.planetShaftIds) {
      const p = scene.shafts[planetId]?.placement;
      if (p?.kind !== 'planet') continue;
      members.add(planetId);
      childGears.add(p.childGearId);
      members.add(p.childGearId);
      const parent = scene.gears[p.parentGearId];
      if (parent === undefined) continue;
      members.add(parent.id);
      members.add(parent.shaftId);
    }
    for (const m of meshes) {
      if (m.carrierShaftId !== carrier.shaftId) continue;
      const other = childGears.has(m.a) ? m.b : childGears.has(m.b) ? m.a : null;
      if (other === null) continue;
      const gear = scene.gears[other];
      if (gear === undefined || shafts[gear.shaftId]?.orbit !== undefined) continue;
      members.add(other);
      members.add(gear.shaftId);
    }
    allPairs([...members]);
  }
  return pairs;
}

function collidersOf(
  scene: Scene,
  shafts: Readonly<Record<ShaftId, ShaftLayout>>,
  gears: Readonly<Record<GearId, GearLayout>>,
  racks: Readonly<Record<RackId, RackLayout>> = {},
): Collider[] {
  const colliders: Collider[] = [];
  for (const [id, g] of Object.entries(gears)) {
    const gear = scene.gears[id];
    if (gear === undefined) continue;
    colliders.push(...gearCollidersOf(gear, g));
  }
  for (const [id, s] of Object.entries(shafts)) colliders.push(shaftCollider(id, s));
  for (const [id, r] of Object.entries(racks)) {
    const rack = scene.racks[id];
    if (rack !== undefined) colliders.push(rackCollider(rack, r));
  }
  return colliders;
}

// 歯車の円柱。かさ歯車（S2-02）は、歯のある円すい台に外接する円柱（大端の中心から頂点の側へ b·cos45°、
// 半径は大端の歯先）。ウォーム（S2-03）は半径 5m + m、長さ 5πm の円柱、ホイール・ねじ歯車（S2-04）は歯先円の円柱（gearEnvelope）。
// 内歯車（S3-02）は、リングとつなぎの筒の中空の円柱（内側 R − m、外側 R + 3.25m）と、ウェブの円柱（半径 R + 3.25m）の 2 つ
// （どちらも歯車の ID で、組は 1 つにまとまる）
function gearCollidersOf(gear: Gear, layout: GearLayout): Collider[] {
  if (gear.kind !== 'internal') return [gearColliderOf(gear, layout)];
  const w = axisVector(layout.axis);
  // 歯車の中心はリングの中心（offset + 歯幅/2）。軸方向の範囲を中心からの相対に直す
  const ringMid = gear.offset + GEAR_SIZES[gear.size].faceWidth / 2;
  const part = ([lo, hi]: readonly [number, number]) => ({
    center: add(layout.center, scale(w, (lo + hi) / 2 - ringMid)),
    halfWidth: (hi - lo) / 2,
  });
  const radius = internalRimRadius(gear.size, gear.teeth);
  const base = { id: gear.id, shaftId: gear.shaftId, axis: layout.axis };
  return [
    {
      kind: 'hollow',
      ...base,
      ...part(internalHollowRange(gear)),
      innerRadius: internalTipRadius(gear.size, gear.teeth),
      radius,
    },
    { kind: 'cylinder', ...base, ...part(internalWebRange(gear)), radius },
  ];
}

function gearColliderOf(gear: Gear, layout: GearLayout): Collider {
  if (gear.kind === 'bevel') {
    const c = bevelCollisionCylinder(layout.center, layout.axis, gear);
    return { kind: 'cylinder', id: gear.id, shaftId: gear.shaftId, axis: layout.axis, ...c };
  }
  if (gear.kind === 'worm') {
    return {
      kind: 'cylinder',
      id: gear.id,
      shaftId: gear.shaftId,
      center: layout.center,
      axis: layout.axis,
      ...gearEnvelope(gear),
    };
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
  // 遊星歯車（S3-03）・ラック（S3-04）のあるシーンは、公転・機構・ラックの範囲の扱いがあるので全体を解き直す
  // （機構は小さいので十分速い）
  if (Object.keys(scene.carriers).length > 0 || Object.keys(scene.racks).length > 0) {
    return resolveAdditionFully(scene, base, shaft, gear);
  }
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

  const bodies = gearCollidersOf(gear, layout);
  const segment = shaftCollider(gear.shaftId, shaftLayout);
  // 伸びたシャフトの元の線分は、新しい線分に置き換わる（足した歯車とシャフトの組は、載った組なので除かれる）
  const others = collidersOf(scene, base.shafts, base.gears).filter((c) => c.id !== segment.id);
  const found = new Map<string, [string, string]>();
  const record = (a: string, b: string) => {
    found.set(pairKey(a, b), a < b ? [a, b] : [b, a]);
  };
  for (const body of bodies) {
    for (const id of interferingWith(
      body,
      others,
      (c) => c.kind !== 'segment' && meshing.has(c.id),
    )) {
      record(body.id, id);
    }
  }
  for (const id of interferingWith(segment, others, () => false)) record(segment.id, id);
  const interferences = [...found.values()].sort(
    (p, q) => compare(p[0], q[0]) || compare(p[1], q[1]),
  );
  return { gear: layout, interferences };
}

// resolveAddition の、全体を解き直す版（S3-03）。足したシーンの resolveLayout から、変わった部品を含む組を取り出す
function resolveAdditionFully(
  scene: Scene,
  base: Layout,
  shaft: Shaft | null,
  gear: Gear,
): Addition | null {
  if (shaft === null && base.shafts[gear.shaftId] === undefined) return null;
  if (shaft !== null && gear.shaftId !== shaft.id) return null;
  const next: Scene = {
    ...scene,
    shafts: shaft === null ? scene.shafts : { ...scene.shafts, [shaft.id]: shaft },
    gears: { ...scene.gears, [gear.id]: gear },
  };
  const layout = compute(next);
  const placed = layout.gears[gear.id];
  if (placed === undefined) return null;
  const changed = new Set<string>([gear.id, gear.shaftId]);
  const interferences = layout.interferences
    .filter(([a, b]) => changed.has(a) || changed.has(b))
    .map(([a, b]) => [a, b] as [string, string]);
  return { gear: placed, interferences };
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
    pitchRadius: gearPitchRadius(gear),
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
  if (p.kind === 'concentric') return null; // 同じ線上のシャフトは足す候補にしない（S3-03）
  if (p.kind === 'rack') return null; // ラックのあるシーンは全体を解き直す（S3-04）
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
// その最小〜最大をとる。面は区画の両端（ウォームは長さを 4 の倍数に切り上げた区画。S2-03）。かさ歯車（S2-02）は、頂点側の端を「頂点 − BEVEL_APEX_CLEARANCE」より先へ伸ばさない
// （頂点の先は相手のシャフトとぶつかるため）。同じシャフトの頂点側にほかの部品があれば、その部品の区間で伸びる。
// 歯車が無ければ [−EMPTY_SHAFT_HALF_LENGTH, +EMPTY_SHAFT_HALF_LENGTH]
export function spanOf(gears: readonly Gear[]): [number, number] {
  if (gears.length === 0) return [-EMPTY_SHAFT_HALF_LENGTH, EMPTY_SHAFT_HALF_LENGTH];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const gear of gears) {
    const faceWidth = sectionWidth(gear);
    let gearLo = gear.offset - SHAFT_END_MARGIN;
    let gearHi = gear.offset + faceWidth + SHAFT_END_MARGIN;
    if (gear.kind === 'internal') {
      // 内歯車（S3-02）: シャフトはウェブ（ボス）を通り、外側の面から SHAFT_END_MARGIN 伸ばし、内側の面で止める
      // （中の空洞にシャフトを通さない。内側に置いた歯車と干渉させないため）
      const [webLo, webHi] = internalWebRange(gear);
      gearLo = gear.webSide === -1 ? webLo - SHAFT_END_MARGIN : webLo;
      gearHi = gear.webSide === -1 ? webHi : webHi + SHAFT_END_MARGIN;
    }
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
