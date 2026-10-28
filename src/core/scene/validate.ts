import { AXIAL_SNAP, GEAR_SIZES, MOTOR_RPM_RANGE } from '../constants';
import { canMesh } from '../geometry/can-mesh';
import { isGearKind, isHand } from './gear-shape';
import type { Scene, ShaftId, ShaftPlacement } from './types';

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
  | 'meshCycle';

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
  for (const collection of ['shafts', 'gears', 'motors'] as const) {
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
    } else if (p.kind === 'mesh') {
      if (!isFiniteNumber(p.angle)) {
        push('notFinite', key, `${base}.angle`, 'angle must be finite');
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
        !canMesh(child, parent)
      ) {
        push(
          'meshKindMismatch',
          p.childGearId,
          `gears.${p.childGearId}.kind`,
          `child gear "${p.childGearId}" cannot mesh with parent "${p.parentGearId}"`,
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
    }
    if (scene.shafts[gear.shaftId] === undefined) {
      push('missingRef', key, `${base}.shaftId`, `shaft "${gear.shaftId}" not found`);
    }
    if (!isSizeKey(gear.size)) {
      push('invalidSize', key, `${base}.size`, `invalid size "${String(gear.size)}"`);
    } else if (!Number.isInteger(gear.teeth)) {
      push('teethNotInteger', key, `${base}.teeth`, `teeth must be an integer: ${gear.teeth}`);
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

  // mesh の親子をたどると root か detached に行き着く（循環しない）
  for (const key of Object.keys(scene.shafts)) {
    if (scene.shafts[key]?.placement.kind !== 'mesh') continue;
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
      if (placement === undefined || placement.kind !== 'mesh') break; // 根に着いた（参照切れは上で報告済み）
      current = scene.gears[placement.parentGearId]?.shaftId;
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
