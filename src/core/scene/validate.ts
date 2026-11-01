import {
  AXIAL_SNAP,
  GEAR_SIZES,
  GEAR_WIDTH_RANGE,
  GEAR_WIDTH_STEP,
  MOTOR_RPM_RANGE,
  RACK_TEETH,
  WORM_THREADS,
} from '../constants';
import { canMesh, meshGeometryOf, placementKindOf } from '../geometry/can-mesh';
import { gearWidth, isWidthAdjustable, teethRange, widthInRange } from '../geometry/dimensions';
import { planetaryConditions } from '../geometry/planetary';
import { rackTeethInRange } from '../geometry/rack';
import { requiredShaftSpans, spanContains } from '../layout/resolve';
import { isApex, isGearKind, isHand, isWebSide } from './gear-shape';
import { isPartColor } from './part-color';
import { lineRootOf, placementParentShafts } from './scene';
import type { Scene, Shaft, ShaftId } from './types';

// シーンの検証（design.md §4・§9）。不正なら理由の一覧を返す（例外にしない）。
// 保存形式の読み込み（S1-28）もここを通すので、型の上ではありえない値（文字列の軸など）も調べる。

export interface SceneError {
  code: string; // 'idMismatch' | 'missingRef' | 'teethOutOfRange' | 'meshCycle' | ...
  id?: string; // 問題のある部品
  path?: string; // 問題の場所（例 'gears.gear_1.teeth'）
  message: string; // 開発者向け（UI には出さない）
}

export type SceneErrorCode =
  | 'invalidShape' // 生の値の形が型と違う（parseScene、S1-28）
  | 'idMismatch'
  | 'missingRef'
  | 'invalidKind'
  | 'invalidSize'
  | 'invalidAxis'
  | 'notFinite'
  | 'teethNotInteger'
  | 'teethOutOfRange'
  | 'offsetNotSnapped'
  | 'rpmOutOfRange'
  | 'invalidDirection'
  | 'invalidMotorOn'
  | 'multipleMotors'
  | 'meshChildNotOnShaft'
  | 'meshChildOffset'
  | 'meshParentOnSameShaft'
  | 'meshSizeMismatch'
  | 'meshKindMismatch' // 親と子の種類・形がかみ合わない（S2-01）
  | 'invalidHand' // ハスバ歯車の hand が 'left' でも 'right' でもない（S2-01）
  | 'invalidApex' // かさ歯車の apex が 1 でも -1 でもない（S2-02）
  | 'invalidWebSide' // 内歯車の webSide が 1 でも -1 でもない（S3-02）
  | 'invalidAxisStep' // bevel・skew の配置の axisStep が 1 でも 2 でもない（S2-02、S2-03）
  | 'invalidSide' // bevel・skew の配置の side が 1 でも -1 でもない（S2-02、S2-03）
  | 'bevelApexMismatch' // bevel の配置の子の apex が −side でない（S2-02）
  | 'meshCycle'
  | 'invalidAnchorTarget' // 固定具の対象の種類が 'shaft'・'rack' でない（S3-01、S3-04）
  | 'invalidNormalSign' // ラックの normalSign が 1 でも -1 でもない（S3-04）
  | 'rackAxesNotDistinct' // 浮いたラックの direction と normal が同じ軸（S3-04）
  | 'multipleAnchors' // 1 つの対象に固定具が 2 つ以上（S3-01）
  | 'planetLineMismatch' // 遊星の親の歯車のシャフトが、キャリアのシャフトと同じ線上にない（S3-03）
  | 'nestedOrbit' // キャリア・同じ線上のシャフトの親が遊星のシャフト（2 段以上の遊星は範囲外。S3-03）
  | 'planetShaftAttachment' // 遊星のシャフトにモーター・固定具がある（S3-05）
  | 'planetaryMismatch' // 遊星歯車機構の歯数が配置の条件（同心・等配・隣の遊星）を満たさない（S3-05）
  | 'invalidSpan' // シャフトの範囲が有限の 2 つの数 [始まり < 終わり] でない（S4-03）
  | 'spanTooShort' // シャフトの範囲が、載っている部品の範囲（余白込み）を含まない（S4-03）
  // 歯車・ラックの厚さ width が GEAR_WIDTH_RANGE の GEAR_WIDTH_STEP の倍数でない（S4-03・S4-05・S5-01）。
  // 厚さを変えられない種類（かさ歯車・ウォーム・ホイール）が大きさごとの歯幅と違う width を持つ（S4-05）
  | 'invalidWidth'
  | 'invalidColor' // 歯車・ラック・キャリア・固定具の color が PartColor のどれでもない（S5-04）
  // 平歯車の toothCount が 1〜teeth の整数でない、toothStart が 0〜teeth − 1 の整数でない（S5-05）
  | 'invalidToothArc';

