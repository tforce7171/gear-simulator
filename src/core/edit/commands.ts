import { AXIAL_SNAP, GEAR_SIZES, MOTOR_RPM_RANGE, MOTOR_SIZES, WORM_THREADS } from '../constants';
import { canMesh, meshGeometryOf } from '../geometry/can-mesh';
import { teethRange } from '../geometry/dimensions';
import { descendantShafts, resolveLayout } from '../layout/resolve';
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
import { anchorOfShaft } from '../scene/scene';
import { shaftAxis } from '../scene/shaft-axis';
import {
  type Anchor,
  type AnchorId,
  type Axis,
  type FreePlacement,
  type Gear,
  type GearId,
  type GearKind,
  type GearShape,
  isChildPlacement,
  type Motor,
  type MotorId,
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
  // kind は省くと 'spur'。ハスバ歯車は hand 'right'（S2-01）。ウォームは teeth によらず 1 条（S2-03）
  | {
      type: 'growGear';
      mode: 'coaxial';
      shaftId: ShaftId;
      offset: number;
      size: SizeKey;
      teeth: number;
      kind?: GearKind;
    }
  | { type: 'deleteParts'; ids: string[] }
  // かさ歯車では、木の親子（bevel の配置）でつながったかさ歯車すべての歯数を同じ値にする（S2-02）。
  // ウォームの歯数（条数）は変えられない（notAllowed。S2-03）
  | { type: 'setGearTeeth'; gearId: GearId; teeth: number }
  // かさ歯車の apex を反転する（S2-02）。bevel の配置の子（apex は −side で決まる）は notAllowed
  | { type: 'flipBevelApex'; gearId: GearId }
  // 内歯車のウェブの向きを変える（S3-02。区画（offset）はそのまま。UI は S3-05）
  | { type: 'setWebSide'; gearId: GearId; webSide: 1 | -1 }
  | { type: 'setMeshAngle'; shaftId: ShaftId; angle: number }
  | { type: 'setGearOffset'; gearId: GearId; offset: number }
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

export function applyCommand(scene: Scene, command: Command, ctx: CommandContext): CommandResult {
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
        default:
          return growCoaxial(scene, command, ctx);
      }
    case 'deleteParts':
      return deleteParts(scene, command.ids);
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
    },
    [shaftId, gearId],
  );
}

// 親と同じ大きさの歯車（offset 0）と、それを子に持つ mesh のシャフトを作る
function growPerimeter(
  scene: Scene,
  c: Extract<Command, { type: 'growGear'; mode: 'perimeter' }>,
  ctx: CommandContext,
): CommandResult {
  const parent = scene.gears[c.parentGearId];
  if (parent === undefined) return fail('notFound', `gear ${c.parentGearId} not found`);
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
    },
    [shaftId, gearId],
  );
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
  return done({ ...scene, gears: withEntry(scene.gears, gearId, gear) }, [gearId]);
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
      !Object.hasOwn(scene.motors, id)
    ) {
      return fail('notFound', `part ${id} not found`);
    }
  }

  const shafts: Record<ShaftId, Shaft> = { ...scene.shafts };
  const gears: Record<GearId, Gear> = { ...scene.gears };
  const motors: Record<MotorId, Motor> = { ...scene.motors };
  const anchors: Record<AnchorId, Anchor> = { ...scene.anchors };
  let shaftsChanged = false;
  let gearsChanged = false;
  let motorsChanged = false;
  let anchorsChanged = false;
  let layout: Layout | null = null;

  const detach = (shaft: Shaft): void => {
    if (!isChildPlacement(shaft.placement)) return;
    layout ??= resolveLayout(scene);
    const at = layout.shafts[shaft.id];
    // 検証済みのシーンでは全てのシャフトが根からたどれる。たどれない場合だけの逃げ道
    const origin: Vec3 = at?.origin ?? [0, 0, 0];
    const axis: Axis = at?.axis ?? shaftAxis(scene, shaft.id) ?? 'y';
    shafts[shaft.id] = { id: shaft.id, placement: { kind: 'detached', origin, axis } };
    shaftsChanged = true;
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
      }
    }
  };

  const removeShaft = (shaftId: ShaftId): void => {
    if (shafts[shaftId] === undefined) return;
    for (const gear of Object.values(gears)) {
      if (gear.shaftId === shaftId) removeGear(gear.id);
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
    }
  }

  if (!shaftsChanged && !gearsChanged && !motorsChanged && !anchorsChanged) return done(scene);
  return done({
    shafts: shaftsChanged ? shafts : scene.shafts,
    gears: gearsChanged ? gears : scene.gears,
    motors: motorsChanged ? motors : scene.motors,
    anchors: anchorsChanged ? anchors : scene.anchors,
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
  if (p !== undefined && isChildPlacement(p) && p.childGearId === gear.id) {
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
  if (scene.shafts[c.shaftId] === undefined) {
    return fail('notFound', `shaft ${c.shaftId} not found`);
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
  if (isChildPlacement(p)) return fail('notAllowed', `shaft ${shaftId} is a ${p.kind} shaft`);
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
  return done({
    shafts: withEntry(scene.shafts, shaft.id, { ...shaft, placement }),
    gears,
    motors: scene.motors,
    anchors: scene.anchors,
  });
}

function replaceScene(scene: Scene, next: Scene): CommandResult {
  const result = validateScene(next);
  if (!result.ok) {
    const first = result.errors[0];
    return fail('invalidValue', `invalid scene: ${first?.message ?? 'unknown error'}`);
  }
  return done(next === scene ? scene : next);
}
