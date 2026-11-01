import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  type ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { CARRIER_THICKNESS } from '../core/constants';
import { gearWidth } from '../core/geometry/dimensions';
import { rackWidth } from '../core/geometry/rack';
import type { MotionState } from '../core/kinematics/types';
import type { Layout, ShaftLayout } from '../core/layout/types';
import { gearWorldCenter, rackWorldOrigin, shaftWorldOrigin } from '../core/layout/world';
import { axisVector } from '../core/math/axis';
import { add, scale, type Vec3 } from '../core/math/vec3';
import { GEAR_KIND_LIST } from '../core/scene/gear-shape';
import { lineRootOf } from '../core/scene/scene';
import type {
  Anchor,
  AnchorId,
  Carrier,
  CarrierId,
  Gear,
  GearId,
  GearKind,
  Motor,
  MotorId,
  PartColor,
  Rack,
  RackId,
  Scene,
  Shaft,
  ShaftId,
  SizeKey,
} from '../core/scene/types';
import {
  ANCHOR_BASE_SIZE,
  ANCHOR_BASE_THICKNESS,
  ANCHOR_FOOT_SIZE,
  ANCHOR_FOOT_THICKNESS,
  ANCHOR_PILLAR_RADIUS,
  anchorFrame,
} from './anchor';
import { buildCarrierGeometries, carrierShapeKey } from './carrier';
import { placeOnAxis } from './frame';
import { createGeometryCache, type GeometryCache, gearBodyScaleZ } from './gear-geometry';
import {
  buildMotorModel,
  createMotorGeometries,
  MOTOR_GAP,
  MOTOR_PARTS,
  type MotorModel,
  type MotorPart,
  motorLength,
  setCouplingRadius,
} from './motor';
import { setPickTarget } from './picking';
import {
  buildRackGeometry,
  placeRack,
  RACK_SHAKE_MM_PER_RAD,
  rackAnchorFrame,
  rackShapeKey,
} from './rack';
import type { PartKind } from './themes';
import {
  lockGlowIntensity,
  lockShakeAngle,
  NO_WARNINGS,
  shakeSeedOf,
  type WarningParts,
} from './warning-effects';

// シャフトの見た目の寸法（mm）。質感はテーマ（S1-24。render/themes.ts）が setBaseMaterials で渡す
const SHAFT_RADIUS = 1.5;
// 同じ線上のシャフト（S3-03）は入れ子の中空軸に見せる。後から作ったほうを、この分だけ太い筒にする
export const SHAFT_NEST_STEP = 1;

// 同じ線上のシャフト（concentric でつながる組。S3-03）の中での順位。シーンの shafts の並び（作った順）で 0, 1, 2, …。
// 1 本だけの線のシャフトは 0
export function shaftNestRanks(scene: Scene): Map<ShaftId, number> {
  const lines = new Map<ShaftId, ShaftId[]>();
  for (const id of Object.keys(scene.shafts)) {
    const root = lineRootOf(scene, id) ?? id;
    const list = lines.get(root);
    if (list === undefined) lines.set(root, [id]);
    else list.push(id);
  }
  const ranks = new Map<ShaftId, number>();
  for (const ids of lines.values()) {
    ids.forEach((id, i) => {
      ranks.set(id, i);
    });
  }
  return ranks;
}

export function shaftRadiusOf(rank: number): number {
  return SHAFT_RADIUS + rank * SHAFT_NEST_STEP;
}
// 細いシャフトをクリックしやすくする、見えない当たり判定の円柱の半径（S1-16）
export const SHAFT_PICK_RADIUS = 3;

// モーターの本体の中心: シャフトの負側の端のさらに外（モーターの音の位置にも使う。S1-26）。
// 形は render/motor.ts（S4-07。直径 MOTOR_DIAMETER、長さ motorLength = 直径 × 1.3）
export function motorCenter(placed: ShaftLayout, size: SizeKey): Vec3 {
  const along = placed.span[0] - MOTOR_GAP - motorLength(size) / 2;
  return add(placed.origin, scale(axisVector(placed.axis), along));
}

// 選択とマウスを乗せたときのハイライト（S1-16）。ロックの赤（S1-22）と見分けられる水色
const SELECTED_EMISSIVE = 0x1ea7ff;
const SELECTED_EMISSIVE_INTENSITY = 0.9;
const HOVER_EMISSIVE = 0x1ea7ff;
const HOVER_EMISSIVE_INTENSITY = 0.25;

// 編集中の仮の部品の見た目（S1-17・S1-19）。置く前の部品は半透明（ghost）、
// 新たな干渉を生む位置では赤（invalid）。ロックの赤（S1-22）とは別に、色そのものを赤くする
const INVALID_COLOR = 0xe0403a;
const INVALID_EMISSIVE = 0x801010;
const GHOST_OPACITY = 0.45;

// ロック（S1-22）は赤の発光を脈打たせ、干渉は一定の赤の発光にする（脈打つかどうかで見分ける）。
// 仮の部品の invalid（色そのものが赤）とは、色を変えずに発光だけ赤くすることで見分ける
const LOCK_EMISSIVE = 0xff2a1a;
const LOCK_INTENSITY_MIN = 0.15;
const LOCK_INTENSITY_MAX = 1;
const INTERFERE_EMISSIVE = 0xe02a20;
const INTERFERE_INTENSITY = 0.6;
// ロック・干渉と選択（マウス）が重なったら、色（albedo）を選択の水色に寄せる割合
const WARNING_SELECTED_TINT = 0.65;
const WARNING_HOVERED_TINT = 0.3;

