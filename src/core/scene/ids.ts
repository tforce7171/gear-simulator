// ID の生成（design.md §4）。テストでは決まった順の ID を返す生成関数を注入する
export type IdKind = 'shaft' | 'gear' | 'motor' | 'anchor';
export type IdGenerator = (kind: IdKind) => string; // "shaft_xxx" の形

const RANDOM_ID_LENGTH = 10;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function createRandomIdGenerator(random: () => number = Math.random): IdGenerator {
  return (kind) => {
    let body = '';
    for (let i = 0; i < RANDOM_ID_LENGTH; i++) {
      const index = Math.min(ALPHABET.length - 1, Math.floor(random() * ALPHABET.length));
      body += ALPHABET[index];
    }
    return `${kind}_${body}`;
  };
}

// テスト用。種類ごとに 1 から数える: "shaft_1", "shaft_2", "gear_1", ...
export function createSequentialIdGenerator(): IdGenerator {
  const counters: Record<IdKind, number> = { shaft: 0, gear: 0, motor: 0, anchor: 0 };
  return (kind) => {
    counters[kind] += 1;
    return `${kind}_${counters[kind]}`;
  };
}
