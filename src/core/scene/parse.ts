import type { Vec3 } from '../math/vec3';
import type { Axis, Gear, Motor, Scene, Shaft, ShaftPlacement, SizeKey } from './types';
import { type SceneError, validateScene } from './validate';

// 生の値（JSON から読んだ unknown）の形を確かめて Scene を作り、続けて validateScene で意味を確かめる
// （design.md §9。保存形式の読み込みの検証はここに集める）。例外を投げない。
// 返すシーンには型にあるフィールドだけを入れる（知らないフィールドは捨てる）

export type SceneParseResult =
  | { readonly ok: true; readonly scene: Scene }
  | { readonly ok: false; readonly errors: SceneError[] };

type Raw = Record<string, unknown>;

function isPlainObject(x: unknown): x is Raw {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const AXES: readonly unknown[] = ['x', 'y', 'z'];
const SIZES: readonly unknown[] = ['S', 'M', 'L'];

const PREFIX = { shafts: 'shaft_', gears: 'gear_', motors: 'motor_' } as const;
type Collection = keyof typeof PREFIX;

export function parseScene(raw: unknown): SceneParseResult {
  const errors: SceneError[] = [];
  const shape = (path: string, message: string, id?: string): void => {
    const error: SceneError = { code: 'invalidShape', path, message };
    if (id !== undefined) error.id = id;
    errors.push(error);
  };

  if (!isPlainObject(raw)) {
    shape('', 'scene must be an object');
    return { ok: false, errors };
  }
  for (const collection of ['shafts', 'gears', 'motors'] as const) {
    if (!isPlainObject(raw[collection])) shape(collection, `${collection} must be an object`);
  }
  if (errors.length > 0) return { ok: false, errors };

  // 部品の共通の形: 通常のオブジェクトで、キーと id が種類の接頭辞を持つ文字列
  const items = (collection: Collection): Array<[string, Raw, string]> => {
    const out: Array<[string, Raw, string]> = [];
    for (const [key, item] of Object.entries(raw[collection] as Raw)) {
      const base = `${collection}.${key}`;
      if (!key.startsWith(PREFIX[collection])) {
        shape(base, `key "${key}" must start with "${PREFIX[collection]}"`, key);
        continue;
      }
      if (!isPlainObject(item)) {
        shape(base, `${collection} item must be an object`, key);
        continue;
      }
      if (typeof item.id !== 'string' || !item.id.startsWith(PREFIX[collection])) {
        shape(`${base}.id`, `id must be a string starting with "${PREFIX[collection]}"`, key);
        continue;
      }
      out.push([key, item, item.id]);
    }
    return out;
  };

  const str = (item: Raw, field: string, base: string, key: string): string => {
    const v = item[field];
    if (typeof v === 'string') return v;
    shape(`${base}.${field}`, `${field} must be a string`, key);
    return '';
  };
  const num = (item: Raw, field: string, base: string, key: string): number => {
    const v = item[field];
    if (typeof v === 'number') return v;
    shape(`${base}.${field}`, `${field} must be a number`, key);
    return 0;
  };
  const size = (item: Raw, base: string, key: string): SizeKey => {
    if (SIZES.includes(item.size)) return item.size as SizeKey;
    shape(`${base}.size`, `size must be S, M or L: ${String(item.size)}`, key);
    return 'S';
  };

  const shafts: Array<[string, Shaft]> = [];
  for (const [key, item, id] of items('shafts')) {
    const base = `shafts.${key}.placement`;
    const p = item.placement;
    if (!isPlainObject(p)) {
      shape(base, 'placement must be an object', key);
      continue;
    }
    let placement: ShaftPlacement;
    if (p.kind === 'root' || p.kind === 'detached') {
      const origin: unknown = p.origin;
      let vec: Vec3 = [0, 0, 0];
      if (Array.isArray(origin) && origin.length === 3) {
        const [x, y, z] = origin as unknown[];
        if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
          vec = [x, y, z];
        } else {
          shape(`${base}.origin`, 'origin must be 3 numbers', key);
        }
      } else {
        shape(`${base}.origin`, 'origin must be 3 numbers', key);
      }
      let axis: Axis = 'x';
      if (AXES.includes(p.axis)) axis = p.axis as Axis;
      else shape(`${base}.axis`, `axis must be x, y or z: ${String(p.axis)}`, key);
      placement = { kind: p.kind, origin: vec, axis };
    } else if (p.kind === 'mesh') {
      // mesh は軸を持たない（親から導く。design.md §4）ので、axis があっても捨てる
      placement = {
        kind: 'mesh',
        parentGearId: str(p, 'parentGearId', base, key),
        childGearId: str(p, 'childGearId', base, key),
        angle: num(p, 'angle', base, key),
      };
    } else {
      shape(`${base}.kind`, `invalid placement kind "${String(p.kind)}"`, key);
      continue;
    }
    shafts.push([key, { id, placement }]);
  }

  const gears: Array<[string, Gear]> = [];
  for (const [key, item, id] of items('gears')) {
    const base = `gears.${key}`;
    if (item.kind !== 'spur') {
      shape(`${base}.kind`, `invalid gear kind "${String(item.kind)}"`, key);
    }
    gears.push([
      key,
      {
        id,
        kind: 'spur',
        shaftId: str(item, 'shaftId', base, key),
        size: size(item, base, key),
        teeth: num(item, 'teeth', base, key),
        offset: num(item, 'offset', base, key),
      },
    ]);
  }

  const motors: Array<[string, Motor]> = [];
  for (const [key, item, id] of items('motors')) {
    const base = `motors.${key}`;
    const shaftId = str(item, 'shaftId', base, key);
    const motorSize = size(item, base, key);
    const rpm = num(item, 'rpm', base, key);
    const direction = num(item, 'direction', base, key);
    let on = false;
    if (typeof item.on === 'boolean') on = item.on;
    else shape(`${base}.on`, 'on must be a boolean', key);
    // direction が 1 か -1 かは validateScene が確かめる
    motors.push([key, { id, shaftId, size: motorSize, rpm, direction: direction as 1 | -1, on }]);
  }

  if (errors.length > 0) return { ok: false, errors };

  // Object.fromEntries は自分のプロパティとして定義するので、"__proto__" のようなキーでも安全
  const scene: Scene = {
    shafts: Object.fromEntries(shafts),
    gears: Object.fromEntries(gears),
    motors: Object.fromEntries(motors),
  };
  const validated = validateScene(scene);
  return validated.ok ? { ok: true, scene } : { ok: false, errors: validated.errors };
}
