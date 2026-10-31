import {
  AXIAL_SNAP,
  DEFAULT_PLANET_COUNT,
  GEAR_SIZES,
  MOTOR_RPM_RANGE,
  MOTOR_SIZES,
  PLANET_COUNT_RANGE,
  RACK_TEETH,
  WORM_THREADS,
} from '../constants';
import { canMesh, meshGeometryOf } from '../geometry/can-mesh';
import { teethInRange, teethRange } from '../geometry/dimensions';
import { defaultPlanetTeeth, planetaryOk, planetCountInRange } from '../geometry/planetary';
import { rackTeethInRange, snapRackPosition } from '../geometry/rack';
import { newInterferences } from '../layout/interference-diff';
import {
  defaultShaftSpan,
  descendantShafts,
  requiredShaftSpans,
  resolveLayout,
  type ShaftSpan,
  spanContains,
  unionSpan,
  withShaftSpans,
} from '../layout/resolve';
import type { Layout } from '../layout/types';
import type { Vec3 } from '../math/vec3';
import {
  gearShape,
  internalEncloseShape,
  isGearKind,
  isWebSide,
  makeGear,
  meshPartnerShape,
  newGearShape,
  skewPartnerShape,
} from '../scene/gear-shape';
import type { IdGenerator } from '../scene/ids';
import { withPlanetary } from '../scene/planetary';
import { anchorOfRack, anchorOfShaft, planetShaftsOf } from '../scene/scene';
import { shaftAxis } from '../scene/shaft-axis';
import {
  type Anchor,
  type AnchorId,
  type Axis,
  type Carrier,
  type CarrierId,
  type FreePlacement,
  type Gear,
  type GearId,
  type GearKind,
  type GearShape,
  isChildPlacement,
  isFreePlacement,
  type Motor,
  type MotorId,
  type Rack,
  type RackId,
  type Scene,
  type Shaft,
  type ShaftId,
  type ShaftPlacement,
  type SizeKey,
} from '../scene/types';
import { validateScene } from '../scene/validate';

// 編集コマンド（design.md §7）。不変のシーンに対する純粋関数で、新しいシーンを返す。
// 変わらない部分は元の参照を使い回し、何も変わらなければ同じシーンの参照を返す。
// 失敗は例外にせずエラーの結果を返す（シーンは変わらない）。
// 干渉を理由には失敗しない（干渉は resolveLayout の interferences が赤い警告として出す）

export type Command =
  // gear.kind は省くと 'spur'。ハスバ歯車は hand 'right'（S2-01）。ウォームは teeth によらず 1 条（S2-03）
  | {
      type: 'addRootShaft';
      axis: Axis;
      origin: Vec3;
      gear: { size: SizeKey; teeth: number; kind?: GearKind };
    }
  // 子の種類は親から決まる（平歯車は平歯車、ハスバ歯車は逆の hand。S2-01）。かさ歯車の親は notAllowed。
  // 内歯車の親（S3-02）は内側に平歯車を生やす。歯数差が INTERNAL_MIN_TOOTH_DIFF 未満なら notAllowed
  | { type: 'growGear'; mode: 'perimeter'; parentGearId: GearId; angle: number; teeth: number }
  // 平歯車の親を囲む内歯車（S3-02。webSide −1、offset 0）と mesh のシャフト。内歯車の中心は親の中心から angle の向きに R − r。
  // 平歯車以外の親、歯数差が足りない組は notAllowed
  | { type: 'growGear'; mode: 'enclose'; parentGearId: GearId; angle: number; teeth: number }
  // かさ歯車の親とかみ合う、同じ大きさ・同じ歯数のかさ歯車（apex −side、offset 0）と bevel のシャフト（S2-02）
  | {
      type: 'growGear';
      mode: 'bevel';
      parentGearId: GearId;
      axisStep: 1 | 2;
      side: 1 | -1;
    }
  // ウォーム・ホイールの親とかみ合う、ねじれた位置の 90° の相手（ウォームにはホイール、ホイールにはウォーム。
  // 同じ大きさ、offset 0）と skew のシャフト（S2-03）。teeth はホイールを作るときの歯数（ウォームを作るときは使わない）
  | {
      type: 'growGear';
      mode: 'skew';
      parentGearId: GearId;
      axisStep: 1 | 2;
      side: 1 | -1;
      teeth: number;
    }
  // 平歯車の親を太陽とする遊星歯車機構（S3-03）。キャリアのシャフト（concentric）とキャリア、遊星のシャフト（planet）と
  // 遊星歯車 DEFAULT_PLANET_COUNT 個（太陽と同じ大きさ）、リングのシャフト（concentric）と内歯車（webSide −1、offset は太陽と同じ）。
  // 歯数は defaultPlanetTeeth。作れなければ（平歯車でない・遊星のシャフトの歯車・歯数の組が無い）notAllowed
  | { type: 'growGear'; mode: 'planetary'; parentGearId: GearId }
  // シャフト上の位置を指定して歯車を足す（S4-03。パレットで選んだ種類をシャフトの上に置く）。
  // kind は省くと 'spur'。ハスバ歯車は hand 'right'（S2-01）。ウォームは teeth によらず 1 条（S2-03）。
  // 同じシャフトのほかの歯車やほかの部品と重なる（新しい干渉を生む）位置は notAllowed。シャフトからはみ出せばシャフトが伸びる
  | {
      type: 'growGear';
      mode: 'coaxial';
      shaftId: ShaftId;
      offset: number;
      size: SizeKey;
      teeth: number;
      kind?: GearKind;
    }
  // ラックに 2 つ目以降のピニオン（同じ大きさの平歯車、offset 0）と 'rack' のシャフトを作る（S3-04）。
  // position は π·m の整数倍に吸着させる
  | { type: 'growGear'; mode: 'rack'; rackId: RackId; position: number; teeth: number }
  // 平歯車をピニオンにしたラック（同じ大きさ、pinion の配置）を作る（S3-04）。平歯車でない・遊星のシャフトの歯車は notAllowed
  | { type: 'growRack'; gearId: GearId; axisStep: 1 | 2; normalSign: 1 | -1; teeth: number }
  // ラックの歯数を変える（S3-04。RACK_TEETH の範囲）。長さと s の範囲が変わる（今の s が範囲外なら運動の側で端に寄せる）
  | { type: 'setRackTeeth'; rackId: RackId; teeth: number }
  | { type: 'deleteParts'; ids: string[] }
  // キャリアの遊星の数を変える（S3-03）。遊星のシャフトを作り直して等配にする（1 本目の遊星のシャフトの歯車の並びを写す）。
  // 範囲外・配置の条件（planetaryConditions）を満たさない数は notAllowed
  | { type: 'setPlanetCount'; carrierId: CarrierId; count: number }
  // かさ歯車では、木の親子（bevel の配置）でつながったかさ歯車すべての歯数を同じ値にする（S2-02）。
  // ウォームの歯数（条数）は変えられない（notAllowed。S2-03）
  | { type: 'setGearTeeth'; gearId: GearId; teeth: number }
  // かさ歯車の apex を反転する（S2-02）。bevel の配置の子（apex は −side で決まる）は notAllowed
  | { type: 'flipBevelApex'; gearId: GearId }
  // 内歯車のウェブの向きを変える（S3-02。区画（offset）はそのまま。UI は S3-05）
  | { type: 'setWebSide'; gearId: GearId; webSide: 1 | -1 }
  | { type: 'setMeshAngle'; shaftId: ShaftId; angle: number }
  | { type: 'setGearOffset'; gearId: GearId; offset: number }
  // シャフトの範囲を変える（S4-03。伸縮のつまみ）。変えた端は AXIAL_SNAP の倍数でなければ invalidValue。
  // 載っている部品の範囲より短い・新しい干渉を生む（ほかの部品にぶつかる）範囲は notAllowed
  | { type: 'setShaftSpan'; shaftId: ShaftId; span: readonly [number, number] }
  | { type: 'addMotor'; shaftId: ShaftId; size: SizeKey }
  | { type: 'removeMotor'; motorId: MotorId }
  | {
      type: 'updateMotor';
      motorId: MotorId;
      patch: Partial<Pick<Motor, 'size' | 'rpm' | 'direction' | 'on'>>;
    }
  // シャフトを固定する（S3-01）。歯車を固定するときは、その歯車のシャフトを渡す。
  // 既に固定されていれば何もしない（同じシーンを返す）
  | { type: 'addAnchor'; shaftId: ShaftId }
  // ラックを固定する（S3-04。拘束 v = 0）。既に固定されていれば何もしない
  | { type: 'addAnchor'; rackId: RackId }
  | { type: 'removeAnchor'; anchorId: AnchorId }
  | { type: 'moveShaft'; shaftId: ShaftId; origin: Vec3 }
  | { type: 'setShaftAxis'; shaftId: ShaftId; axis: Axis }
  | {
      type: 'reattachShaft';
      shaftId: ShaftId;
      childGearId: GearId;
      parentGearId: GearId;
      angle: number;
    }
  | { type: 'replaceScene'; scene: Scene };

