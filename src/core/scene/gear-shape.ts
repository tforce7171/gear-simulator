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
    case 'bevel':
      return { kind: 'bevel', apex: gear.apex };
    case 'worm':
      return { kind: 'worm' };
    case 'wormWheel':
      return { kind: 'wormWheel' };
    case 'crossedHelical':
      return { kind: 'crossedHelical' };
    default:
      return assertNever(gear);
  }
}

// 起点や同じ軸に新しく置く歯車の形。ハスバ歯車は 'right'、かさ歯車は apex 1
export function newGearShape(kind: GearKind): GearShape {
  switch (kind) {
    case 'spur':
      return { kind: 'spur' };
    case 'helical':
      return { kind: 'helical', hand: 'right' };
    case 'bevel':
      return { kind: 'bevel', apex: 1 };
    case 'worm':
      return { kind: 'worm' };
    case 'wormWheel':
      return { kind: 'wormWheel' };
    case 'crossedHelical':
      return { kind: 'crossedHelical' };
    default:
      return assertNever(kind);
  }
}

export function oppositeHand(hand: Hand): Hand {
  return hand === 'right' ? 'left' : 'right';
}

// 外周に生やす子の形。親とかみ合う形（平歯車は平歯車、ハスバ歯車は逆のねじれの向き）。
// かさ歯車は外周（mesh）には生やさない（bevel の配置。子の apex は −side で決まる）ので null。
// ウォームとホイール（S2-03）、ねじ歯車（S2-04）も外周には生やさない（skew の配置）ので null
export function meshPartnerShape(shape: GearShape): GearShape | null {
  switch (shape.kind) {
    case 'spur':
      return { kind: 'spur' };
    case 'helical':
      return { kind: 'helical', hand: oppositeHand(shape.hand) };
    case 'bevel':
    case 'worm':
    case 'wormWheel':
    case 'crossedHelical':
      return null;
    default:
      return assertNever(shape);
  }
}

// ねじれた位置の 90°（skew の配置）に生やす子の形（S2-03）。ウォームにはホイール、ホイールにはウォーム、
// ねじ歯車にはねじ歯車（S2-04）。skew に生やさない種類は null
export function skewPartnerShape(shape: GearShape): GearShape | null {
  switch (shape.kind) {
    case 'worm':
      return { kind: 'wormWheel' };
    case 'wormWheel':
      return { kind: 'worm' };
    case 'crossedHelical':
      return { kind: 'crossedHelical' };
    case 'spur':
    case 'helical':
    case 'bevel':
      return null;
    default:
      return assertNever(shape);
  }
}

// 種類によらないフィールドと形から歯車を作る
export function makeGear(base: GearBase, shape: GearShape): Gear {
  return { ...base, ...shape };
}

// 種類の一覧。Record にして、種類を足したときの書き忘れを型で検出する
const GEAR_KINDS: Readonly<Record<GearKind, true>> = {
  spur: true,
  helical: true,
  bevel: true,
  worm: true,
  wormWheel: true,
  crossedHelical: true,
};

export function isGearKind(value: unknown): value is GearKind {
  return typeof value === 'string' && Object.hasOwn(GEAR_KINDS, value);
}

export function isHand(value: unknown): value is Hand {
  return value === 'left' || value === 'right';
}

export function isApex(value: unknown): value is 1 | -1 {
  return value === 1 || value === -1;
}