const AXES: readonly unknown[] = ['x', 'y', 'z'];

function isSizeKey(size: unknown): size is keyof typeof GEAR_SIZES {
  return typeof size === 'string' && Object.hasOwn(GEAR_SIZES, size);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function validateScene(scene: Scene): { ok: true } | { ok: false; errors: SceneError[] } {
  const errors: SceneError[] = [];
  const push = (code: SceneErrorCode, id: string | undefined, path: string, message: string) => {
    const error: SceneError = { code, path, message };
    if (id !== undefined) error.id = id;
    errors.push(error);
  };

  // キーと id の一致
  for (const collection of ['shafts', 'gears', 'motors', 'anchors', 'carriers', 'racks'] as const) {
    for (const [key, item] of Object.entries(scene[collection])) {
      if (item.id !== key) {
        push(
          'idMismatch',
          key,
          `${collection}.${key}.id`,
          `${collection} key "${key}" does not match id "${String(item.id)}"`,
        );
      }
    }
  }

  // 色（S5-04）。省略できる。歯車・ラック・キャリア・固定具だけが持つ（シャフト・モーターの color は型に無いので見ない）
  for (const collection of ['gears', 'racks', 'carriers', 'anchors'] as const) {
    for (const [key, item] of Object.entries(scene[collection])) {
      const color: unknown = item.color;
      if (color !== undefined && !isPartColor(color)) {
        push('invalidColor', key, `${collection}.${key}.color`, `invalid color "${String(color)}"`);
      }
    }
  }

  // シャフト
  for (const [key, shaft] of Object.entries(scene.shafts)) {
    const p = shaft.placement;
    const base = `shafts.${key}.placement`;
    // 範囲（S4-03）。省いてもよい（載っている部品から求める）
    const span: unknown = shaft.span;
    if (span !== undefined) {
      const ends: readonly unknown[] = Array.isArray(span) ? span : [];
      if (
        ends.length !== 2 ||
        !ends.every(isFiniteNumber) ||
        (ends[0] as number) >= (ends[1] as number)
      ) {
        push(
          'invalidSpan',
          key,
          `shafts.${key}.span`,
          'span must be [start, end] with start < end',
        );
      }
    }
    if (p.kind === 'root' || p.kind === 'detached') {
      if (!AXES.includes(p.axis)) {
        push('invalidAxis', key, `${base}.axis`, `invalid axis "${String(p.axis)}"`);
      }
      const origin: readonly unknown[] = Array.isArray(p.origin) ? p.origin : [];
      if (origin.length !== 3 || !origin.every(isFiniteNumber)) {
        push('notFinite', key, `${base}.origin`, 'origin must be 3 finite numbers');
      }
    } else if (p.kind === 'concentric') {
      // 同じ線上のシャフト（S3-03）。親のシャフトがあり、遊星のシャフトでない
      const parentShaft = scene.shafts[p.parentShaftId];
      if (parentShaft === undefined) {
        push('missingRef', key, `${base}.parentShaftId`, `shaft "${p.parentShaftId}" not found`);
      } else if (parentShaft.placement.kind === 'planet') {
        push(
          'nestedOrbit',
          key,
          `${base}.parentShaftId`,
          `parent shaft "${p.parentShaftId}" is a planet shaft`,
        );
      }
    } else if (p.kind === 'rack') {
      // ラックに載せたピニオンのシャフト（S3-04）: ラックがあり、子は同じ大きさの平歯車で offset 0
      const rack = scene.racks[p.rackId];
      if (rack === undefined) {
        push('missingRef', key, `${base}.rackId`, `rack "${p.rackId}" not found`);
      }
      if (!isFiniteNumber(p.position)) {
        push('notFinite', key, `${base}.position`, 'position must be finite');
      }
      const child = scene.gears[p.childGearId];
      if (child === undefined) {
        push('missingRef', key, `${base}.childGearId`, `gear "${p.childGearId}" not found`);
      } else {
        if (child.shaftId !== key) {
          push(
            'meshChildNotOnShaft',
            p.childGearId,
            `${base}.childGearId`,
            `child gear "${p.childGearId}" is not on shaft "${key}"`,
          );
        }
        if (child.offset !== 0) {
          push(
            'meshChildOffset',
            p.childGearId,
            `gears.${p.childGearId}.offset`,
            `child gear "${p.childGearId}" must have offset 0`,
          );
        }
        if (rack !== undefined && child.size !== rack.size) {
          push(
            'meshSizeMismatch',
            p.childGearId,
            `gears.${p.childGearId}.size`,
            `child size "${child.size}" differs from rack size "${rack.size}"`,
          );
        } else if (child.kind !== 'spur') {
          push(
            'meshKindMismatch',
            p.childGearId,
            `gears.${p.childGearId}.kind`,
            `child gear "${p.childGearId}" (${child.kind}) cannot mesh with a rack`,
          );
        }
      }
    } else if (
      p.kind === 'mesh' ||
      p.kind === 'bevel' ||
      p.kind === 'skew' ||
      p.kind === 'planet'
    ) {
      if ((p.kind === 'mesh' || p.kind === 'planet') && !isFiniteNumber(p.angle)) {
        push('notFinite', key, `${base}.angle`, 'angle must be finite');
      }
      if (p.kind === 'bevel' || p.kind === 'skew') {
        // 軸は親の軸を 1 回か 2 回進めたもの（0 回＝親と同じ軸は、かさ歯車・ねじれた位置の組ではかみ合わない）
        if (p.axisStep !== 1 && p.axisStep !== 2) {
          push(
            'invalidAxisStep',
            key,
            `${base}.axisStep`,
            `axisStep must be 1 or 2: ${String(p.axisStep)}`,
          );
        }
        if (p.side !== 1 && p.side !== -1) {
          push('invalidSide', key, `${base}.side`, `side must be 1 or -1: ${String(p.side)}`);
        }
      }
      const child = scene.gears[p.childGearId];
      const parent = scene.gears[p.parentGearId];
      if (child === undefined) {
        push('missingRef', key, `${base}.childGearId`, `gear "${p.childGearId}" not found`);
      } else {
        if (child.shaftId !== key) {
          push(
            'meshChildNotOnShaft',
            p.childGearId,
            `${base}.childGearId`,
            `child gear "${p.childGearId}" is not on shaft "${key}"`,
          );
        }
        if (child.offset !== 0) {
          push(
            'meshChildOffset',
            p.childGearId,
            `gears.${p.childGearId}.offset`,
            `child gear "${p.childGearId}" must have offset 0`,
          );
        }
      }
      if (parent === undefined) {
        push('missingRef', key, `${base}.parentGearId`, `gear "${p.parentGearId}" not found`);
      } else if (parent.shaftId === key) {
        push(
          'meshParentOnSameShaft',
          key,
          `${base}.parentGearId`,
          `parent gear "${p.parentGearId}" is on the same shaft`,
        );
      }
      if (child !== undefined && parent !== undefined && child.size !== parent.size) {
        push(
          'meshSizeMismatch',
          p.childGearId,
          `gears.${p.childGearId}.size`,
          `child size "${child.size}" differs from parent size "${parent.size}"`,
        );
      } else if (
        child !== undefined &&
        parent !== undefined &&
        isGearKind(child.kind) &&
        isGearKind(parent.kind) &&
        (!canMesh(child, parent) ||
          placementKindOf(meshGeometryOf(parent)) !== (p.kind === 'planet' ? 'mesh' : p.kind))
      ) {
        // かみ合えない組か、配置の種類がかみ合いの位置関係に合わない
        // （平行は mesh、かさ歯車は bevel（S2-02）、ウォームとホイールは skew（S2-03））
        push(
          'meshKindMismatch',
          p.childGearId,
          `gears.${p.childGearId}.kind`,
          `child gear "${p.childGearId}" cannot mesh with parent "${p.parentGearId}" by ${p.kind}`,
        );
      } else if (
        p.kind === 'bevel' &&
        child?.kind === 'bevel' &&
        isApex(child.apex) &&
        (p.side === 1 || p.side === -1) &&
        child.apex !== -p.side
      ) {
        // 子は親の頂点を向く（S2-02）
        push(
          'bevelApexMismatch',
          p.childGearId,
          `gears.${p.childGearId}.apex`,
          `child bevel gear "${p.childGearId}" must have apex ${-p.side}`,
        );
      }
      if (p.kind !== 'planet' && parent !== undefined) {
        // 遊星のシャフトの歯車から外へ生やした子（2 段以上の遊星）は扱わない（S3-03）
        if (scene.shafts[parent.shaftId]?.placement.kind === 'planet') {
          push(
            'nestedOrbit',
            key,
            `${base}.parentGearId`,
            `parent gear "${p.parentGearId}" is on a planet shaft`,
          );
        }
      }
      if (p.kind === 'planet') {
        // 遊星のシャフト（S3-03）: キャリアがあり、親の歯車がキャリアのシャフトと同じ線上にある
        const carrier = scene.carriers[p.carrierId];
        if (carrier === undefined) {
          push('missingRef', key, `${base}.carrierId`, `carrier "${p.carrierId}" not found`);
        } else if (
          parent !== undefined &&
          scene.shafts[carrier.shaftId] !== undefined &&
          // 線が循環しているとき（線の根が null）は meshCycle で報告する
          lineRootOf(scene, carrier.shaftId) !== null &&
          lineRootOf(scene, parent.shaftId) !== lineRootOf(scene, carrier.shaftId)
        ) {
          push(
            'planetLineMismatch',
            key,
            `${base}.parentGearId`,
            `parent gear "${p.parentGearId}" is not on the line of carrier "${p.carrierId}"`,
          );
        }
      }
    } else {
      push(
        'invalidKind',
        key,
        `${base}.kind`,
        `invalid placement kind "${String((p as { kind: unknown }).kind)}"`,
      );
    }
  }

  // キャリア（S3-03）: シャフトがあり、遊星のシャフトでない。offset は AXIAL_SNAP の倍数
  for (const [key, carrier] of Object.entries(scene.carriers)) {
    const base = `carriers.${key}`;
    const shaft = scene.shafts[carrier.shaftId];
    if (shaft === undefined) {
      push('missingRef', key, `${base}.shaftId`, `shaft "${carrier.shaftId}" not found`);
    } else if (shaft.placement.kind === 'planet') {
      push('nestedOrbit', key, `${base}.shaftId`, `shaft "${carrier.shaftId}" is a planet shaft`);
    }
    if (!isSizeKey(carrier.size)) {
      push('invalidSize', key, `${base}.size`, `invalid size "${String(carrier.size)}"`);
    }
    if (!isFiniteNumber(carrier.offset)) {
      push('notFinite', key, `${base}.offset`, 'offset must be finite');
    } else if (carrier.offset % AXIAL_SNAP !== 0) {
      push(
        'offsetNotSnapped',
        key,
        `${base}.offset`,
        `offset ${carrier.offset} is not a multiple of ${AXIAL_SNAP}`,
      );
    }
  }

  // ラック（S3-04）: 大きさ、歯数（RACK_TEETH）、配置（pinion: ピニオンが同じ大きさの平歯車で遊星のシャフトでない、
  // axisStep が 1・2、normalSign が ±1。detached: 原点が有限、direction・normal が軸で互いに違う、normalSign が ±1）
  for (const [key, rack] of Object.entries(scene.racks)) {
    const base = `racks.${key}`;
    if (!isSizeKey(rack.size)) {
      push('invalidSize', key, `${base}.size`, `invalid size "${String(rack.size)}"`);
    }
    if (!Number.isInteger(rack.teeth)) {
      push('teethNotInteger', key, `${base}.teeth`, `teeth must be an integer: ${rack.teeth}`);
    } else if (!rackTeethInRange(rack.teeth)) {
      push(
        'teethOutOfRange',
        key,
        `${base}.teeth`,
        `rack teeth ${rack.teeth} out of range [${RACK_TEETH.min}, ${RACK_TEETH.max}]`,
      );
    }
    // 厚さ（S4-05。省略できる）
    const rackWidthValue: unknown = rack.width;
    if (
      rackWidthValue !== undefined &&
      !(isFiniteNumber(rackWidthValue) && widthInRange(rackWidthValue))
    ) {
      push('invalidWidth', key, `${base}.width`, widthMessage(rackWidthValue));
    }
    const p = rack.placement;
    const pbase = `${base}.placement`;
    if (p.normalSign !== 1 && p.normalSign !== -1) {
      push(
        'invalidNormalSign',
        key,
        `${pbase}.normalSign`,
        `normalSign must be 1 or -1: ${String(p.normalSign)}`,
      );
    }
    if (p.kind === 'pinion') {
      if (p.axisStep !== 1 && p.axisStep !== 2) {
        push(
          'invalidAxisStep',
          key,
          `${pbase}.axisStep`,
          `axisStep must be 1 or 2: ${String(p.axisStep)}`,
        );
      }
      const pinion = scene.gears[p.gearId];
      if (pinion === undefined) {
        push('missingRef', key, `${pbase}.gearId`, `gear "${p.gearId}" not found`);
      } else if (pinion.size !== rack.size) {
        push(
          'meshSizeMismatch',
          key,
          `${base}.size`,
          `rack size "${rack.size}" differs from pinion size "${pinion.size}"`,
        );
      } else if (pinion.kind !== 'spur') {
        push(
          'meshKindMismatch',
          key,
          `${pbase}.gearId`,
          `pinion "${p.gearId}" (${pinion.kind}) cannot mesh with a rack`,
        );
      } else if (scene.shafts[pinion.shaftId]?.placement.kind === 'planet') {
        push('nestedOrbit', key, `${pbase}.gearId`, `pinion "${p.gearId}" is on a planet shaft`);
      }
    } else if (p.kind === 'detached') {
      const origin: readonly unknown[] = Array.isArray(p.origin) ? p.origin : [];
      if (origin.length !== 3 || !origin.every(isFiniteNumber)) {
        push('notFinite', key, `${pbase}.origin`, 'origin must be 3 finite numbers');
      }
      if (!AXES.includes(p.direction)) {
        push('invalidAxis', key, `${pbase}.direction`, `invalid axis "${String(p.direction)}"`);
      } else if (!AXES.includes(p.normal)) {
        push('invalidAxis', key, `${pbase}.normal`, `invalid axis "${String(p.normal)}"`);
      } else if (p.direction === p.normal) {
        push(
          'rackAxesNotDistinct',
          key,
          `${pbase}.normal`,
          `direction and normal must differ: ${p.direction}`,
        );
      }
    } else {
      push(
        'invalidKind',
        key,
        `${pbase}.kind`,
        `invalid rack placement kind "${String((p as { kind: unknown }).kind)}"`,
      );
    }
  }

  // 歯車
  for (const [key, gear] of Object.entries(scene.gears)) {
    const base = `gears.${key}`;
    if (!isGearKind(gear.kind)) {
      push('invalidKind', key, `${base}.kind`, `invalid gear kind "${String(gear.kind)}"`);
    } else if (gear.kind === 'helical' && !isHand(gear.hand)) {
      push('invalidHand', key, `${base}.hand`, `invalid hand "${String(gear.hand)}"`);
    } else if (gear.kind === 'bevel' && !isApex(gear.apex)) {
      push('invalidApex', key, `${base}.apex`, `apex must be 1 or -1: ${String(gear.apex)}`);
    } else if (gear.kind === 'internal' && !isWebSide(gear.webSide)) {
      push(
        'invalidWebSide',
        key,
        `${base}.webSide`,
        `webSide must be 1 or -1: ${String(gear.webSide)}`,
      );
    }
    if (scene.shafts[gear.shaftId] === undefined) {
      push('missingRef', key, `${base}.shaftId`, `shaft "${gear.shaftId}" not found`);
    }
    if (!isSizeKey(gear.size)) {
      push('invalidSize', key, `${base}.size`, `invalid size "${String(gear.size)}"`);
    } else if (!Number.isInteger(gear.teeth)) {
      push('teethNotInteger', key, `${base}.teeth`, `teeth must be an integer: ${gear.teeth}`);
    } else if (gear.kind === 'worm') {
      // ウォームの teeth は条数で、常に WORM_THREADS（S2-03）
      if (gear.teeth !== WORM_THREADS) {
        push(
          'teethOutOfRange',
          key,
          `${base}.teeth`,
          `worm teeth (threads) must be ${WORM_THREADS}: ${gear.teeth}`,
        );
      }
    } else {
      // 種類ごとの範囲（内歯車は INTERNAL_MIN_TEETH から。S3-02）。種類が不正なら大きさの範囲
      const { min, max } = teethRange(isGearKind(gear.kind) ? gear.kind : 'spur', gear.size);
      if (gear.teeth < min || gear.teeth > max) {
        push(
          'teethOutOfRange',
          key,
          `${base}.teeth`,
          `teeth ${gear.teeth} out of range [${min}, ${max}] for ${gear.kind} size ${gear.size}`,
        );
      }
    }
    if (!isFiniteNumber(gear.offset)) {
      push('notFinite', key, `${base}.offset`, 'offset must be finite');
    } else if (gear.offset % AXIAL_SNAP !== 0) {
      push(
        'offsetNotSnapped',
        key,
        `${base}.offset`,
        `offset ${gear.offset} is not a multiple of ${AXIAL_SNAP}`,
      );
    }
    // 欠け歯車の欄（S5-05）。toothCount は 1〜teeth、toothStart は 0〜teeth − 1 の整数
    if (gear.kind === 'spur') {
      const count: unknown = gear.toothCount;
      const start: unknown = gear.toothStart;
      if (
        count !== undefined &&
        !(Number.isInteger(count) && (count as number) >= 1 && (count as number) <= gear.teeth)
      ) {
        push(
          'invalidToothArc',
          key,
          `${base}.toothCount`,
          `toothCount must be an integer in [1, ${gear.teeth}]: ${String(count)}`,
        );
      }
      if (
        start !== undefined &&
        !(Number.isInteger(start) && (start as number) >= 0 && (start as number) < gear.teeth)
      ) {
        push(
          'invalidToothArc',
          key,
          `${base}.toothStart`,
          `toothStart must be an integer in [0, ${gear.teeth - 1}]: ${String(start)}`,
        );
      }
    }
    // 厚さ（S4-03 で足した省略できる欄。範囲は S4-05 の GEAR_WIDTH_RANGE。変えられない種類は大きさごとの歯幅だけ）
    const width: unknown = gear.width;
    if (width !== undefined) {
      if (!(isFiniteNumber(width) && widthInRange(width))) {
        push('invalidWidth', key, `${base}.width`, widthMessage(width));
      } else if (
        isGearKind(gear.kind) &&
        !isWidthAdjustable(gear.kind) &&
        isSizeKey(gear.size) &&
        width !== GEAR_SIZES[gear.size].faceWidth
      ) {
        push(
          'invalidWidth',
          key,
          `${base}.width`,
          `${gear.kind} width is fixed to ${GEAR_SIZES[gear.size].faceWidth}: ${width}`,
        );
      }
    }
  }

  // モーター
  const motorsPerShaft = new Map<ShaftId, string[]>();
  for (const [key, motor] of Object.entries(scene.motors)) {
    const base = `motors.${key}`;
    if (scene.shafts[motor.shaftId] === undefined) {
      push('missingRef', key, `${base}.shaftId`, `shaft "${motor.shaftId}" not found`);
    }
    if (!isSizeKey(motor.size)) {
      push('invalidSize', key, `${base}.size`, `invalid size "${String(motor.size)}"`);
    }
    if (!isFiniteNumber(motor.rpm)) {
      push('notFinite', key, `${base}.rpm`, 'rpm must be finite');
    } else if (motor.rpm < MOTOR_RPM_RANGE.min || motor.rpm > MOTOR_RPM_RANGE.max) {
      push(
        'rpmOutOfRange',
        key,
        `${base}.rpm`,
        `rpm ${motor.rpm} out of range [${MOTOR_RPM_RANGE.min}, ${MOTOR_RPM_RANGE.max}]`,
      );
    }
    if (motor.direction !== 1 && motor.direction !== -1) {
      push(
        'invalidDirection',
        key,
        `${base}.direction`,
        `direction must be 1 or -1: ${String(motor.direction)}`,
      );
    }
    if (typeof motor.on !== 'boolean') {
      push('invalidMotorOn', key, `${base}.on`, 'on must be a boolean');
    }
    if (scene.shafts[motor.shaftId]?.placement.kind === 'planet') {
      // 遊星のシャフトは公転するので、モーターを付けない（S3-03 のコマンドが拒否する。読み込みは S3-05 から弾く）
      push(
        'planetShaftAttachment',
        key,
        `${base}.shaftId`,
        `motor "${key}" is on planet shaft "${motor.shaftId}"`,
      );
    }
    const list = motorsPerShaft.get(motor.shaftId) ?? [];
    list.push(key);
    motorsPerShaft.set(motor.shaftId, list);
  }
  for (const [shaftId, list] of motorsPerShaft) {
    if (list.length > 1) {
      push(
        'multipleMotors',
        shaftId,
        `shafts.${shaftId}`,
        `shaft "${shaftId}" has ${list.length} motors: ${list.join(', ')}`,
      );
    }
  }

  // 固定具（S3-01）: 対象はシャフトかラック（S3-04）で、シーンにあり、1 つの対象に最大 1 つ
  const anchorsPerTarget = new Map<string, { path: string; ids: string[] }>();
  for (const [key, anchor] of Object.entries(scene.anchors)) {
    const base = `anchors.${key}.target`;
    const target = anchor.target;
    if (target.kind !== 'shaft' && target.kind !== 'rack') {
      push(
        'invalidAnchorTarget',
        key,
        `${base}.kind`,
        `invalid anchor target "${String((target as { kind: unknown }).kind)}"`,
      );
      continue;
    }
    const exists =
      target.kind === 'shaft'
        ? scene.shafts[target.id] !== undefined
        : scene.racks[target.id] !== undefined;
    if (!exists) {
      push('missingRef', key, `${base}.id`, `${target.kind} "${target.id}" not found`);
      continue;
    }
    if (target.kind === 'shaft' && scene.shafts[target.id]?.placement.kind === 'planet') {
      // 遊星のシャフトは固定しない（S3-05。モーターと同じ）
      push(
        'planetShaftAttachment',
        key,
        `${base}.id`,
        `anchor "${key}" targets planet shaft "${target.id}"`,
      );
    }
    const path = `${target.kind === 'shaft' ? 'shafts' : 'racks'}.${target.id}`;
    const entry = anchorsPerTarget.get(path) ?? { path, ids: [] };
    entry.ids.push(key);
    anchorsPerTarget.set(path, entry);
  }
  for (const { path, ids } of anchorsPerTarget.values()) {
    if (ids.length > 1) {
      const targetId = path.slice(path.indexOf('.') + 1);
      push(
        'multipleAnchors',
        targetId,
        path,
        `"${targetId}" has ${ids.length} anchors: ${ids.join(', ')}`,
      );
    }
  }

  // 配置の親（mesh・bevel・skew・planet の親の歯車のシャフト、planet のキャリアのシャフト、concentric の親のシャフト）を
  // たどると root か detached に行き着く（循環しない。S3-03 で親が 2 つの planet を足したので、深さ優先で調べる）
  const state = new Map<ShaftId, 'visiting' | 'done'>();
  const cyclic = new Set<ShaftId>();
  const visit = (id: ShaftId): boolean => {
    const st = state.get(id);
    if (st === 'done') return cyclic.has(id);
    if (st === 'visiting') return true;
    state.set(id, 'visiting');
    let found = false;
    for (const parent of placementParentShafts(scene, id)) {
      if (visit(parent)) found = true;
    }
    state.set(id, 'done');
    if (found) cyclic.add(id);
    return found;
  };
  for (const key of Object.keys(scene.shafts)) {
    if (!visit(key)) continue;
    const p = scene.shafts[key]?.placement;
    const field =
      p?.kind === 'concentric' ? 'parentShaftId' : p?.kind === 'rack' ? 'rackId' : 'parentGearId';
    push(
      'meshCycle',
      key,
      `shafts.${key}.placement.${field}`,
      `placement parents of shaft "${key}" form a cycle`,
    );
  }

  // 遊星歯車機構の条件（S3-05）。ほかの誤りがあると部品をたどれないことがあるので、ここまでが通ったときだけ見る
  if (errors.length === 0) {
    for (const [key, carrier] of Object.entries(scene.carriers)) {
      const problem = planetaryProblem(scene, carrier.id, carrier.shaftId);
      if (problem !== null) push('planetaryMismatch', key, `carriers.${key}`, problem);
    }
  }

  // シャフトの範囲が載っている部品の範囲を含む（S4-03）。部品の範囲はレイアウトで求めるので、ここまでが通ったときだけ見る
  if (errors.length === 0) {
    const required = requiredShaftSpans(scene);
    for (const [key, shaft] of Object.entries(scene.shafts)) {
      if (shaft.span === undefined || spanContains(shaft.span, required[key] ?? null)) continue;
      const need = required[key];
      push(
        'spanTooShort',
        key,
        `shafts.${key}.span`,
        `span [${shaft.span.join(', ')}] does not contain the parts [${need?.join(', ')}]`,
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// キャリアの遊星歯車機構が配置の条件を満たさなければ、その理由（満たせば null）。
// 遊星はすべて同じ親（太陽かリング）・同じ歯数。太陽 z_s・リング z_r は、キャリアと同じ線上の、遊星と同じ大きさで
// 遊星と同じ面（親の歯車の offset から歯幅未満）にある外歯車・内歯車（遊星の親が内歯車なら、それがリング）。
// 太陽が無ければ z_s = z_r − 2·z_p とみなし、リングが無ければ同心・等配は問わない（planetaryConditions）
function planetaryProblem(scene: Scene, carrierId: string, carrierShaftId: ShaftId): string | null {
  const planets: Shaft[] = Object.values(scene.shafts).filter(
    (s) => s.placement.kind === 'planet' && s.placement.carrierId === carrierId,
  );
  const first = planets[0]?.placement;
  if (first?.kind !== 'planet') return null;
  const parent = scene.gears[first.parentGearId];
  const child = scene.gears[first.childGearId];
  if (parent === undefined || child === undefined) return null;
  for (const shaft of planets) {
    const p = shaft.placement;
    if (p.kind !== 'planet') continue;
    if (p.parentGearId !== parent.id) return `planets of "${carrierId}" have different parents`;
    if (scene.gears[p.childGearId]?.teeth !== child.teeth) {
      return `planets of "${carrierId}" have different teeth`;
    }
  }
  const line = lineRootOf(scene, carrierShaftId);
  // 親と厚さの方向に重なる歯車（S4-05 から厚さは歯車ごと。区間 [offset, offset + 厚さ] が重なる）
  const parentWidth = gearWidth(parent);
  const onPlane = Object.values(scene.gears).filter(
    (g) =>
      g.id !== parent.id &&
      g.size === child.size &&
      lineRootOf(scene, g.shaftId) === line &&
      g.offset < parent.offset + parentWidth &&
      parent.offset < g.offset + gearWidth(g),
  );
  const zp = child.teeth;
  let zs: number;
  let zr: number | null;
  if (parent.kind === 'internal') {
    zr = parent.teeth;
    zs = onPlane.find((g) => g.kind !== 'internal')?.teeth ?? zr - 2 * zp;
  } else {
    zs = parent.teeth;
    zr = onPlane.find((g) => g.kind === 'internal')?.teeth ?? null;
  }
  const n = planets.length;
  const c = planetaryConditions(zs, zp, zr, n);
  if (c.concentric && c.equalSpacing && c.clearance) return null;
  const failed = [
    c.concentric ? null : 'concentric',
    c.equalSpacing ? null : 'equal spacing',
    c.clearance ? null : 'clearance',
  ].filter((x) => x !== null);
  return `planetary of "${carrierId}" (sun ${zs}, planet ${zp}, ring ${String(zr)}, ${n} planets) fails ${failed.join(', ')}`;
}

function widthMessage(width: unknown): string {
  return `width must be a multiple of ${GEAR_WIDTH_STEP} in [${GEAR_WIDTH_RANGE.min}, ${GEAR_WIDTH_RANGE.max}]: ${String(width)}`;
}