export type CommandErrorCode = 'notFound' | 'invalidValue' | 'notAllowed'; // 干渉では失敗しない
export interface CommandError {
  code: CommandErrorCode;
  message: string;
}
export interface CommandContext {
  ids: IdGenerator;
}
export type CommandResult =
  | { ok: true; scene: Scene; created: string[] } // created: 新しく作った部品の ID（作った順）
  | { ok: false; error: CommandError };

type Failure = Extract<CommandResult, { ok: false }>;

const TWO_PI = 2 * Math.PI;

function fail(code: CommandErrorCode, message: string): Failure {
  return { ok: false, error: { code, message } };
}

function done(scene: Scene, created: string[] = []): CommandResult {
  return { ok: true, scene, created };
}

// 角度を [0, 2π) に正規化する
export function normalizeAngle(angle: number): number {
  const a = angle % TWO_PI;
  const b = a < 0 ? a + TWO_PI : a;
  // -0 と、丸めで 2π になった値を 0 にそろえる
  return b === 0 || b >= TWO_PI ? 0 : b;
}

function isAxis(axis: unknown): axis is Axis {
  return axis === 'x' || axis === 'y' || axis === 'z';
}

function isSizeKey(size: unknown): size is SizeKey {
  return typeof size === 'string' && Object.hasOwn(GEAR_SIZES, size);
}

function isFiniteVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x));
}

function sameVec3(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

// 歯数が種類と大きさの範囲（teethRange。内歯車は INTERNAL_MIN_TEETH から。S3-02）に入る整数か
function teethError(size: SizeKey, teeth: number, kind: GearKind = 'spur'): Failure | null {
  const { min, max } = teethRange(kind, size);
  if (!Number.isInteger(teeth) || teeth < min || teeth > max) {
    return fail('invalidValue', `teeth ${teeth} out of range [${min}, ${max}] for ${kind} ${size}`);
  }
  return null;
}

function isSnapped(offset: number): boolean {
  return Number.isFinite(offset) && offset % AXIAL_SNAP === 0;
}

function snapError(offset: number): Failure {
  return fail('invalidValue', `offset ${offset} is not a multiple of ${AXIAL_SNAP}`);
}

// -0 を 0 にそろえる
function clean(x: number): number {
  return x === 0 ? 0 : x;
}

function withEntry<T>(
  record: Readonly<Record<string, T>>,
  id: string,
  value: T,
): Readonly<Record<string, T>> {
  return { ...record, [id]: value };
}

// コマンドを実行する。成功してシーンが変わったら、シャフトの範囲を部品に合わせる（fitShaftSpans。S4-03）
export function applyCommand(scene: Scene, command: Command, ctx: CommandContext): CommandResult {
  const result = applyRaw(scene, command, ctx);
  if (!result.ok || result.scene === scene) return result;
  return { ...result, scene: fitShaftSpans(scene, result.scene) };
}

// 編集のあとのシャフトの範囲（S4-03）。
// - 編集で新しくできたシャフト: 載っている部品の範囲（部品が無ければ ±EMPTY_SHAFT_HALF_LENGTH）
// - 部品にぴったりだったシャフト（編集の前の範囲が、載っている部品の範囲と同じ。version 3 から移したシャフトや、伸縮していない
//   シャフト）: 部品が変われば、新しい部品の範囲にする（部品についていく。かさ歯車の頂点・内歯車のウェブの向きが変わっても、
//   相手の部品や空洞へ伸びたまま残らない）
// - それ以外（伸縮したシャフト）: 載っている部品がはみ出していれば、その分だけ伸ばす（縮めない）
// 範囲を省いたままの既存のシャフト（テストで組んだシーンなど）はそのまま（レイアウトが部品から求める）
export function fitShaftSpans(prev: Scene, next: Scene): Scene {
  const required = requiredShaftSpans(next);
  let before: Readonly<Record<ShaftId, ShaftSpan | null>> | null = null;
  let shafts: Record<ShaftId, Shaft> | null = null;
  for (const shaft of Object.values(next.shafts)) {
    if (!Object.hasOwn(required, shaft.id)) continue;
    const need = required[shaft.id] ?? null;
    let span: ShaftSpan | null = null;
    const old = prev.shafts[shaft.id];
    if (shaft.span === undefined) {
      if (old === undefined) span = defaultShaftSpan(need);
    } else {
      before ??= requiredShaftSpans(prev);
      const was = before[shaft.id] ?? null;
      const tight =
        old?.span !== undefined &&
        was !== null &&
        sameSpan(old.span, was) &&
        sameSpan(shaft.span, was);
      if (tight && need !== null && !sameSpan(need, was)) span = need;
      else if (!spanContains(shaft.span, need)) span = unionSpan(shaft.span, need);
    }
    if (span === null) continue;
    shafts ??= { ...next.shafts };
    shafts[shaft.id] = { ...shaft, span: [clean(span[0]), clean(span[1])] };
  }
  return shafts === null ? next : { ...next, shafts };
}

function sameSpan(a: ShaftSpan, b: ShaftSpan): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9;
}

function applyRaw(scene: Scene, command: Command, ctx: CommandContext): CommandResult {
  switch (command.type) {
    case 'addRootShaft':
      return addRootShaft(scene, command, ctx);
    case 'growGear':
      switch (command.mode) {
        case 'perimeter':
          return growPerimeter(scene, command, ctx);
        case 'bevel':
          return growBevel(scene, command, ctx);
        case 'skew':
          return growSkew(scene, command, ctx);
        case 'enclose':
          return growEnclose(scene, command, ctx);
        case 'planetary':
          return growPlanetary(scene, command, ctx);
        case 'rack':
          return growRackPinion(scene, command, ctx);
        default:
          return growCoaxial(scene, command, ctx);
      }
    case 'growRack':
      return growRack(scene, command, ctx);
    case 'setRackTeeth':
      return setRackTeeth(scene, command);
    case 'deleteParts':
      return deleteParts(scene, command.ids);
    case 'setPlanetCount':
      return setPlanetCount(scene, command, ctx);
    case 'setGearTeeth':
      return setGearTeeth(scene, command);
    case 'flipBevelApex':
      return flipBevelApex(scene, command);
    case 'setWebSide':
      return setWebSide(scene, command);
    case 'setMeshAngle':
      return setMeshAngle(scene, command);
    case 'setGearOffset':
      return setGearOffset(scene, command);
    case 'setShaftSpan':
      return setShaftSpan(scene, command);
    case 'addMotor':
      return addMotor(scene, command, ctx);
    case 'removeMotor':
      if (scene.motors[command.motorId] === undefined) {
        return fail('notFound', `motor ${command.motorId} not found`);
      }
      return deleteParts(scene, [command.motorId]);
    case 'updateMotor':
      return updateMotor(scene, command);
    case 'addAnchor':
      return addAnchor(scene, command, ctx);
    case 'removeAnchor':
      return removeAnchor(scene, command);
    case 'moveShaft':
      return moveShaft(scene, command);
    case 'setShaftAxis':
      return setShaftAxis(scene, command);
    case 'reattachShaft':
      return reattachShaft(scene, command);
    case 'replaceScene':
      return replaceScene(scene, command.scene);
    default:
      return fail('invalidValue', `unknown command ${String((command as { type: unknown }).type)}`);
  }
}

function addRootShaft(
  scene: Scene,
  c: Extract<Command, { type: 'addRootShaft' }>,
  ctx: CommandContext,
): CommandResult {
  if (!isAxis(c.axis)) return fail('invalidValue', `invalid axis ${String(c.axis)}`);
  if (!isFiniteVec3(c.origin)) return fail('invalidValue', 'origin must be 3 finite numbers');
  if (!isSizeKey(c.gear.size)) return fail('invalidValue', `invalid size ${String(c.gear.size)}`);
  const kind = c.gear.kind ?? 'spur';
  if (!isGearKind(kind)) return fail('invalidValue', `invalid gear kind ${String(kind)}`);
  const bad = kind === 'worm' ? null : teethError(c.gear.size, c.gear.teeth, kind);
  if (bad) return bad;
  const teeth = kind === 'worm' ? WORM_THREADS : c.gear.teeth;
  const shaftId = ctx.ids('shaft');
  const gearId = ctx.ids('gear');
  const shaft: Shaft = {
    id: shaftId,
    placement: { kind: 'root', origin: copyVec3(c.origin), axis: c.axis },
  };
  const gear = makeGear(
    { id: gearId, shaftId, size: c.gear.size, teeth, offset: 0 },
    newGearShape(kind),
  );
  return done(
    {
      shafts: withEntry(scene.shafts, shaftId, shaft),
      gears: withEntry(scene.gears, gearId, gear),
      motors: scene.motors,
      anchors: scene.anchors,
      carriers: scene.carriers,
      racks: scene.racks,
    },
    [shaftId, gearId],
  );
}