// 仮の部品の見た目。ids の部品（シャフトならそのモーターも）に効く。ハイライトより優先する
export interface PreviewStyle {
  readonly ids: ReadonlySet<string>;
  readonly ghost: boolean; // 半透明にする（まだ置いていない部品）
  readonly invalid: boolean; // 赤くする（そこでは置けない・確定しない）
}

// ハイライトする部品の ID（歯車かシャフト。シャフトならそのモーターも光らせる）
export interface Highlight {
  readonly selected: string | null;
  readonly hovered: string | null;
}

type Emphasis = 'none' | 'hovered' | 'selected';
type Warning = 'locked' | 'interfering';
type WarningLevel = `${Warning}-${Emphasis}`;
type MaterialLevel = Emphasis | 'ghost' | 'invalid' | 'ghostInvalid' | WarningLevel;

type MaterialSet = Record<MaterialLevel, MeshStandardMaterial>;

const EMPHASES: readonly Emphasis[] = ['none', 'hovered', 'selected'];
const EMPHASIS_TINT: Readonly<Record<Emphasis, number>> = {
  none: 0,
  hovered: WARNING_HOVERED_TINT,
  selected: WARNING_SELECTED_TINT,
};

function warningOf(
  base: MeshStandardMaterial,
  warning: Warning,
  emphasis: Emphasis,
): MeshStandardMaterial {
  const m = base.clone();
  m.color.lerp(new Color(SELECTED_EMISSIVE), EMPHASIS_TINT[emphasis]);
  m.emissive.setHex(warning === 'locked' ? LOCK_EMISSIVE : INTERFERE_EMISSIVE);
  m.emissiveIntensity = warning === 'locked' ? LOCK_INTENSITY_MAX : INTERFERE_INTENSITY;
  return m;
}

function ghostOf(material: MeshStandardMaterial): MeshStandardMaterial {
  const ghost = material.clone();
  ghost.transparent = true;
  ghost.opacity = GHOST_OPACITY;
  ghost.depthWrite = false;
  return ghost;
}

function materialSet(base: MeshStandardMaterial): MaterialSet {
  const hovered = base.clone();
  hovered.emissive.setHex(HOVER_EMISSIVE);
  hovered.emissiveIntensity = HOVER_EMISSIVE_INTENSITY;
  const selected = base.clone();
  selected.emissive.setHex(SELECTED_EMISSIVE);
  selected.emissiveIntensity = SELECTED_EMISSIVE_INTENSITY;
  const invalid = base.clone();
  invalid.color.setHex(INVALID_COLOR);
  invalid.emissive.setHex(INVALID_EMISSIVE);
  invalid.emissiveIntensity = 1;
  const warnings = {} as Record<WarningLevel, MeshStandardMaterial>;
  for (const warning of ['locked', 'interfering'] as const) {
    for (const emphasis of EMPHASES) {
      warnings[`${warning}-${emphasis}`] = warningOf(base, warning, emphasis);
    }
  }
  return {
    none: base,
    hovered,
    selected,
    ghost: ghostOf(base),
    invalid,
    ghostInvalid: ghostOf(invalid),
    ...warnings,
  };
}

// ロックの材質の発光の強さを、今の時刻の脈に合わせる
function pulseLocked(set: MaterialSet, timeSec: number): void {
  const intensity =
    LOCK_INTENSITY_MIN + (LOCK_INTENSITY_MAX - LOCK_INTENSITY_MIN) * lockGlowIntensity(timeSec);
  for (const emphasis of EMPHASES) set[`locked-${emphasis}`].emissiveIntensity = intensity;
}

// 部品の種類ごとの基の材質（テーマが決める。S1-24）。歯車は種類ごと（S2-05。同じ材質を共有してよい）、
// キャリア・ラック・固定具は part（S3-05。render/themes.ts の PART_KIND_MATERIALS。歯車と共有してよい）、
// モーターは部分ごと（S4-07。render/themes.ts の MOTOR_PART_LOOKS。部分の間で共有してよい）。
// colors は部品の色（S5-04）ごとの材質で、今のテーマの系統の色だけを持つ（歯車・部品と共有してよい）。
// 色を持つ歯車・ラック・キャリア・固定具は colors[color]、無ければ（色なし・系統にない色）種類の材質で描く
export interface BaseMaterials {
  readonly gear: Readonly<Record<GearKind, MeshStandardMaterial>>;
  readonly part: Readonly<Record<PartKind, MeshStandardMaterial>>;
  readonly colors?: Readonly<Partial<Record<PartColor, MeshStandardMaterial>>>;
  readonly shaft: MeshStandardMaterial;
  readonly motor: Readonly<Record<MotorPart, MeshStandardMaterial>>;
}

// 材質の組の全部を捨てる（基の材質も含む。テクスチャは持ち主が捨てる）
function disposeSet(set: MaterialSet): void {
  for (const material of new Set(Object.values(set))) material.dispose();
}

