import type { Gear, GearBase, GearKind, GearShape, Hand } from './types';

// 歯車の種類ごとの属性（GearShape）の扱い（S2-01）

// 型の上で到達しない分岐。switch (gear.kind) の default で呼び、種類の足し忘れをコンパイルエラーにする
export function assertNever(value: never): never {
  throw new Error(`unexpected value: ${JSON.stringify(value)}`);
}

// 歯車から種類と形を変える属性だけを取り出す
export function gearShape(gear: Gear): GearShape {
  switch (gear.kind) {
    case 'spur':
      return { kind: 'spur' };
    case 'helical':
      return { kind: 'helical', hand: gear.hand };
    default:
      return assertNever(gear);
  }
}

// 起点や同じ軸に新しく置く歯車の形。ハスバ歯車は 'right'
export function newGearShape(kind: GearKind): GearShape {
  switch (kind) {
    case 'spur':
      return { kind: 'spur' };
    case 'helical':
      return { kind: 'helical', hand: 'right' };
    default:
      return assertNever(kind);
  }
}

export function oppositeHand(hand: Hand): Hand {
  return hand === 'right' ? 'left' : 'right';
}

// 外周に生やす子の形。親とかみ合う形（平歯車は平歯車、ハスバ歯車は逆のねじれの向き）
export function meshPartnerShape(shape: GearShape): GearShape {
  switch (shape.kind) {
    case 'spur':
      return { kind: 'spur' };
    case 'helical':
      return { kind: 'helical', hand: oppositeHand(shape.hand) };
    default:
      return assertNever(shape);
  }
}

// 種類によらないフィールドと形から歯車を作る
export function makeGear(base: GearBase, shape: GearShape): Gear {
  return { ...base, ...shape };
}

export function isGearKind(value: unknown): value is GearKind {
  return value === 'spur' || value === 'helical';
}

export function isHand(value: unknown): value is Hand {
  return value === 'left' || value === 'right';
}