// 親と同じ大きさの歯車（offset 0）と、それを子に持つ mesh のシャフトを作る
// 遊星のシャフトの歯車からは外へ生やさない（同じ軸の段付きの遊星だけ。S3-03）
function orbitingParentError(scene: Scene, parent: Gear): Failure | null {
  if (scene.shafts[parent.shaftId]?.placement.kind !== 'planet') return null;
  return fail('notAllowed', `gear ${parent.id} is on a planet shaft`);
}

function growPerimeter(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'perimeter' }>,
  ctx: CommandContext,
): CommandResult {
  const parent = scene.gears[c.parentGearId];
  if (parent === undefined) return fail('notFound', `gear ${c.parentGearId} not found`);
  const orbiting = orbitingParentError(scene, parent);
  if (orbiting) return orbiting;
  if (!Number.isFinite(c.angle)) return fail('invalidValue', 'angle must be finite');
  const bad = teethError(parent.size, c.teeth);
  if (bad) return bad;
  const shape = meshPartnerShape(gearShape(parent));
  if (shape === null) {
    return fail('notAllowed', `gear ${parent.id} (${parent.kind}) cannot grow a perimeter gear`);
  }
  return growMeshChild(scene, parent, c.angle, c.teeth, shape, ctx);
}

// 平歯車の親を囲む内歯車（webSide −1、offset 0）と mesh のシャフトを作る（S3-02）
function growEnclose(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'enclose' }>,
  ctx: CommandContext,
): CommandResult {
  const parent = scene.gears[c.parentGearId];
  if (parent === undefined) return fail('notFound', `gear ${c.parentGearId} not found`);
  const orbiting = orbitingParentError(scene, parent);
  if (orbiting) return orbiting;
  if (!Number.isFinite(c.angle)) return fail('invalidValue', 'angle must be finite');
  const shape = internalEncloseShape(gearShape(parent));
  if (shape === null) {
    return fail('notAllowed', `gear ${parent.id} (${parent.kind}) cannot be enclosed`);
  }
  const bad = teethError(parent.size, c.teeth, shape.kind);
  if (bad) return bad;
  return growMeshChild(scene, parent, c.angle, c.teeth, shape, ctx);
}

// 親と同じ大きさの歯車 shape（offset 0）と、それを子に持つ mesh のシャフト。かみ合えない組（内歯車の歯数差。S3-02）は notAllowed
function growMeshChild(
  scene: Scene,
  parent: Gear,
  angle: number,
  teeth: number,
  shape: GearShape,
  ctx: CommandContext,
): CommandResult {
  const probe = makeGear(
    { id: '__probe', shaftId: '__probe', size: parent.size, teeth, offset: 0 },
    shape,
  );
  if (!canMesh(probe, parent)) {
    return fail(
      'notAllowed',
      `a ${shape.kind} gear of ${teeth} teeth cannot mesh with ${parent.id}`,
    );
  }
  const shaftId = ctx.ids('shaft');
  const gearId = ctx.ids('gear');
  const shaft: Shaft = {
    id: shaftId,
    placement: {
      kind: 'mesh',
      parentGearId: parent.id,
      childGearId: gearId,
      angle: normalizeAngle(angle),
    },
  };
  const gear = makeGear({ id: gearId, shaftId, size: parent.size, teeth, offset: 0 }, shape);
  return done(
    {
      shafts: withEntry(scene.shafts, shaftId, shaft),
      gears: withEntry(scene.gears, gearId, gear),
      motors: scene.motors,
      anchors: scene.anchors,
      carriers: scene.carriers,
      racks: scene.racks,
    },
    [shaftId, gearId],
  );
}

// かさ歯車の親に、直交する軸のかさ歯車（同じ大きさ・同じ歯数、apex −side、offset 0）と bevel のシャフトを作る（S2-02）
function growBevel(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'bevel' }>,
  ctx: CommandContext,
): CommandResult {
  const parent = scene.gears[c.parentGearId];
  if (parent === undefined) return fail('notFound', `gear ${c.parentGearId} not found`);
  const orbiting = orbitingParentError(scene, parent);
  if (orbiting) return orbiting;
  if (parent.kind !== 'bevel') return fail('notAllowed', `gear ${parent.id} is not a bevel gear`);
  if (c.axisStep !== 1 && c.axisStep !== 2) {
    return fail('invalidValue', `axisStep must be 1 or 2: ${String(c.axisStep)}`);
  }
  if (c.side !== 1 && c.side !== -1) {
    return fail('invalidValue', `side must be 1 or -1: ${String(c.side)}`);
  }
  const shaftId = ctx.ids('shaft');
  const gearId = ctx.ids('gear');
  const shaft: Shaft = {
    id: shaftId,
    placement: {
      kind: 'bevel',
      parentGearId: parent.id,
      childGearId: gearId,
      axisStep: c.axisStep,
      side: c.side,
    },
  };
  const gear = makeGear(
    { id: gearId, shaftId, size: parent.size, teeth: parent.teeth, offset: 0 },
    { kind: 'bevel', apex: c.side === 1 ? -1 : 1 },
  );
  return done(
    {
      shafts: withEntry(scene.shafts, shaftId, shaft),
      gears: withEntry(scene.gears, gearId, gear),
      motors: scene.motors,
      anchors: scene.anchors,
      carriers: scene.carriers,
      racks: scene.racks,
    },
    [shaftId, gearId],
  );
}

// ウォーム・ホイールの親に、ねじれた位置の 90° の相手（同じ大きさ、offset 0）と skew のシャフトを作る（S2-03）
function growSkew(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'skew' }>,
  ctx: CommandContext,
): CommandResult {
  const parent = scene.gears[c.parentGearId];
  if (parent === undefined) return fail('notFound', `gear ${c.parentGearId} not found`);
  const orbiting = orbitingParentError(scene, parent);
  if (orbiting) return orbiting;
  const shape = skewPartnerShape(gearShape(parent));
  if (shape === null) {
    return fail('notAllowed', `gear ${parent.id} (${parent.kind}) cannot grow a skew gear`);
  }
  if (c.axisStep !== 1 && c.axisStep !== 2) {
    return fail('invalidValue', `axisStep must be 1 or 2: ${String(c.axisStep)}`);
  }
  if (c.side !== 1 && c.side !== -1) {
    return fail('invalidValue', `side must be 1 or -1: ${String(c.side)}`);
  }
  const bad = shape.kind === 'worm' ? null : teethError(parent.size, c.teeth);
  if (bad) return bad;
  const shaftId = ctx.ids('shaft');
  const gearId = ctx.ids('gear');
  const shaft: Shaft = {
    id: shaftId,
    placement: {
      kind: 'skew',
      parentGearId: parent.id,
      childGearId: gearId,
      axisStep: c.axisStep,
      side: c.side,
    },
  };
  const teeth = shape.kind === 'worm' ? WORM_THREADS : c.teeth;
  const gear = makeGear({ id: gearId, shaftId, size: parent.size, teeth, offset: 0 }, shape);
  return done(
    {
      shafts: withEntry(scene.shafts, shaftId, shaft),
      gears: withEntry(scene.gears, gearId, gear),
      motors: scene.motors,
      anchors: scene.anchors,
      carriers: scene.carriers,
      racks: scene.racks,
    },
    [shaftId, gearId],
  );
}

// 平歯車の親を太陽とする遊星歯車機構を作る（S3-03）。created は [キャリアのシャフト, キャリア,
// （遊星のシャフト, 遊星歯車）× n, リングのシャフト, リング]
function growPlanetary(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'planetary' }>,
  ctx: CommandContext,
): CommandResult {
  const sun = scene.gears[c.parentGearId];
  if (sun === undefined) return fail('notFound', `gear ${c.parentGearId} not found`);
  if (sun.kind !== 'spur') return fail('notAllowed', `gear ${sun.id} is not a spur gear`);
  const orbiting = orbitingParentError(scene, sun);
  if (orbiting) return orbiting;
  const n = DEFAULT_PLANET_COUNT;
  const teeth = defaultPlanetTeeth(sun, n);
  if (teeth === null) {
    return fail('notAllowed', `no planet teeth fit sun ${sun.id} (${sun.size}, ${sun.teeth})`);
  }
  const carrierShaftId = ctx.ids('shaft');
  const carrierId = ctx.ids('carrier');
  const planets = Array.from({ length: n }, () => ({
    shaftId: ctx.ids('shaft'),
    gearId: ctx.ids('gear'),
  }));
  const ringShaftId = ctx.ids('shaft');
  const ringId = ctx.ids('gear');
  const next = withPlanetary(
    scene,
    sun,
    { carrierShaftId, carrierId, planets, ringShaftId, ringId },
    teeth,
  );
  return done(next, [
    carrierShaftId,
    carrierId,
    ...planets.flatMap((p) => [p.shaftId, p.gearId]),
    ringShaftId,
    ringId,
  ]);
}

