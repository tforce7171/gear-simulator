import type { Scene } from '../core/scene/types';

// S1-04 で起動時に読み込んでいた仮のシーン。e2e/fixtures/two-spur.json と同じもの。
// S1-27 から起動時は自動保存（無ければ空のシーン）で始めるので、今は単体テストの共通のシーンとして使う
export const demoScene: Scene = {
  shafts: {
    // シャフトの範囲（S4-03）は、小（歯幅 4）の歯車の両面から SHAFT_END_MARGIN ずつ
    shaft_1: {
      id: 'shaft_1',
      placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' },
      span: [-4, 8],
    },
    shaft_2: {
      id: 'shaft_2',
      placement: {
        kind: 'mesh',
        parentGearId: 'gear_1',
        childGearId: 'gear_2',
        angle: Math.PI / 2,
      },
      span: [-4, 8],
    },
  },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
    gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 24, offset: 0 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'S', rpm: 60, direction: 1, on: true },
  },
  anchors: {},
  carriers: {},
  racks: {},
};
