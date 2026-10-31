// 性能の計測用のシーン（S1-31）。scripts/perf.ts と e2e の負荷の確認が使う

import { AXIAL_SNAP, MOTOR_SIZES } from '../core/constants';
import { gearWidth } from '../core/geometry/dimensions';
import type { Gear, Motor, Scene, Shaft, SizeKey } from '../core/scene/types';

/** 1 列の歯車の数 */
export const PERF_ROW_LENGTH = 10;
const ROW_SIZES: readonly SizeKey[] = ['S', 'M', 'L'];
const MIN_TEETH = 20;
const MAX_TEETH = 40;
const DEFAULT_SEED = 1;
// 列の中の折れ線の角度（+u の向きから ±30°）と、次の列への向き（+v）
const ZIGZAG = Math.PI / 6;
const NEXT_ROW_ANGLE = Math.PI / 2;
// 根のシャフトの原点（縦軸）
const ROOT_ORIGIN = [0, 10, 0] as const;

// 決まった seed から同じ並びを返す 32 ビットの擬似乱数（mulberry32）
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  return ((angle % twoPi) + twoPi) % twoPi;
}

const pad = (n: number): string => String(n).padStart(3, '0');

/**
 * 歯車 count 個の、干渉もロックもない、すべて回るシーンを作る。同じ seed なら同じシーン。
 *
 * 形: 縦軸の根のシャフト 1 本から始まる 1 本の木。歯車は 10 枚ずつの列に分け、列 r の大きさは S・M・L を順に使う。
 * 列 0 は根のシャフトの歯車から、+u（+Z）の向きに ±30° で互い違いの折れ線に外周へ生やす。
 * 列 r（r ≥ 1）は、列 r − 1 の先頭のシャフトに列 r の大きさの歯車 J を重ね（同じシャフトに 2 枚。列 r − 1 の
 * 上の面から AXIAL_SNAP だけ離す）、J の外周の +v（+X）に 1 枚、さらにその +v に列の先頭の歯車を生やし（先頭が
 * 前の列の先頭と同じ向きに回り、モーターどうしが逆らわないように）、そこから同じ折れ線を伸ばす。
 * 列ごとに高さの層が違い（層の間はシャフトの伸びの分だけ空ける）、違う層の部品は重ならないので、
 * 偶然のかみ合い（contact）と干渉は同じ層の中だけで考えればよい。歯数は 20〜40 で、折れ線の 1 つ飛ばしの歯車の
 * 中心距離は歯先円半径の和より十分大きい。各列の先頭のシャフトに列の大きさのモーター（初期値の rpm、向き +1、ON）。
 */
export function generatePerfScene(count: number, seed: number = DEFAULT_SEED): Scene {
  if (!Number.isInteger(count) || count < 1) throw new Error(`count must be >= 1: ${count}`);
  const random = createRandom(seed);
  const teeth = (): number => MIN_TEETH + Math.floor(random() * (MAX_TEETH - MIN_TEETH + 1));

  const shafts: Record<string, Shaft> = {};
  const gears: Record<string, Gear> = {};
  const motors: Record<string, Motor> = {};
  let gearCount = 0;
  let shaftCount = 0;
  let motorCount = 0;

  const addShaft = (placement: Shaft['placement']): string => {
    const id = `shaft_p${pad(shaftCount++)}`;
    shafts[id] = { id, placement };
    return id;
  };
  const addGear = (shaftId: string, size: SizeKey, offset: number): Gear => {
    const id = `gear_p${pad(gearCount++)}`;
    const gear: Gear = { id, kind: 'spur', shaftId, size, teeth: teeth(), offset };
    gears[id] = gear;
    return gear;
  };
  const growFrom = (parentGearId: string, angle: number, size: SizeKey): Gear => {
    // 子の歯車の ID を先に決めてから、シャフトの placement に入れる
    const childGearId = `gear_p${pad(gearCount)}`;
    const shaftId = addShaft({
      kind: 'mesh',
      parentGearId,
      childGearId,
      angle: normalizeAngle(angle),
    });
    return addGear(shaftId, size, 0);
  };
  const addMotor = (shaftId: string, size: SizeKey): void => {
    const id = `motor_p${pad(motorCount++)}`;
    motors[id] = { id, shaftId, size, rpm: MOTOR_SIZES[size].defaultRpm, direction: 1, on: true };
  };

  let prevHead: Gear | null = null;
  for (let row = 0; gearCount < count; row++) {
    const size = ROW_SIZES[row % ROW_SIZES.length] ?? 'S';
    let head: Gear;
    if (prevHead === null) {
      head = addGear(addShaft({ kind: 'root', origin: [...ROOT_ORIGIN], axis: 'y' }), size, 0);
    } else {
      // 前の列の先頭のシャフトに、前の列の上の面から AXIAL_SNAP 離して J を重ねる
      const offset = prevHead.offset + gearWidth(prevHead) + AXIAL_SNAP;
      const joint = addGear(prevHead.shaftId, size, offset);
      if (gearCount >= count) break;
      // 間に 1 枚挟んで、列の先頭が前の列の先頭と同じ向きに回るようにする（モーターどうしが逆らわない）
      const idler = growFrom(joint.id, NEXT_ROW_ANGLE, size);
      if (gearCount >= count) break;
      head = growFrom(idler.id, NEXT_ROW_ANGLE, size);
    }
    addMotor(head.shaftId, size);
    let prev = head;
    // 列の歯車の数（J と間の 1 枚を含めて PERF_ROW_LENGTH 枚）
    const rest = prevHead === null ? PERF_ROW_LENGTH - 1 : PERF_ROW_LENGTH - 3;
    for (let k = 1; k <= rest && gearCount < count; k++) {
      prev = growFrom(prev.id, k % 2 === 1 ? ZIGZAG : -ZIGZAG, size);
    }
    prevHead = head;
  }
  return { shafts, gears, motors, anchors: {}, carriers: {}, racks: {} };
}