// 平歯車をピニオンにしたラック（S3-04）。同じ大きさ、pinion の配置。created は [ラック]
function growRack(
  scene: Scene,
  c: Extract<Command, { type: 'growRack' }>,
  ctx: CommandContext,
): CommandResult {
  const pinion = scene.gears[c.gearId];
  if (pinion === undefined) return fail('notFound', `gear ${c.gearId} not found`);
  if (pinion.kind !== 'spur') return fail('notAllowed', `gear ${pinion.id} is not a spur gear`);
  const orbiting = orbitingParentError(scene, pinion);
  if (orbiting) return orbiting;
  if (c.axisStep !== 1 && c.axisStep !== 2) {
    return fail('invalidValue', `axisStep must be 1 or 2: ${String(c.axisStep)}`);
  }
  if (c.normalSign !== 1 && c.normalSign !== -1) {
    return fail('invalidValue', `normalSign must be 1 or -1: ${String(c.normalSign)}`);
  }
  const bad = rackTeethError(c.teeth);
  if (bad) return bad;
  const rackId = ctx.ids('rack');
  const rack: Rack = {
    id: rackId,
    size: pinion.size,
    teeth: c.teeth,
    placement: {
      kind: 'pinion',
      gearId: pinion.id,
      axisStep: c.axisStep,
      normalSign: c.normalSign,
    },
  };
  return done({ ...scene, racks: withEntry(scene.racks, rackId, rack) }, [rackId]);
}

// ラックに 2 つ目以降のピニオン（同じ大きさの平歯車、offset 0）と 'rack' のシャフトを作る（S3-04）。created は [シャフト, 歯車]
function growRackPinion(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'rack' }>,
  ctx: CommandContext,
): CommandResult {
  const rack = scene.racks[c.rackId];
  if (rack === undefined) return fail('notFound', `rack ${c.rackId} not found`);
  if (!Number.isFinite(c.position)) return fail('invalidValue', 'position must be finite');
  const bad = teethError(rack.size, c.teeth);
  if (bad) return bad;
  const shaftId = ctx.ids('shaft');
  const gearId = ctx.ids('gear');
  const shaft: Shaft = {
    id: shaftId,
    placement: {
      kind: 'rack',
      rackId: rack.id,
      childGearId: gearId,
      position: snapRackPosition(rack.size, c.position),
    },
  };
  const gear = makeGear(
    { id: gearId, shaftId, size: rack.size, teeth: c.teeth, offset: 0 },
    newGearShape('spur'),
  );
  return done(
    {
      ...scene,
      shafts: withEntry(scene.shafts, shaftId, shaft),
      gears: withEntry(scene.gears, gearId, gear),
    },
    [shaftId, gearId],
  );
}

function rackTeethError(teeth: number): Failure | null {
  if (!rackTeethInRange(teeth)) {
    return fail(
      'invalidValue',
      `rack teeth ${teeth} out of range [${RACK_TEETH.min}, ${RACK_TEETH.max}]`,
    );
  }
  return null;
}

function setRackTeeth(scene: Scene, c: Extract<Command, { type: 'setRackTeeth' }>): CommandResult {
  const rack = scene.racks[c.rackId];
  if (rack === undefined) return fail('notFound', `rack ${c.rackId} not found`);
  const bad = rackTeethError(c.teeth);
  if (bad) return bad;
  if (rack.teeth === c.teeth) return done(scene);
  return done({ ...scene, racks: withEntry(scene.racks, rack.id, { ...rack, teeth: c.teeth }) });
}

// 遊星歯車機構の部品（S3-03）。sun は遊星の親の歯車（外歯車）、planets は遊星のシャフトの親とかみ合う歯車、
// ring は遊星と contact でかみ合う、キャリアと同じ線上の内歯車（無ければ null）
interface Planetary {
  readonly carrier: Carrier;
  readonly planetShafts: readonly Shaft[];
  readonly sun: Gear;
  readonly planets: readonly Gear[];
  readonly ring: Gear | null;
}

function planetaryOfCarrier(scene: Scene, carrierId: CarrierId): Planetary | null {
  const carrier = scene.carriers[carrierId];
  if (carrier === undefined) return null;
  const planetShafts = planetShaftsOf(scene, carrierId);
  const first = planetShafts[0]?.placement;
  if (first?.kind !== 'planet') return null;
  const sun = scene.gears[first.parentGearId];
  if (sun === undefined) return null;
  const planets: Gear[] = [];
  for (const shaft of planetShafts) {
    const p = shaft.placement;
    const g = p.kind === 'planet' ? scene.gears[p.childGearId] : undefined;
    if (g !== undefined) planets.push(g);
  }
  const planetIds = new Set(planets.map((g) => g.id));
  let ring: Gear | null = null;
  for (const m of resolveLayout(scene).meshes) {
    if (m.carrierShaftId !== carrier.shaftId) continue;
    const other = planetIds.has(m.a) ? m.b : planetIds.has(m.b) ? m.a : null;
    const gear = other === null ? undefined : scene.gears[other];
    if (gear?.kind === 'internal' && gear.id !== sun.id) {
      ring = gear;
      break;
    }
  }
  return { carrier, planetShafts, sun, planets, ring };
}

// 歯車がかかわる遊星歯車機構（太陽・遊星・リングのどれか）。無ければ null
function planetaryOfGear(scene: Scene, gearId: GearId): Planetary | null {
  for (const carrierId of Object.keys(scene.carriers).sort()) {
    const shafts = planetShaftsOf(scene, carrierId);
    const involved = shafts.some((s) => {
      const p = s.placement;
      return p.kind === 'planet' && (p.parentGearId === gearId || p.childGearId === gearId);
    });
    const planetary = planetaryOfCarrier(scene, carrierId);
    if (planetary === null) continue;
    if (involved || planetary.ring?.id === gearId) return planetary;
  }
  return null;
}

// プロパティパネルの選択肢（S3-05）: キャリアの遊星の数のうち、配置の条件を満たす数（昇順）。
// 遊星が無いキャリア・無いキャリアは空。setPlanetCount が受け付ける数と一致する
export function allowedPlanetCounts(scene: Scene, carrierId: CarrierId): number[] {
  const planetary = planetaryOfCarrier(scene, carrierId);
  const tp = planetary?.planetShafts[0]?.placement;
  if (planetary === null || tp?.kind !== 'planet') return [];
  const zp = scene.gears[tp.childGearId]?.teeth;
  if (zp === undefined) return [];
  const out: number[] = [];
  for (let n = PLANET_COUNT_RANGE.min; n <= PLANET_COUNT_RANGE.max; n++) {
    if (planetaryOk(planetary.sun.teeth, zp, planetary.ring?.teeth ?? null, n)) out.push(n);
  }
  return out;
}

// プロパティパネルの選択肢（S3-05）: 遊星歯車機構の中の歯車の、選べる歯数。機構の外の歯車は null。
// role は機構の中の役割、teeth は今の歯数と、setGearTeeth が受け付ける歯数（昇順。リングは直接変えられないので空）
export function planetaryTeethChoices(
  scene: Scene,
  gearId: GearId,
): { readonly role: 'sun' | 'planet' | 'ring'; readonly teeth: number[] } | null {
  const gear = scene.gears[gearId];
  if (gear === undefined) return null;
  const planetary = planetaryOfGear(scene, gearId);
  if (planetary === null) return null;
  if (planetary.ring?.id === gearId) return { role: 'ring', teeth: [] };
  const role = gearId === planetary.sun.id ? 'sun' : 'planet';
  const { min, max } = teethRange(gear.kind, gear.size);
  const teeth: number[] = [];
  for (let z = min; z <= max; z++) {
    if (z === gear.teeth || setPlanetaryTeeth(scene, planetary, gear, z).ok) teeth.push(z);
  }
  return { role, teeth };
}

