import { describe, expect, it } from 'vitest';
import { createRandomIdGenerator, createSequentialIdGenerator } from './ids';

describe('createSequentialIdGenerator', () => {
  it('種類ごとに 1 から数える', () => {
    const gen = createSequentialIdGenerator();
    expect(gen('shaft')).toBe('shaft_1');
    expect(gen('gear')).toBe('gear_1');
    expect(gen('shaft')).toBe('shaft_2');
    expect(gen('motor')).toBe('motor_1');
  });
});

describe('createRandomIdGenerator', () => {
  it("'gear_' で始まり、1000 回呼んで重複しない", () => {
    const gen = createRandomIdGenerator();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = gen('gear');
      expect(id.startsWith('gear_')).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });

  it('乱数を注入できる', () => {
    expect(createRandomIdGenerator(() => 0)('shaft')).toBe('shaft_0000000000');
    expect(createRandomIdGenerator(() => 0.999999999)('motor')).toBe('motor_zzzzzzzzzz');
  });
});
