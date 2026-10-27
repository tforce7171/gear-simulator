import { describe, expect, it } from 'vitest';
import type { Scene } from '../core/scene/types';
import { pruneSelection, selectionForPick } from './selection';

const scene: Scene = {
  shafts: { shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } } },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'M', teeth: 20, offset: 0 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'M', rpm: 30, direction: 1, on: true },
  },
};

describe('selectionForPick', () => {
  it('歯車 → その歯車', () => {
    expect(selectionForPick({ kind: 'gear', id: 'gear_1' }, scene)).toBe('gear_1');
  });
  it('モーター → そのモーターのシャフト', () => {
    expect(selectionForPick({ kind: 'motor', id: 'motor_1' }, scene)).toBe('shaft_1');
  });
  it('シャフト → そのシャフト', () => {
    expect(selectionForPick({ kind: 'shaft', id: 'shaft_1' }, scene)).toBe('shaft_1');
  });
  it('null → null', () => {
    expect(selectionForPick(null, scene)).toBeNull();
  });
  it('ハンドル・候補・シーンに無い部品 → null', () => {
    expect(selectionForPick({ kind: 'handle', id: 'h' }, scene)).toBeNull();
    expect(selectionForPick({ kind: 'candidate', id: 'c' }, scene)).toBeNull();
    expect(selectionForPick({ kind: 'gear', id: 'gear_x' }, scene)).toBeNull();
    expect(selectionForPick({ kind: 'motor', id: 'motor_x' }, scene)).toBeNull();
  });
});

describe('pruneSelection', () => {
  it('シーンに無い ID → null', () => {
    expect(pruneSelection('gear_x', scene)).toBeNull();
  });
  it('ある ID → そのまま', () => {
    expect(pruneSelection('gear_1', scene)).toBe('gear_1');
    expect(pruneSelection('shaft_1', scene)).toBe('shaft_1');
  });
  it('null → null', () => {
    expect(pruneSelection(null, scene)).toBeNull();
  });
});