// キャリアの遊星の数を変える（S3-03）
function setPlanetCount(
  scene: Scene,
  c: Extract<Command, { type: 'setPlanetCount' }>,
  ctx: CommandContext,
): CommandResult {
  if (scene.carriers[c.carrierId] === undefined) {
    return fail('notFound', `carrier ${c.carrierId} not found`);
  }
  if (!planetCountInRange(c.count)) {
    return fail(
      'invalidValue',
      `planet count ${c.count} out of range [${PLANET_COUNT_RANGE.min}, ${PLANET_COUNT_RANGE.max}]`,
    );
  }
  const planetary = planetaryOfCarrier(scene, c.carrierId);
  const template = planetary?.planetShafts[0];
  const tp = template?.placement;
  if (planetary === null || template === undefined || tp?.kind !== 'planet') {
    return fail('notAllowed', `carrier ${c.carrierId} has no planets`);
  }
  const { sun, ring } = planetary;
  const child = scene.gears[tp.childGearId];
  if (child === undefined) return fail('notAllowed', `carrier ${c.carrierId} has no planets`);
  if (!planetaryOk(sun.teeth, child.teeth, ring?.teeth ?? null, c.count)) {
    return fail('notAllowed', `${c.count} planets do not fit carrier ${c.carrierId}`);
  }
  const angles = Array.from({ length: c.count }, (_, k) =>
    normalizeAngle(tp.angle + (2 * Math.PI * k) / c.count),
  );
  const current = planetary.planetShafts.map((s) =>
    s.placement.kind === 'planet' ? s.placement.angle : 0,
  );
  if (current.length === angles.length && current.every((a, k) => a === angles[k])) {
    return done(scene);
  }
  // 遊星のシャフトをすべて消し、1 本目の歯車の並びを写した遊星のシャフトを等配に作る
  const shafts: Record<ShaftId, Shaft> = { ...scene.shafts };
  const gears: Record<GearId, Gear> = { ...scene.gears };
  for (const shaft of planetary.planetShafts) {
    delete shafts[shaft.id];
    for (const g of Object.values(scene.gears)) if (g.shaftId === shaft.id) delete gears[g.id];
  }
  const templateGears = Object.values(scene.gears).filter((g) => g.shaftId === template.id);
  const created: string[] = [];
  for (const angle of angles) {
    const shaftId = ctx.ids('shaft');
    let childId = '';
    const copies: Gear[] = [];
    for (const g of templateGears) {
      const id = ctx.ids('gear');
      if (g.id === tp.childGearId) childId = id;
      copies.push({ ...g, id, shaftId });
    }
    shafts[shaftId] = { id: shaftId, placement: { ...tp, childGearId: childId, angle } };
    created.push(shaftId);
    for (const g of copies) {
      gears[g.id] = g;
      created.push(g.id);
    }
  }
  // 消した遊星のシャフトの固定具・モーター（コマンドでは付けられないが、読み込んだシーンにあれば）も消す
  const motors: Record<MotorId, Motor> = { ...scene.motors };
  const anchors: Record<AnchorId, Anchor> = { ...scene.anchors };
  for (const m of Object.values(scene.motors))
    if (shafts[m.shaftId] === undefined) delete motors[m.id];
  for (const a of Object.values(scene.anchors)) {
    if (a.target.kind === 'shaft' && shafts[a.target.id] === undefined) delete anchors[a.id];
  }
  return done({ ...scene, shafts, gears, motors, anchors }, created);
}

function growCoaxial(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'coaxial' }>,
  ctx: CommandContext,
): CommandResult {
  if (scene.shafts[c.shaftId] === undefined) {
    return fail('notFound', `shaft ${c.shaftId} not found`);
  }
  if (!isSizeKey(c.size)) return fail('invalidValue', `invalid size ${String(c.size)}`);
  const kind = c.kind ?? 'spur';
  if (!isGearKind(kind)) return fail('invalidValue', `invalid gear kind ${String(kind)}`);
  const bad = kind === 'worm' ? null : teethError(c.size, c.teeth, kind);
  if (bad) return bad;
  if (!isSnapped(c.offset)) return snapError(c.offset);
  const teeth = kind === 'worm' ? WORM_THREADS : c.teeth;
  const gearId = ctx.ids('gear');
  const gear = makeGear(
    { id: gearId, shaftId: c.shaftId, size: c.size, teeth, offset: clean(c.offset) },
    newGearShape(kind),
  );
  // 重なる位置には置かない（S4-03）。シャフトが伸びる分も含めて、新しい干渉を生むか確かめる
  const next = fitShaftSpans(scene, { ...scene, gears: withEntry(scene.gears, gearId, gear) });
  if (newInterferences(resolveLayout(scene), resolveLayout(next)).length > 0) {
    return fail('notAllowed', `gear at offset ${gear.offset} overlaps other parts`);
  }
  return done(next, [gearId]);
}

// シャフトの端 end（0: 始まり、1: 終わり）を target（シャフトの原点からの位置）へ動かすときの範囲（S4-03。伸縮のつまみ）。
// target は AXIAL_SNAP の倍数に丸め、載っている部品の範囲より短くはせず（その手前の 4 の倍数で止める）、
// 伸ばす向きでは、ほかの部品にぶつかる手前の 4 の倍数で止める（線分は長いほど相手を含むので、ぶつかる長さは単調）。
// 返す範囲は setShaftSpan が受け付ける。シャフトが無い・置かれていなければ null
export function stretchShaftSpan(
  scene: Scene,
  shaftId: ShaftId,
  end: 0 | 1,
  target: number,
): readonly [number, number] | null {
  const current = resolveLayout(scene).shafts[shaftId]?.span;
  if (current === undefined || !Number.isFinite(target)) return null;
  const need = requiredShaftSpans(scene)[shaftId] ?? null;
  const sign = end === 0 ? -1 : 1; // 伸ばす向き
  const now = current[end];
  const other = current[end === 0 ? 1 : 0];
  // 縮められる限界（これより内側には行けない）: 部品の範囲の外側の 4 の倍数、反対の端から AXIAL_SNAP 以上
  const toGrid = (x: number, outward: number) =>
    (outward > 0 ? Math.ceil(x / AXIAL_SNAP) : Math.floor(x / AXIAL_SNAP)) * AXIAL_SNAP;
  let limit = toGrid(other + sign * AXIAL_SNAP, sign);
  if (need !== null)
    limit = sign > 0 ? Math.max(limit, toGrid(need[1], 1)) : Math.min(limit, toGrid(need[0], -1));
  const snapped = Math.round(target / AXIAL_SNAP) * AXIAL_SNAP + 0;
  const spanWith = (value: number): readonly [number, number] =>
    end === 0 ? [value, other] : [other, value];
  // 内側へ: 限界で止める（今が限界より内側なら動かさない）
  if ((snapped - limit) * sign < 0) {
    const value = (now - limit) * sign < 0 ? now : limit;
    return spanWith(value);
  }
  if ((snapped - now) * sign <= 0) return spanWith(snapped);
  // 外側へ: ぶつからない最も遠い 4 の倍数（今の端から外側へ 1 段ずつ。二分探索）
  const grid = toGrid(now, sign);
  const first = grid === now ? now + sign * AXIAL_SNAP : grid;
  const steps = Math.round((snapped - first) / (sign * AXIAL_SNAP));
  const at = (k: number) => first + sign * k * AXIAL_SNAP;
  const fits = (k: number) =>
    applyCommand(
      scene,
      { type: 'setShaftSpan', shaftId, span: spanWith(at(k)) },
      {
        ids: () => '__unused',
      },
    ).ok;
  if (fits(steps)) return spanWith(at(steps));
  let lo = -1; // ここまでは入る（-1 は今の端）
  let hi = steps; // ここはぶつかる
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return spanWith(lo < 0 ? now : at(lo));
}

// シャフトの範囲を変える（S4-03）。変えない端はそのまま（version 3 から移した範囲の端は 4 の倍数とは限らない）
function setShaftSpan(scene: Scene, c: Extract<Command, { type: 'setShaftSpan' }>): CommandResult {
  const shaft = scene.shafts[c.shaftId];
  if (shaft === undefined) return fail('notFound', `shaft ${c.shaftId} not found`);
  const span = c.span;
  if (!Array.isArray(span) || span.length !== 2 || !span.every((x) => Number.isFinite(x))) {
    return fail('invalidValue', 'span must be 2 finite numbers');
  }
  const [lo, hi] = span;
  if (lo >= hi) return fail('invalidValue', `span [${lo}, ${hi}] is empty`);
  const required = requiredShaftSpans(scene);
  const current = resolveLayout(scene).shafts[shaft.id]?.span;
  if (current === undefined) return fail('notAllowed', `shaft ${shaft.id} is not placed`);
  for (const [value, now] of [
    [lo, current[0]],
    [hi, current[1]],
  ] as const) {
    if (value !== now && !isSnapped(value)) {
      return fail('invalidValue', `span end ${value} is not a multiple of ${AXIAL_SNAP}`);
    }
  }
  if (!spanContains([lo, hi], required[shaft.id] ?? null)) {
    return fail('notAllowed', `span [${lo}, ${hi}] is shorter than the parts on ${shaft.id}`);
  }
  if (shaft.span !== undefined && shaft.span[0] === lo && shaft.span[1] === hi) return done(scene);
  const next: Scene = {
    ...scene,
    shafts: withEntry(scene.shafts, shaft.id, { ...shaft, span: [clean(lo), clean(hi)] }),
  };
  if (newInterferences(resolveLayout(scene), resolveLayout(next)).length > 0) {
    return fail('notAllowed', `shaft ${shaft.id} with span [${lo}, ${hi}] hits other parts`);
  }
  return done(next);
}