type GearMaterialSets = Readonly<Record<GearKind, MaterialSet>>;
type PartMaterialSets = Readonly<Record<PartKind, MaterialSet>>;
type ColorMaterialSets = Readonly<Partial<Record<PartColor, MaterialSet>>>;
const PART_KIND_LIST: readonly PartKind[] = ['carrier', 'rack', 'anchor'];

// 歯車と部品（S3-05）の種類ごとの材質の組と、色（S5-04）ごとの材質の組。基の材質が同じものは同じ組を共有する
// （歯車・部品・色の間でも）
function materialSets(
  gear: Readonly<Record<GearKind, MeshStandardMaterial>>,
  part: Readonly<Record<PartKind, MeshStandardMaterial>>,
  colors: Readonly<Partial<Record<PartColor, MeshStandardMaterial>>> = {},
): { gear: GearMaterialSets; part: PartMaterialSets; colors: ColorMaterialSets } {
  const byBase = new Map<MeshStandardMaterial, MaterialSet>();
  const setOf = (material: MeshStandardMaterial): MaterialSet => {
    let set = byBase.get(material);
    if (set === undefined) {
      set = materialSet(material);
      byBase.set(material, set);
    }
    return set;
  };
  const gears = {} as Record<GearKind, MaterialSet>;
  for (const kind of GEAR_KIND_LIST) gears[kind] = setOf(gear[kind]);
  const parts = {} as Record<PartKind, MaterialSet>;
  for (const kind of PART_KIND_LIST) parts[kind] = setOf(part[kind]);
  const colorSets: Partial<Record<PartColor, MaterialSet>> = {};
  for (const [color, material] of Object.entries(colors) as Array<
    [PartColor, MeshStandardMaterial | undefined]
  >) {
    if (material !== undefined) colorSets[color] = setOf(material);
  }
  return { gear: gears, part: parts, colors: colorSets };
}

function uniqueSets(
  gear: GearMaterialSets,
  part: PartMaterialSets,
  colors: ColorMaterialSets,
): MaterialSet[] {
  return [...new Set([...Object.values(gear), ...Object.values(part), ...Object.values(colors)])];
}

type MotorMaterialSets = Readonly<Record<MotorPart, MaterialSet>>;

