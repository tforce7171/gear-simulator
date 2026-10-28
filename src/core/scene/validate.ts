import { AXIAL_SNAP, GEAR_SIZES, MOTOR_RPM_RANGE, WORM_THREADS } from '../constants';
import { canMesh, meshGeometryOf, placementKindOf } from '../geometry/can-mesh';
import { isApex, isGearKind, isHand } from './gear-shape';
import { isChildPlacement, type Scene, type ShaftId, type ShaftPlacement } from './types';

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
  | 'invalidAxisStep' // bevel・skew の配置の axisStep が 1 でも 2 でもない（S2-02、S2-03）
  | 'invalidSide' // bevel・skew の配置の side が 1 でも -1 でもない（S2-02、S2-03）
  | 'bevelApexMismatch' // bevel の配置の子の apex が −side でない（S2-02）
  | 'meshCycle'
  | 'invalidAnchorTarget' // 固定具の対象の種類が 'shaft' でない（S3-01。S3-04 でラックを足す）
  | 'multipleAnchors'; // 1 つの対象に固定具が 2 つ以上（S3-01）

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
  for (const collection of ['shafts', 'gears', 'motors', 'anchors'] as const) {
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

  // シャフト
  for (const [key, shaft] of Object.entries(scene.shafts)) {
    const p = shaft.placement;
    const base = `shafts.${key}.placement`;
    if (p.kind === 'root' || p.kind === 'detached') {
      if (!AXES.includes(p.axis)) {
        push('invalidAxis', key, `${base}.axis`, `invalid axis "${String(p.axis)}"`);
      }
      const origin: readonly unknown[] = Array.isArray(p.origin) ? p.origin : [];
      if (origin.length !== 3 || !origin.every(isFiniteNumber)) {
        push('notFinite', key, `${base}.origin`, 'origin must be 3 finite numbers');
      }
    } else if (p.kind === 'mesh' || p.kind === 'bevel' || p.kind === 'skew') {
      if (p.kind === 'mesh' && !isFiniteNumber(p.angle)) {
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
        (!canMesh(child, parent) || placementKindOf(meshGeometryOf(parent)) !== p.kind)
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
    } else {
      push(
        'invalidKind',
        key,
        `${base}.kind`,
        `invalid placement kind "${String((p as { kind: unknown }).kind)}"`,
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
      const { minTeeth, maxTeeth } = GEAR_SIZES[gear.size];
      if (gear.teeth < minTeeth || gear.teeth > maxTeeth) {
        push(
          'teethOutOfRange',
          key,
          `${base}.teeth`,
          `teeth ${gear.teeth} out of range [${minTeeth}, ${maxTeeth}] for size ${gear.size}`,
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

  // 固定具（S3-01）: 対象はシャフトで、シーンにあり、1 つの対象に最大 1 つ
  const anchorsPerShaft = new Map<ShaftId, string[]>();
  for (const [key, anchor] of Object.entries(scene.anchors)) {
    const base = `anchors.${key}.target`;
    const target = anchor.target;
    if (target.kind !== 'shaft') {
      push(
        'invalidAnchorTarget',
        key,
        `${base}.kind`,
        `invalid anchor target "${String(target.kind)}"`,
      );
      continue;
    }
    if (scene.shafts[target.id] === undefined) {
      push('missingRef', key, `${base}.id`, `shaft "${target.id}" not found`);
      continue;
    }
    const list = anchorsPerShaft.get(target.id) ?? [];
    list.push(key);
    anchorsPerShaft.set(target.id, list);
  }
  for (const [shaftId, list] of anchorsPerShaft) {
    if (list.length > 1) {
      push(
        'multipleAnchors',
        shaftId,
        `shafts.${shaftId}`,
        `shaft "${shaftId}" has ${list.length} anchors: ${list.join(', ')}`,
      );
    }
  }

  // mesh・bevel・skew の親子をたどると root か detached に行き着く（循環しない）
  for (const key of Object.keys(scene.shafts)) {
    const start = scene.shafts[key]?.placement;
    if (start === undefined || !isChildPlacement(start)) continue;
    const visited = new Set<ShaftId>();
    let current: ShaftId | undefined = key;
    while (current !== undefined) {
      if (visited.has(current)) {
        push(
          'meshCycle',
          key,
          `shafts.${key}.placement.parentGearId`,
          `mesh parents of shaft "${key}" form a cycle`,
        );
        break;
      }
      visited.add(current);
      const placement: ShaftPlacement | undefined = scene.shafts[current]?.placement;
      if (placement === undefined || !isChildPlacement(placement)) break; // 根に着いた（参照切れは上で報告済み）
      current = scene.gears[placement.parentGearId]?.shaftId;
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