// 部品を消す。消す歯車を親に持つ mesh のシャフトと、消す歯車を子に持つ自分のシャフトは、
// 消す直前のワールド座標の原点と向き（入力のシーンの resolveLayout）で detached にする（その先はそのまま）。
// 歯車が 1 枚も残らなくなったシャフトは、そのモーターと一緒に消す。
// 同じコマンドの中で先に消えた部品の ID は無視する。シーンに無い ID が 1 つでもあれば notFound
function deleteParts(scene: Scene, ids: readonly string[]): CommandResult {
  for (const id of ids) {
    if (
      !Object.hasOwn(scene.gears, id) &&
      !Object.hasOwn(scene.shafts, id) &&
      !Object.hasOwn(scene.motors, id) &&
      !Object.hasOwn(scene.carriers, id) &&
      !Object.hasOwn(scene.racks, id)
    ) {
      return fail('notFound', `part ${id} not found`);
    }
  }

  const shafts: Record<ShaftId, Shaft> = { ...scene.shafts };
  const gears: Record<GearId, Gear> = { ...scene.gears };
  const motors: Record<MotorId, Motor> = { ...scene.motors };
  const anchors: Record<AnchorId, Anchor> = { ...scene.anchors };
  const carriers: Record<CarrierId, Carrier> = { ...scene.carriers };
  const racks: Record<RackId, Rack> = { ...scene.racks };
  let carriersChanged = false;
  let racksChanged = false;
  let shaftsChanged = false;
  let gearsChanged = false;
  let motorsChanged = false;
  let anchorsChanged = false;
  let layout: Layout | null = null;

  const detach = (shaft: Shaft): void => {
    if (isFreePlacement(shaft.placement)) return;
    layout ??= resolveLayout(scene);
    const at = layout.shafts[shaft.id];
    // 検証済みのシーンでは全てのシャフトが根からたどれる。たどれない場合だけの逃げ道
    const origin: Vec3 = at?.origin ?? [0, 0, 0];
    const axis: Axis = at?.axis ?? shaftAxis(scene, shaft.id) ?? 'y';
    // 範囲（S4-03）は原点からの値なので、その場に残すときもそのまま
    shafts[shaft.id] = { ...shaft, placement: { kind: 'detached', origin, axis } };
    shaftsChanged = true;
  };

  // ピニオン（pinion の相手）を消すと、ラックは消す直前の基準位置と向きで浮く（S3-04）
  const detachRack = (rack: Rack): void => {
    if (rack.placement.kind === 'detached') return;
    layout ??= resolveLayout(scene);
    const at = layout.racks[rack.id];
    if (at === undefined) return;
    racks[rack.id] = {
      ...rack,
      placement: {
        kind: 'detached',
        origin: at.origin,
        direction: at.direction,
        normal: at.normal,
        normalSign: at.normalSign,
      },
    };
    racksChanged = true;
  };

  // ラックを消すと、それに載ったピニオンのシャフト（'rack'）は消す直前の位置で浮き、ラックの固定具も消える（S3-04）
  const removeRack = (rackId: RackId): void => {
    if (racks[rackId] === undefined) return;
    for (const shaft of Object.values(shafts)) {
      const p = shaft.placement;
      if (p.kind === 'rack' && p.rackId === rackId) detach(shaft);
    }
    for (const anchor of Object.values(anchors)) {
      if (anchor.target.kind !== 'rack' || anchor.target.id !== rackId) continue;
      delete anchors[anchor.id];
      anchorsChanged = true;
    }
    delete racks[rackId];
    racksChanged = true;
  };

  const removeMotorsOn = (shaftId: ShaftId): void => {
    for (const motor of Object.values(motors)) {
      if (motor.shaftId !== shaftId) continue;
      delete motors[motor.id];
      motorsChanged = true;
    }
  };

  const removeGear = (gearId: GearId): void => {
    if (gears[gearId] === undefined) return;
    delete gears[gearId];
    gearsChanged = true;
    for (const shaft of Object.values(shafts)) {
      const p = shaft.placement;
      if (isChildPlacement(p) && (p.parentGearId === gearId || p.childGearId === gearId)) {
        detach(shaft);
      } else if (p.kind === 'rack' && p.childGearId === gearId) {
        detach(shaft);
      }
    }
    for (const rack of Object.values(racks)) {
      if (rack.placement.kind === 'pinion' && rack.placement.gearId === gearId) detachRack(rack);
    }
  };

  // キャリアを消すと、その遊星のシャフトは消す直前の基準配置の位置で detached になる（S3-03）。
  // キャリアのシャフトに歯車もほかのキャリアも残らなければ、シャフトも消す
  const removeCarrier = (carrierId: CarrierId, removeEmptyShaft: boolean): void => {
    const carrier = carriers[carrierId];
    if (carrier === undefined) return;
    delete carriers[carrierId];
    carriersChanged = true;
    for (const shaft of Object.values(shafts)) {
      const p = shaft.placement;
      if (p.kind === 'planet' && p.carrierId === carrierId) detach(shaft);
    }
    if (
      removeEmptyShaft &&
      !Object.values(gears).some((g) => g.shaftId === carrier.shaftId) &&
      !Object.values(carriers).some((x) => x.shaftId === carrier.shaftId)
    ) {
      removeShaft(carrier.shaftId);
    }
  };

  const removeShaft = (shaftId: ShaftId): void => {
    if (shafts[shaftId] === undefined) return;
    for (const gear of Object.values(gears)) {
      if (gear.shaftId === shaftId) removeGear(gear.id);
    }
    // 載っているキャリアも消し（S3-03）、同じ線上の子のシャフトはその場に detached で残す
    for (const carrier of Object.values(carriers)) {
      if (carrier.shaftId === shaftId) removeCarrier(carrier.id, false);
    }
    for (const shaft of Object.values(shafts)) {
      const p = shaft.placement;
      if (p.kind === 'concentric' && p.parentShaftId === shaftId) detach(shaft);
    }
    removeMotorsOn(shaftId);
    // シャフトの固定具も消す（S3-01。歯車を消してもシャフトが残る限り固定具は残る）
    for (const anchor of Object.values(anchors)) {
      if (anchor.target.kind !== 'shaft' || anchor.target.id !== shaftId) continue;
      delete anchors[anchor.id];
      anchorsChanged = true;
    }
    delete shafts[shaftId];
    shaftsChanged = true;
  };

  for (const id of ids) {
    const gear = gears[id];
    if (gear !== undefined) {
      removeGear(id);
      if (!Object.values(gears).some((g) => g.shaftId === gear.shaftId)) {
        removeShaft(gear.shaftId);
      }
    } else if (shafts[id] !== undefined) {
      removeShaft(id);
    } else if (motors[id] !== undefined) {
      delete motors[id];
      motorsChanged = true;
    } else if (carriers[id] !== undefined) {
      removeCarrier(id, true);
    } else if (racks[id] !== undefined) {
      removeRack(id);
    }
  }

  if (
    !shaftsChanged &&
    !gearsChanged &&
    !motorsChanged &&
    !anchorsChanged &&
    !carriersChanged &&
    !racksChanged
  ) {
    return done(scene);
  }
  return done({
    shafts: shaftsChanged ? shafts : scene.shafts,
    gears: gearsChanged ? gears : scene.gears,
    motors: motorsChanged ? motors : scene.motors,
    anchors: anchorsChanged ? anchors : scene.anchors,
    carriers: carriersChanged ? carriers : scene.carriers,
    racks: racksChanged ? racks : scene.racks,
  });
}

function setGearTeeth(scene: Scene, c: Extract<Command, { type: 'setGearTeeth' }>): CommandResult {
  const gear = scene.gears[c.gearId];
  if (gear === undefined) return fail('notFound', `gear ${c.gearId} not found`);
  if (gear.kind === 'worm') {
    return fail(
      'notAllowed',
      `worm ${gear.id} has ${WORM_THREADS} thread and its teeth cannot change`,
    );
  }
  const bad = teethError(gear.size, c.teeth, gear.kind);
  if (bad) return bad;
  if (gear.teeth === c.teeth) return done(scene);
  const planetary = planetaryOfGear(scene, gear.id);
  if (planetary !== null) return setPlanetaryTeeth(scene, planetary, gear, c.teeth);
  if (gear.kind !== 'bevel') {
    const next = { ...gear, teeth: c.teeth };
    // 木の親子（mesh の配置）が、内歯車の歯数差の条件を満たさなくなる変更は拒否する（S3-02）
    const broken = brokenMeshPartner(scene, next);
    if (broken !== null) {
      return fail('notAllowed', `gear ${gear.id} with ${c.teeth} teeth cannot mesh with ${broken}`);
    }
    return done({ ...scene, gears: withEntry(scene.gears, gear.id, next) });
  }
  // かさ歯車は歯数比 1:1 のみなので、木の親子（bevel の配置）でつながったかさ歯車すべてを同じ歯数にする（S2-02）
  const gears: Record<GearId, Gear> = { ...scene.gears };
  for (const id of bevelTreeOf(scene, gear.id)) {
    const g = scene.gears[id];
    if (g !== undefined && g.teeth !== c.teeth) gears[id] = { ...g, teeth: c.teeth };
  }
  return done({ ...scene, gears });
}