// モーターの部分ごとの材質の組（S4-07）。基の材質が同じ部分は同じ組を共有する
function motorMaterialSets(
  motor: Readonly<Record<MotorPart, MeshStandardMaterial>>,
): MotorMaterialSets {
  const byBase = new Map<MeshStandardMaterial, MaterialSet>();
  const sets = {} as Record<MotorPart, MaterialSet>;
  for (const part of MOTOR_PARTS) {
    let set = byBase.get(motor[part]);
    if (set === undefined) {
      set = materialSet(motor[part]);
      byBase.set(motor[part], set);
    }
    sets[part] = set;
  }
  return sets;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

interface GearEntry {
  gear: Gear;
  pivot: Group; // 中心に置き、u・v・w に合わせる
  body: Mesh; // pivot のローカルの z まわりに回す
}

interface ShaftEntry {
  shaft: Shaft;
  span: readonly [number, number];
  radius: number; // 見た目の半径（入れ子の中空軸。S3-03）
  object: Mesh;
  proxy: Mesh; // 見えない太めの当たり判定（object の子）
  base: Quaternion; // 置いたときの向き（ロックの震えはこれに足す）
}

// モーター（S4-07）。group をモーターの中心に置き、継手（model.spin）をシャフトの回転角だけ回す
interface MotorEntry {
  motor: Motor;
  model: MotorModel;
  base: Quaternion; // 置いたときの向き（ロックの震えはこれに足す）
}

// キャリア（S3-03）。腕のある板。spin をキャリアのシャフトの回転角だけ回す。選べる（'carrier'）
interface CarrierEntry {
  carrier: Carrier;
  key: string;
  group: Group; // 板の中心に置き、u・v・w に合わせる
  spin: Group; // group のローカルの z まわりに回す
  parts: Mesh[];
}

// 固定具（S3-01）。台座・支柱・床の足。地面に固定されているので震えない。選べない（当たり判定なし）。
// ラックの固定具（S3-04）は、ラックの今の位置に合わせて update で置き直す（rack が null でなければ）
interface AnchorEntry {
  anchor: Anchor;
  group: Group;
  parts: Mesh[];
  rack: { base: Mesh; pillar: Mesh; foot: Mesh } | null;
}

// ラック（S3-04）。body を基準位置 + (s + grooveOffset)·direction に毎フレーム置く。選べる（'rack'）
interface RackEntry {
  rack: Rack;
  key: string;
  body: Mesh;
}

export interface SceneSync {
  readonly root: Group;
  sync(scene: Scene, layout: Layout): void;
  // 回転角と、ロックの震え・光（timeSec は秒。S1-22）
  update(motion: MotionState, layout: Layout, timeSec?: number): void;
  // 選択とマウスを乗せた部品を光らせる（S1-16）
  setHighlight(highlight: Highlight): void;
  // 編集中の仮の部品の見た目（S1-17）。null で戻す
  setPreviewStyle(style: PreviewStyle | null): void;
  // ロック中・干渉中の部品（S1-22）。中身が変わったときだけ材質を選び直す
  setWarnings(warnings: WarningParts): void;
  // 部品の種類ごとの基の材質を差し替える（テーマ。S1-24）。ハイライト・仮の部品・ロック・干渉の
  // 材質も作り直し、古いものは dispose する。渡した材質はこの後 SceneSync が持ち、差し替えで捨てる
  setBaseMaterials(materials: BaseMaterials): void;
  // 部品の形・位置・向き・材質が変わるたびに増える数（影マップを描き直すかの判断に使う。S1-24）
  version(): number;
  // 歯車・ラック・キャリア・固定具の今の材質の色（0xRRGGBB。S5-04。__gearSim.getPartMaterialColor）。
  // 描いていない・色を持てない部品は null。選択・マウスの強調では色は変わらない（発光だけ）
  partMaterialColor(id: string): number | null;
  gearCount(): number;
  anchorCount(): number; // 描いている固定具の数（S3-01）
  carrierCount(): number; // 描いているキャリアの数（S3-03）
  rackCount(): number; // 描いているラックの数（S3-04）
}

// シーンとレイアウトから Three.js のオブジェクトを同期する。
// 部品の参照が変わったものだけ作り直し、位置と向きはレイアウトから毎回置き直す
export function createSceneSync(cache: GeometryCache = createGeometryCache()): SceneSync {
  const root = new Group();
  // テーマ（S1-24）が setBaseMaterials で差し替えるまでの材質
  const defaultGear = new MeshStandardMaterial({ color: 0xa0a4aa, metalness: 0.3, roughness: 0.5 });
  const defaultPart = new MeshStandardMaterial({ color: 0x7a7f87, metalness: 0.4, roughness: 0.4 });
  const initialSets = materialSets(
    Object.fromEntries(GEAR_KIND_LIST.map((kind) => [kind, defaultGear])) as Record<
      GearKind,
      MeshStandardMaterial
    >,
    { carrier: defaultPart, rack: defaultGear, anchor: defaultPart },
  );
  let gearMaterials = initialSets.gear;
  let partMaterials = initialSets.part;
  let colorMaterials = initialSets.colors;
  // 色を持つ部品（S5-04）は今のテーマの系統の色の組、無ければ（色なし・系統にない色）種類の組
  const colorSetOr = (color: PartColor | undefined, fallback: MaterialSet): MaterialSet =>
    (color === undefined ? undefined : colorMaterials[color]) ?? fallback;
  let shaftMaterials = materialSet(
    new MeshStandardMaterial({ color: 0x7a7f87, metalness: 0.4, roughness: 0.4 }),
  );
  const defaultMotor = new MeshStandardMaterial({
    color: 0x5c6068,
    metalness: 0.1,
    roughness: 0.7,
  });
  let motorMaterials = motorMaterialSets(
    Object.fromEntries(MOTOR_PARTS.map((part) => [part, defaultMotor])) as Record<
      MotorPart,
      MeshStandardMaterial
    >,
  );
  const motorGeometries = createMotorGeometries();
  // 当たり判定だけの形（描かないがレイキャストには当たる）
  const pickProxyMaterial = new MeshBasicMaterial({ visible: false });
  let highlight: Highlight = { selected: null, hovered: null };
  let preview: PreviewStyle | null = null;
  let warnings: WarningParts = NO_WARNINGS;

  const gears = new Map<GearId, GearEntry>();
  const shafts = new Map<ShaftId, ShaftEntry>();
  const motors = new Map<MotorId, MotorEntry>();
  const anchors = new Map<AnchorId, AnchorEntry>();
  const carriers = new Map<CarrierId, CarrierEntry>();
  const racks = new Map<RackId, RackEntry>();
  // ラックの形状データ（大きさ・歯数・厚さごとに共有し、使う数を数える）
  const rackGeometries = new Map<string, { geometry: ExtrudeGeometry; count: number }>();
  const acquireRackGeometry = (rack: Rack): ExtrudeGeometry => {
    const key = rackShapeKey(rack.size, rack.teeth, rackWidth(rack));
    const hit = rackGeometries.get(key);
    if (hit !== undefined) {
      hit.count++;
      return hit.geometry;
    }
    const geometry = buildRackGeometry(rack.size, rack.teeth, rackWidth(rack));
    rackGeometries.set(key, { geometry, count: 1 });
    return geometry;
  };
  const releaseRackGeometry = (key: string): void => {
    const hit = rackGeometries.get(key);
    if (hit === undefined) return;
    hit.count--;
    if (hit.count > 0) return;
    hit.geometry.dispose();
    rackGeometries.delete(key);
  };
  // 固定具の形（大きさは固定なので共有する。支柱は高さ 1 を scale.y で伸ばす）
  const anchorBaseGeometry = new BoxGeometry(
    ANCHOR_BASE_SIZE,
    ANCHOR_BASE_SIZE,
    ANCHOR_BASE_THICKNESS,
  );
  const anchorPillarGeometry = new CylinderGeometry(
    ANCHOR_PILLAR_RADIUS,
    ANCHOR_PILLAR_RADIUS,
    1,
    12,
  );
  const anchorFootGeometry = new BoxGeometry(
    ANCHOR_FOOT_SIZE,
    ANCHOR_FOOT_THICKNESS,
    ANCHOR_FOOT_SIZE,
  );
  let lastScene: Scene | undefined;
  let lastLayout: Layout | undefined;
  let version = 0;

  function removeGear(id: GearId, entry: GearEntry): void {
    root.remove(entry.pivot);
    cache.release(entry.gear, entry.gear.size, entry.gear.teeth, gearWidth(entry.gear));
    gears.delete(id);
  }

  function removeShaft(id: ShaftId, entry: ShaftEntry): void {
    root.remove(entry.object);
    entry.object.geometry.dispose();
    entry.proxy.geometry.dispose();
    shafts.delete(id);
  }

  function removeCarrier(id: CarrierId, entry: CarrierEntry): void {
    root.remove(entry.group);
    for (const part of entry.parts) part.geometry.dispose();
    carriers.delete(id);
  }

  function syncCarriers(scene: Scene, layout: Layout): void {
    const keyOf = (carrier: Carrier): string | null => {
      const placed = layout.carriers[carrier.id];
      if (placed === undefined) return null;
      return carrierShapeKey(carrierShapeOf(scene, layout, carrier));
    };
    for (const [id, entry] of carriers) {
      const carrier = scene.carriers[id];
      if (carrier !== entry.carrier || keyOf(entry.carrier) !== entry.key) removeCarrier(id, entry);
    }
    for (const carrier of Object.values(scene.carriers)) {
      const placed = layout.carriers[carrier.id];
      if (placed === undefined) continue;
      let entry = carriers.get(carrier.id);
      if (entry === undefined) {
        const shape = carrierShapeOf(scene, layout, carrier);
        const group = new Group();
        const spin = new Group();
        const parts = buildCarrierGeometries(shape).map((geometry) => {
          const mesh = new Mesh(geometry, shaftMaterials.none);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          spin.add(mesh);
          return mesh;
        });
        group.add(spin);
        setPickTarget(group, 'carrier', carrier.id);
        root.add(group);
        entry = { carrier, key: carrierShapeKey(shape), group, spin, parts };
        carriers.set(carrier.id, entry);
      }
      placeOnAxis(entry.group, placed.center, placed.axis);
    }
  }

  function syncRacks(scene: Scene, layout: Layout): void {
    for (const [id, entry] of racks) {
      if (scene.racks[id] !== entry.rack || layout.racks[id] === undefined) {
        root.remove(entry.body);
        releaseRackGeometry(entry.key);
        racks.delete(id);
      }
    }
    for (const rack of Object.values(scene.racks)) {
      const placed = layout.racks[rack.id];
      if (placed === undefined || racks.has(rack.id)) continue;
      const body = new Mesh(acquireRackGeometry(rack), partMaterials.rack.none);
      body.castShadow = true;
      body.receiveShadow = true;
      setPickTarget(body, 'rack', rack.id);
      root.add(body);
      racks.set(rack.id, {
        rack,
        key: rackShapeKey(rack.size, rack.teeth, rackWidth(rack)),
        body,
      });
    }
  }

  function removeMotor(id: MotorId, entry: MotorEntry): void {
    root.remove(entry.model.group);
    motors.delete(id);
  }

  function syncGears(scene: Scene, layout: Layout): void {
    for (const [id, entry] of gears) {
      const gear = scene.gears[id];
      if (gear !== entry.gear || layout.gears[id] === undefined) removeGear(id, entry);
    }
    for (const gear of Object.values(scene.gears)) {
      const placed = layout.gears[gear.id];
      if (placed === undefined) continue; // 木から外れた歯車は描かない
      let entry = gears.get(gear.id);
      if (entry === undefined) {
        const body = new Mesh(
          cache.acquire(gear, gear.size, gear.teeth, gearWidth(gear)),
          colorSetOr(gear.color, gearMaterials[gear.kind]).none,
        );
        body.scale.z = gearBodyScaleZ(gear);
        // 影（S1-24）: 歯車は影を落とし、受ける。品質が軽量なら renderer 側で影の計算ごと止める
        body.castShadow = true;
        body.receiveShadow = true;
        const pivot = new Group();
        pivot.add(body);
        setPickTarget(pivot, 'gear', gear.id);
        root.add(pivot);
        entry = { gear, pivot, body };
        gears.set(gear.id, entry);
      }
      placeOnAxis(entry.pivot, placed.center, placed.axis);
    }
  }

  function syncShafts(scene: Scene, layout: Layout): void {
    const ranks = shaftNestRanks(scene);
    const radiusOf = (id: ShaftId) => shaftRadiusOf(ranks.get(id) ?? 0);
    for (const [id, entry] of shafts) {
      const placed = layout.shafts[id];
      if (
        scene.shafts[id] !== entry.shaft ||
        placed === undefined ||
        placed.span[0] !== entry.span[0] ||
        placed.span[1] !== entry.span[1] ||
        radiusOf(id) !== entry.radius
      ) {
        removeShaft(id, entry);
      }
    }
    for (const shaft of Object.values(scene.shafts)) {
      const placed = layout.shafts[shaft.id];
      if (placed === undefined) continue;
      let entry = shafts.get(shaft.id);
      if (entry === undefined) {
        const length = Math.max(placed.span[1] - placed.span[0], 1e-3);
        const radius = radiusOf(shaft.id);
        const geometry = new CylinderGeometry(radius, radius, length, 16);
        geometry.rotateX(Math.PI / 2); // 円柱の向きをローカルの z（= 軸 w）にする
        const object = new Mesh(geometry, shaftMaterials.none);
        object.castShadow = true;
        const pickRadius = Math.max(SHAFT_PICK_RADIUS, radius + 1);
        const proxyGeometry = new CylinderGeometry(pickRadius, pickRadius, length, 8);
        proxyGeometry.rotateX(Math.PI / 2);
        const proxy = new Mesh(proxyGeometry, pickProxyMaterial);
        object.add(proxy);
        setPickTarget(object, 'shaft', shaft.id);
        root.add(object);
        entry = { shaft, span: placed.span, radius, object, proxy, base: new Quaternion() };
        shafts.set(shaft.id, entry);
      }
      const mid = (placed.span[0] + placed.span[1]) / 2;
      placeOnAxis(
        entry.object,
        add(placed.origin, scale(axisVector(placed.axis), mid)),
        placed.axis,
      );
      entry.base.copy(entry.object.quaternion);
    }
  }

  function syncMotors(scene: Scene, layout: Layout): void {
    const ranks = shaftNestRanks(scene);
    for (const [id, entry] of motors) {
      const motor = scene.motors[id];
      if (motor !== entry.motor || layout.shafts[entry.motor.shaftId] === undefined) {
        removeMotor(id, entry);
      }
    }
    for (const motor of Object.values(scene.motors)) {
      const placed = layout.shafts[motor.shaftId];
      if (placed === undefined) continue;
      let entry = motors.get(motor.id);
      const shaftRadius = shaftRadiusOf(ranks.get(motor.shaftId) ?? 0);
      if (entry === undefined) {
        const model = buildMotorModel(motorGeometries, motor.size, shaftRadius);
        setPickTarget(model.group, 'motor', motor.id);
        root.add(model.group);
        entry = { motor, model, base: new Quaternion() };
        motors.set(motor.id, entry);
      }
      // 継手の太さは今のシャフトの見た目の半径に合わせる（入れ子の中空軸。S3-03）
      setCouplingRadius(entry.model.spin, motor.size, shaftRadius);
      placeOnAxis(entry.model.group, motorCenter(placed, motor.size), placed.axis);
      entry.base.copy(entry.model.group.quaternion);
    }
  }

  // 固定具は少ないので、シーンかレイアウトが変わるたびに全部置き直す
  function syncAnchors(scene: Scene, layout: Layout): void {
    for (const entry of anchors.values()) root.remove(entry.group);
    anchors.clear();
    for (const anchor of Object.values(scene.anchors)) {
      if (anchor.target.kind === 'rack') {
        // ラックの固定具（S3-04）: 台座・支柱・足を作っておき、update でラックの今の位置に置く
        if (layout.racks[anchor.target.id] === undefined) continue;
        const group = new Group();
        const base = new Mesh(anchorBaseGeometry, shaftMaterials.none);
        base.castShadow = true;
        const pillar = new Mesh(anchorPillarGeometry, shaftMaterials.none);
        pillar.castShadow = true;
        const foot = new Mesh(anchorFootGeometry, shaftMaterials.none);
        foot.receiveShadow = true;
        group.add(base, pillar, foot);
        group.userData.anchorId = anchor.id;
        root.add(group);
        anchors.set(anchor.id, {
          anchor,
          group,
          parts: [base, pillar, foot],
          rack: { base, pillar, foot },
        });
        continue;
      }
      const placed = layout.shafts[anchor.target.id];
      if (placed === undefined) continue;
      const motor = Object.values(scene.motors).find((m) => m.shaftId === anchor.target.id);
      const frame = anchorFrame(
        placed,
        motor === undefined ? null : motorLength(motor.size),
        MOTOR_GAP,
      );
      const group = new Group();
      const base = new Mesh(anchorBaseGeometry, shaftMaterials.none);
      base.castShadow = true;
      placeOnAxis(base, frame.baseCenter, placed.axis);
      group.add(base);
      const parts: Mesh[] = [base];
      if (frame.pillar !== null) {
        const { top, bottom } = frame.pillar;
        const pillar = new Mesh(anchorPillarGeometry, shaftMaterials.none);
        pillar.castShadow = true;
        pillar.scale.y = top[1] - bottom[1];
        pillar.position.set(top[0], (top[1] + bottom[1]) / 2, top[2]);
        const foot = new Mesh(anchorFootGeometry, shaftMaterials.none);
        foot.position.set(bottom[0], bottom[1] + ANCHOR_FOOT_THICKNESS / 2, bottom[2]);
        foot.receiveShadow = true;
        group.add(pillar, foot);
        parts.push(pillar, foot);
      }
      group.userData.anchorId = anchor.id;
      root.add(group);
      anchors.set(anchor.id, { anchor, group, parts, rack: null });
    }
  }

  // ids のどれかに当てはまれば効く（モーターは自分とそのシャフト）。
  // 優先順位: 仮の部品の見た目 → ロック → 干渉（どちらも選択・マウスと組み合わせる）→ 選択 → マウス
  function levelOf(...ids: string[]): MaterialLevel {
    const any = (has: (id: string) => boolean): boolean => ids.some(has);
    if (preview !== null && any((id) => preview?.ids.has(id) === true)) {
      if (preview.ghost) return preview.invalid ? 'ghostInvalid' : 'ghost';
      if (preview.invalid) return 'invalid';
    }
    const emphasis: Emphasis = any((id) => id === highlight.selected)
      ? 'selected'
      : any((id) => id === highlight.hovered)
        ? 'hovered'
        : 'none';
    if (any((id) => warnings.locked.has(id))) return `locked-${emphasis}`;
    if (any((id) => warnings.interfering.has(id))) return `interfering-${emphasis}`;
    return emphasis;
  }

  // 作り直した部品にも効くように、sync と setHighlight のたびに全部品の材質を選び直す
  function applyHighlight(): void {
    version++;
    for (const [id, entry] of gears) {
      entry.body.material = colorSetOr(entry.gear.color, gearMaterials[entry.gear.kind])[
        levelOf(id)
      ];
    }
    for (const [id, entry] of shafts) entry.object.material = shaftMaterials[levelOf(id)];
    // モーターはシャフトとして選ばれるので、シャフトと同じに光らせる（仮の部品の見た目も同じ）
    for (const entry of motors.values()) {
      const level = levelOf(entry.motor.id, entry.motor.shaftId);
      for (const { part, mesh } of entry.model.meshes) mesh.material = motorMaterials[part][level];
    }
    // キャリアは自分とそのシャフトの状態で光らせる（S3-03）。材質はキャリアの表（S3-05）
    for (const [id, entry] of carriers) {
      const set = colorSetOr(entry.carrier.color, partMaterials.carrier);
      const material = set[levelOf(id, entry.carrier.shaftId)];
      for (const part of entry.parts) part.material = material;
    }
    // ラック（S3-04）。材質はラックの表（S3-05）
    for (const [id, entry] of racks) {
      entry.body.material = colorSetOr(entry.rack.color, partMaterials.rack)[levelOf(id)];
    }
    // 固定具は固定したシャフト（ラック）と同じに光らせる（ロックの赤・選択の水色。S3-01）。材質は固定具の表（S3-05）
    for (const entry of anchors.values()) {
      const set = colorSetOr(entry.anchor.color, partMaterials.anchor);
      const material = set[levelOf(entry.anchor.target.id)];
      for (const part of entry.parts) part.material = material;
    }
  }

  // ロック中なら軸まわりの小さなゆれ（rad）。描画だけに加える
  const shakeOf = (id: string, timeSec: number): number =>
    warnings.locked.has(id) ? lockShakeAngle(timeSec, shakeSeedOf(id)) : 0;
  const shaken = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);
  function shake(object: Object3D, base: Quaternion, angle: number): void {
    if (angle === 0) {
      object.quaternion.copy(base);
      return;
    }
    shaken.setFromAxisAngle(zAxis, angle);
    object.quaternion.copy(base).multiply(shaken);
  }

  return {
    root,
    sync(scene, layout) {
      if (scene === lastScene && layout === lastLayout) return;
      syncGears(scene, layout);
      syncShafts(scene, layout);
      syncMotors(scene, layout);
      syncAnchors(scene, layout);
      syncCarriers(scene, layout);
      syncRacks(scene, layout);
      lastScene = scene;
      lastLayout = layout;
      applyHighlight();
    },
    setHighlight(next) {
      if (next.selected === highlight.selected && next.hovered === highlight.hovered) return;
      highlight = { selected: next.selected, hovered: next.hovered };
      applyHighlight();
    },
    setPreviewStyle(style) {
      if (style === preview) return;
      preview = style;
      applyHighlight();
    },
    setWarnings(next) {
      if (
        sameSet(next.locked, warnings.locked) &&
        sameSet(next.interfering, warnings.interfering)
      ) {
        return;
      }
      warnings = { locked: new Set(next.locked), interfering: new Set(next.interfering) };
      applyHighlight();
    },
    update(motion, layout, timeSec = 0) {
      for (const [id, entry] of gears) {
        const placed = layout.gears[id];
        if (placed === undefined) continue;
        // 遊星の歯車（S3-03）は公転した今の位置に置き直す
        if (placed.orbit !== undefined) {
          const c = gearWorldCenter(layout, motion, id);
          if (!sameXyz(entry.pivot.position, c)) version++;
          entry.pivot.position.set(c[0], c[1], c[2]);
        }
        const angle =
          placed.basePhase + (motion.angles[entry.gear.shaftId] ?? 0) + shakeOf(id, timeSec);
        if (entry.body.rotation.z !== angle) version++;
        entry.body.rotation.z = angle;
      }
      for (const [id, entry] of shafts) {
        const placed = layout.shafts[id];
        if (placed?.orbit !== undefined) {
          const mid = (placed.span[0] + placed.span[1]) / 2;
          const c = add(shaftWorldOrigin(layout, motion, id), scale(axisVector(placed.axis), mid));
          if (!sameXyz(entry.object.position, c)) version++;
          entry.object.position.set(c[0], c[1], c[2]);
        }
        shake(entry.object, entry.base, shakeOf(id, timeSec));
      }
      for (const entry of carriers.values()) {
        const angle =
          (motion.angles[entry.carrier.shaftId] ?? 0) + shakeOf(entry.carrier.shaftId, timeSec);
        if (entry.spin.rotation.z !== angle) version++;
        entry.spin.rotation.z = angle;
      }
      for (const [id, entry] of motors) {
        shake(entry.model.group, entry.base, shakeOf(id, timeSec));
        // 継手はシャフトと一緒に回る（S4-07）。本体（housing）は回らない
        const angle = motion.angles[entry.motor.shaftId] ?? 0;
        if (entry.model.spin.rotation.z !== angle) version++;
        entry.model.spin.rotation.z = angle;
      }
      // ラック（S3-04）: 基準位置 + (s + 歯溝のずれ)·direction。ロック中は動く向きに小さく震わせる
      for (const [id, entry] of racks) {
        const placed = layout.racks[id];
        if (placed === undefined) continue;
        const along = placed.grooveOffset + shakeOf(id, timeSec) * RACK_SHAKE_MM_PER_RAD;
        const at = add(
          rackWorldOrigin(layout, motion, id),
          scale(axisVector(placed.direction), along),
        );
        if (!sameXyz(entry.body.position, at)) version++;
        placeRack(entry.body, at, placed.direction, placed.normal, placed.normalSign);
      }
      for (const entry of anchors.values()) {
        if (entry.rack === null) continue;
        const placed = layout.racks[entry.anchor.target.id];
        const rack = lastScene?.racks[entry.anchor.target.id];
        if (placed === undefined || rack === undefined) continue;
        const frame = rackAnchorFrame(
          rackWorldOrigin(layout, motion, rack.id),
          rack.size,
          placed.normal,
          placed.normalSign,
        );
        const { base, pillar, foot } = entry.rack;
        placeOnAxis(base, frame.baseCenter, placed.normal);
        pillar.visible = frame.pillar !== null;
        foot.visible = frame.pillar !== null;
        if (frame.pillar !== null) {
          const { top, bottom } = frame.pillar;
          pillar.scale.y = top[1] - bottom[1];
          pillar.position.set(top[0], (top[1] + bottom[1]) / 2, top[2]);
          foot.position.set(bottom[0], bottom[1] + ANCHOR_FOOT_THICKNESS / 2, bottom[2]);
        }
      }
      if (warnings.locked.size > 0) {
        version++; // 震えている
        for (const set of uniqueSets(gearMaterials, partMaterials, colorMaterials)) {
          pulseLocked(set, timeSec);
        }
        pulseLocked(shaftMaterials, timeSec);
        for (const set of new Set(Object.values(motorMaterials))) pulseLocked(set, timeSec);
      }
    },
    setBaseMaterials(materials) {
      const old = [
        ...uniqueSets(gearMaterials, partMaterials, colorMaterials),
        shaftMaterials,
        ...new Set(Object.values(motorMaterials)),
      ];
      const sets = materialSets(materials.gear, materials.part, materials.colors);
      gearMaterials = sets.gear;
      partMaterials = sets.part;
      colorMaterials = sets.colors;
      shaftMaterials = materialSet(materials.shaft);
      motorMaterials = motorMaterialSets(materials.motor);
      applyHighlight();
      for (const set of old) disposeSet(set);
    },
    version: () => version,
    partMaterialColor(id) {
      const mesh =
        gears.get(id)?.body ??
        racks.get(id)?.body ??
        carriers.get(id)?.parts[0] ??
        anchors.get(id)?.parts[0];
      if (mesh === undefined) return null;
      return (mesh.material as MeshStandardMaterial).color.getHex();
    },
    gearCount: () => gears.size,
    anchorCount: () => anchors.size,
    carrierCount: () => carriers.size,
    rackCount: () => racks.size,
  };
}

function sameXyz(p: { x: number; y: number; z: number }, q: Vec3): boolean {
  return p.x === q[0] && p.y === q[1] && p.z === q[2];
}

// キャリアの形（S3-03）: 板の厚み、腕の長さ（公転半径）、腕の向き（遊星のシャフトの angle）
function carrierShapeOf(
  scene: Scene,
  layout: Layout,
  carrier: Carrier,
): { thickness: number; reach: number; angles: number[] } {
  const placed = layout.carriers[carrier.id];
  const shaft = layout.shafts[carrier.shaftId];
  const angles: number[] = [];
  let reach = 0;
  for (const id of placed?.planetShaftIds ?? []) {
    const p = scene.shafts[id]?.placement;
    const at = layout.shafts[id];
    if (p?.kind !== 'planet' || at === undefined || shaft === undefined) continue;
    angles.push(p.angle);
    const d = [
      at.origin[0] - shaft.origin[0],
      at.origin[1] - shaft.origin[1],
      at.origin[2] - shaft.origin[2],
    ] as const;
    const w = axisVector(shaft.axis);
    const along = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
    reach = Math.max(reach, Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - along ** 2)));
  }
  return { thickness: CARRIER_THICKNESS[carrier.size], reach, angles };
}