// 遊星歯車機構の中の歯数の変更（S3-03）。太陽か遊星を変えると、リングを z_r = z_s + 2·z_p にする。
// 同じキャリアの遊星はすべて同じ歯数にする。リングを直接変える変更、条件（範囲・配置の条件）を満たさない変更は notAllowed
function setPlanetaryTeeth(
  scene: Scene,
  planetary: Planetary,
  gear: Gear,
  teeth: number,
): CommandResult {
  const { sun, planets, ring } = planetary;
  if (ring !== null && gear.id === ring.id) {
    return fail('notAllowed', `ring ${gear.id} teeth follow the sun and the planets`);
  }
  const isSun = gear.id === sun.id;
  const zs = isSun ? teeth : sun.teeth;
  const zp = isSun ? (planets[0]?.teeth ?? teeth) : teeth;
  const zr = ring === null ? null : zs + 2 * zp;
  if (zr !== null && ring !== null && !teethInRange('internal', ring.size, zr)) {
    return fail('notAllowed', `ring would need ${zr} teeth`);
  }
  if (!planetaryOk(zs, zp, zr, planetary.planetShafts.length)) {
    return fail('notAllowed', `sun ${zs}, planets ${zp}, ring ${String(zr)} do not fit`);
  }
  const gears: Record<GearId, Gear> = { ...scene.gears };
  const set = (g: Gear, z: number) => {
    if (g.teeth !== z) gears[g.id] = { ...g, teeth: z };
  };
  set(sun, zs);
  for (const p of planets) set(p, zp);
  if (ring !== null && zr !== null) set(ring, zr);
  for (const g of Object.values(gears)) {
    if (g !== scene.gears[g.id] && brokenMeshPartner({ ...scene, gears }, g) !== null) {
      return fail('notAllowed', `gear ${g.id} with ${g.teeth} teeth cannot mesh with its partner`);
    }
  }
  return done({ ...scene, gears });
}

// gear（変更後）と mesh の配置の親子になっている歯車のうち、かみ合えなくなったもの（canMesh が偽）の ID。無ければ null
function brokenMeshPartner(scene: Scene, gear: Gear): GearId | null {
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (p.kind !== 'mesh') continue;
    const partnerId =
      p.parentGearId === gear.id
        ? p.childGearId
        : p.childGearId === gear.id
          ? p.parentGearId
          : null;
    if (partnerId === null) continue;
    const partner = scene.gears[partnerId];
    if (partner !== undefined && !canMesh(gear, partner)) return partnerId;
  }
  return null;
}

// 内歯車のウェブの向きを変える（S3-02）。区画（offset）はそのままで、ウェブとつなぎの筒が反対の面に移る
function setWebSide(scene: Scene, c: Extract<Command, { type: 'setWebSide' }>): CommandResult {
  const gear = scene.gears[c.gearId];
  if (gear === undefined) return fail('notFound', `gear ${c.gearId} not found`);
  if (gear.kind !== 'internal') {
    return fail('notAllowed', `gear ${gear.id} is not an internal gear`);
  }
  if (!isWebSide(c.webSide)) {
    return fail('invalidValue', `webSide must be 1 or -1: ${String(c.webSide)}`);
  }
  if (gear.webSide === c.webSide) return done(scene);
  return done({
    ...scene,
    gears: withEntry(scene.gears, gear.id, { ...gear, webSide: c.webSide }),
  });
}

// gearId と、bevel の配置の親子（どちらの向きにも）でつながった歯車の ID
function bevelTreeOf(scene: Scene, gearId: GearId): Set<GearId> {
  const neighbors = new Map<GearId, GearId[]>();
  const link = (a: GearId, b: GearId) => {
    const list = neighbors.get(a);
    if (list === undefined) neighbors.set(a, [b]);
    else list.push(b);
  };
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (p.kind !== 'bevel') continue;
    link(p.parentGearId, p.childGearId);
    link(p.childGearId, p.parentGearId);
  }
  const seen = new Set<GearId>([gearId]);
  const stack = [gearId];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const next of neighbors.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

// かさ歯車の apex を反転する（S2-02）。区画（offset）はそのままで、大端と頂点が区画の反対側に移り、
// この歯車を親に持つ bevel のシャフトは（親から導くので）ついてくる。bevel の配置の子は apex が −side で決まるので notAllowed
function flipBevelApex(
  scene: Scene,
  c: Extract<Command, { type: 'flipBevelApex' }>,
): CommandResult {
  const gear = scene.gears[c.gearId];
  if (gear === undefined) return fail('notFound', `gear ${c.gearId} not found`);
  if (gear.kind !== 'bevel') return fail('notAllowed', `gear ${gear.id} is not a bevel gear`);
  const p = scene.shafts[gear.shaftId]?.placement;
  if (p?.kind === 'bevel' && p.childGearId === gear.id) {
    return fail('notAllowed', `gear ${gear.id} faces its parent's apex and cannot flip`);
  }
  return done({
    ...scene,
    gears: withEntry(scene.gears, gear.id, { ...gear, apex: gear.apex === 1 ? -1 : 1 }),
  });
}

function setMeshAngle(scene: Scene, c: Extract<Command, { type: 'setMeshAngle' }>): CommandResult {
  const shaft = scene.shafts[c.shaftId];
  if (shaft === undefined) return fail('notFound', `shaft ${c.shaftId} not found`);
  const p = shaft.placement;
  if (p.kind !== 'mesh') return fail('notAllowed', `shaft ${c.shaftId} is not a mesh shaft`);
  if (!Number.isFinite(c.angle)) return fail('invalidValue', 'angle must be finite');
  const angle = normalizeAngle(c.angle);
  if (angle === p.angle) return done(scene);
  return done({
    ...scene,
    shafts: withEntry(scene.shafts, shaft.id, { ...shaft, placement: { ...p, angle } }),
  });
}

// mesh のシャフトの子の歯車は、親とかみ合う面から外れるので動かせない
function setGearOffset(
  scene: Scene,
  c: Extract<Command, { type: 'setGearOffset' }>,
): CommandResult {
  const gear = scene.gears[c.gearId];
  if (gear === undefined) return fail('notFound', `gear ${c.gearId} not found`);
  const p = scene.shafts[gear.shaftId]?.placement;
  if (p !== undefined && (isChildPlacement(p) || p.kind === 'rack') && p.childGearId === gear.id) {
    return fail('notAllowed', `gear ${gear.id} meshes with its parent and cannot move`);
  }
  if (!isSnapped(c.offset)) return snapError(c.offset);
  const offset = clean(c.offset);
  if (offset === gear.offset) return done(scene);
  return done({ ...scene, gears: withEntry(scene.gears, gear.id, { ...gear, offset }) });
}

function addMotor(
  scene: Scene,
  c: Extract<Command, { type: 'addMotor' }>,
  ctx: CommandContext,
): CommandResult {
  if (scene.shafts[c.shaftId] === undefined) {
    return fail('notFound', `shaft ${c.shaftId} not found`);
  }
  if (!isSizeKey(c.size)) return fail('invalidValue', `invalid size ${String(c.size)}`);
  // 遊星のシャフト（S3-03）は公転するので、モーターを付けられない
  if (scene.shafts[c.shaftId]?.placement.kind === 'planet') {
    return fail('notAllowed', `shaft ${c.shaftId} is a planet shaft`);
  }
  if (Object.values(scene.motors).some((m) => m.shaftId === c.shaftId)) {
    return fail('notAllowed', `shaft ${c.shaftId} already has a motor`);
  }
  const motorId = ctx.ids('motor');
  const motor: Motor = {
    id: motorId,
    shaftId: c.shaftId,
    size: c.size,
    rpm: MOTOR_SIZES[c.size].defaultRpm,
    direction: 1,
    on: true,
  };
  return done({ ...scene, motors: withEntry(scene.motors, motorId, motor) }, [motorId]);
}

function addAnchor(
  scene: Scene,
  c: Extract<Command, { type: 'addAnchor' }>,
  ctx: CommandContext,
): CommandResult {
  if ('rackId' in c) {
    // ラック（S3-04）。1 つの対象に固定具は最大 1 つ
    if (scene.racks[c.rackId] === undefined) return fail('notFound', `rack ${c.rackId} not found`);
    if (anchorOfRack(scene, c.rackId) !== null) return done(scene);
    const anchorId = ctx.ids('anchor');
    const anchor: Anchor = { id: anchorId, target: { kind: 'rack', id: c.rackId } };
    return done({ ...scene, anchors: withEntry(scene.anchors, anchorId, anchor) }, [anchorId]);
  }
  if (scene.shafts[c.shaftId] === undefined) {
    return fail('notFound', `shaft ${c.shaftId} not found`);
  }
  // 遊星のシャフト（S3-03）は公転するので、固定具を付けられない
  if (scene.shafts[c.shaftId]?.placement.kind === 'planet') {
    return fail('notAllowed', `shaft ${c.shaftId} is a planet shaft`);
  }
  // 1 つの対象に固定具は最大 1 つ。2 回目は何もしない（履歴にも積まない）
  if (anchorOfShaft(scene, c.shaftId) !== null) return done(scene);
  const anchorId = ctx.ids('anchor');
  const anchor: Anchor = { id: anchorId, target: { kind: 'shaft', id: c.shaftId } };
  return done({ ...scene, anchors: withEntry(scene.anchors, anchorId, anchor) }, [anchorId]);
}

function removeAnchor(scene: Scene, c: Extract<Command, { type: 'removeAnchor' }>): CommandResult {
  if (!Object.hasOwn(scene.anchors, c.anchorId)) {
    return fail('notFound', `anchor ${c.anchorId} not found`);
  }
  const anchors: Record<AnchorId, Anchor> = { ...scene.anchors };
  delete anchors[c.anchorId];
  return done({ ...scene, anchors });
}

// size を変えても rpm は変えない
function updateMotor(scene: Scene, c: Extract<Command, { type: 'updateMotor' }>): CommandResult {
  const motor = scene.motors[c.motorId];
  if (motor === undefined) return fail('notFound', `motor ${c.motorId} not found`);
  const { patch } = c;
  if (patch.size !== undefined && !isSizeKey(patch.size)) {
    return fail('invalidValue', `invalid size ${String(patch.size)}`);
  }
  if (
    patch.rpm !== undefined &&
    !(
      Number.isFinite(patch.rpm) &&
      patch.rpm >= MOTOR_RPM_RANGE.min &&
      patch.rpm <= MOTOR_RPM_RANGE.max
    )
  ) {
    return fail(
      'invalidValue',
      `rpm ${patch.rpm} out of range [${MOTOR_RPM_RANGE.min}, ${MOTOR_RPM_RANGE.max}]`,
    );
  }
  if (patch.direction !== undefined && patch.direction !== 1 && patch.direction !== -1) {
    return fail('invalidValue', `direction must be 1 or -1: ${String(patch.direction)}`);
  }
  if (patch.on !== undefined && typeof patch.on !== 'boolean') {
    return fail('invalidValue', 'on must be a boolean');
  }
  const next: Motor = {
    ...motor,
    size: patch.size ?? motor.size,
    rpm: patch.rpm ?? motor.rpm,
    direction: patch.direction ?? motor.direction,
    on: patch.on ?? motor.on,
  };
  if (
    next.size === motor.size &&
    next.rpm === motor.rpm &&
    next.direction === motor.direction &&
    next.on === motor.on
  ) {
    return done(scene);
  }
  return done({ ...scene, motors: withEntry(scene.motors, motor.id, next) });
}

// root・detached のシャフト（位置と向きを自分で持つもの）
function freeShaft(
  scene: Scene,
  shaftId: ShaftId,
): { ok: true; shaft: Shaft; placement: FreePlacement } | Failure {
  const shaft = scene.shafts[shaftId];
  if (shaft === undefined) return fail('notFound', `shaft ${shaftId} not found`);
  const p = shaft.placement;
  if (!isFreePlacement(p)) return fail('notAllowed', `shaft ${shaftId} is a ${p.kind} shaft`);
  return { ok: true, shaft, placement: p };
}

function moveShaft(scene: Scene, c: Extract<Command, { type: 'moveShaft' }>): CommandResult {
  const found = freeShaft(scene, c.shaftId);
  if (!found.ok) return found;
  if (!isFiniteVec3(c.origin)) return fail('invalidValue', 'origin must be 3 finite numbers');
  const { shaft, placement } = found;
  if (sameVec3(placement.origin, c.origin)) return done(scene);
  return done({
    ...scene,
    shafts: withEntry(scene.shafts, shaft.id, {
      ...shaft,
      placement: { ...placement, origin: copyVec3(c.origin) },
    }),
  });
}

// その先の mesh・bevel のシャフトは向きを持たないので書き換えない（resolveLayout で親から導かれる）
function setShaftAxis(scene: Scene, c: Extract<Command, { type: 'setShaftAxis' }>): CommandResult {
  const found = freeShaft(scene, c.shaftId);
  if (!found.ok) return found;
  if (!isAxis(c.axis)) return fail('invalidValue', `invalid axis ${String(c.axis)}`);
  const { shaft, placement } = found;
  if (placement.axis === c.axis) return done(scene);
  return done({
    ...scene,
    shafts: withEntry(scene.shafts, shaft.id, {
      ...shaft,
      placement: { ...placement, axis: c.axis },
    }),
  });
}

// 浮いたシャフトを別の歯車の外周に付け直す。子の offset が 0 になるように、
// このシャフトの全ての歯車の offset から子の offset を引く（並びは保つ）
function reattachShaft(
  scene: Scene,
  c: Extract<Command, { type: 'reattachShaft' }>,
): CommandResult {
  const shaft = scene.shafts[c.shaftId];
  if (shaft === undefined) return fail('notFound', `shaft ${c.shaftId} not found`);
  const child = scene.gears[c.childGearId];
  if (child === undefined) return fail('notFound', `gear ${c.childGearId} not found`);
  const parent = scene.gears[c.parentGearId];
  if (parent === undefined) return fail('notFound', `gear ${c.parentGearId} not found`);
  if (shaft.placement.kind !== 'detached') {
    return fail('notAllowed', `shaft ${shaft.id} is not detached`);
  }
  if (child.shaftId !== shaft.id) {
    return fail('notAllowed', `gear ${child.id} is not on shaft ${shaft.id}`);
  }
  if (child.size !== parent.size) {
    return fail('notAllowed', `sizes differ: ${child.size} and ${parent.size}`);
  }
  if (!canMesh(child, parent)) {
    return fail('notAllowed', `gear ${child.id} cannot mesh with ${parent.id}`);
  }
  // 付け直しは外周（mesh）だけ。かさ歯車の組は bevel の配置（S2-02）、ウォームとホイールは skew の配置（S2-03）
  // なので付け直せない
  if (meshGeometryOf(parent) !== 'parallel') {
    return fail('notAllowed', `${parent.kind} gear ${parent.id} cannot be a reattach parent`);
  }
  if (descendantShafts(scene, shaft.id).includes(parent.shaftId)) {
    return fail('notAllowed', `gear ${parent.id} is on shaft ${shaft.id} or beyond it (cycle)`);
  }
  if (!Number.isFinite(c.angle)) return fail('invalidValue', 'angle must be finite');

  const shift = child.offset;
  let gears = scene.gears;
  if (shift !== 0) {
    const next: Record<GearId, Gear> = { ...scene.gears };
    for (const gear of Object.values(scene.gears)) {
      if (gear.shaftId === shaft.id) {
        next[gear.id] = { ...gear, offset: clean(gear.offset - shift) };
      }
    }
    gears = next;
  }
  const placement: ShaftPlacement = {
    kind: 'mesh',
    parentGearId: parent.id,
    childGearId: child.id,
    angle: normalizeAngle(c.angle),
  };
  // シャフトの範囲（S4-03）も原点からの値なので、歯車と一緒にずらす
  const span: ShaftSpan | undefined =
    shaft.span === undefined
      ? undefined
      : [clean(shaft.span[0] - shift), clean(shaft.span[1] - shift)];
  return done({
    shafts: withEntry(scene.shafts, shaft.id, {
      ...shaft,
      placement,
      ...(span === undefined ? {} : { span }),
    }),
    gears,
    motors: scene.motors,
    anchors: scene.anchors,
    carriers: scene.carriers,
    racks: scene.racks,
  });
}

function replaceScene(scene: Scene, next: Scene): CommandResult {
  const result = validateScene(next);
  if (!result.ok) {
    const first = result.errors[0];
    return fail('invalidValue', `invalid scene: ${first?.message ?? 'unknown error'}`);
  }
  // 範囲を省いたシャフトには、載っている部品から求めた範囲を入れる（S4-03）
  return done(next === scene ? scene : withShaftSpans(next));
}
