import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../layout/resolve';
import type { Layout, Mesh } from '../layout/types';
import type { Gear, Motor, Scene, Shaft } from '../scene/types';
import { computeGearInfo, formatRatio, formatRpm, visibleInfoGearIds } from './info';
import { initialMotionState, solveMotion } from './motion';

// S1-23: 情報表示の値

const DIGITS = 9;

// シーン A: シャフト s1（モーター 小、60 rpm、向き +1、ON）に歯車 g1（小、12 枚）。
// g1 の外周に g2（小、36 枚、シャフト s2）。g2 の外周に g3（小、24 枚、シャフト s3）
function sceneA(motorOn = true): Scene {
  return {
    shafts: {
      shaft_s1: { id: 'shaft_s1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
      shaft_s2: {
        id: 'shaft_s2',
        placement: { kind: 'mesh', parentGearId: 'gear_g1', childGearId: 'gear_g2', angle: 0 },
      },
      shaft_s3: {
        id: 'shaft_s3',
        placement: { kind: 'mesh', parentGearId: 'gear_g2', childGearId: 'gear_g3', angle: 0 },
      },
    },
    gears: {
      gear_g1: {
        id: 'gear_g1',
        kind: 'spur',
        shaftId: 'shaft_s1',
        size: 'S',
        teeth: 12,
        offset: 0,
      },
      gear_g2: {
        id: 'gear_g2',
        kind: 'spur',
        shaftId: 'shaft_s2',
        size: 'S',
        teeth: 36,
        offset: 0,
      },
      gear_g3: {
        id: 'gear_g3',
        kind: 'spur',
        shaftId: 'shaft_s3',
        size: 'S',
        teeth: 24,
        offset: 0,
      },
    },
    motors: {
      motor_m1: {
        id: 'motor_m1',
        shaftId: 'shaft_s1',
        size: 'S',
        rpm: 60,
        direction: 1,
        on: motorOn,
      },
    },
  };
}

function infoOf(scene: Scene, layout: Layout = resolveLayout(scene)) {
  const motion = solveMotion(scene, layout, initialMotionState());
  return computeGearInfo(scene, layout, motion);
}

// 形だけのシーン。歯車は小・12 枚（teeth で上書きできる）。シャフトは root（親子の参照は使わない）
function plainScene(
  gears: ReadonlyArray<readonly [id: string, shaftId: string, teeth?: number]>,
  motors: readonly Motor[] = [],
): Scene {
  const shafts: Record<string, Shaft> = {};
  const gearMap: Record<string, Gear> = {};
  for (const [id, shaftId, teeth = 12] of gears) {
    shafts[shaftId] = { id: shaftId, placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } };
    gearMap[id] = { id, kind: 'spur', shaftId, size: 'S', teeth, offset: 0 };
  }
  const motorMap: Record<string, Motor> = {};
  for (const m of motors) motorMap[m.id] = m;
  return { shafts, gears: gearMap, motors: motorMap };
}

function layoutOf(meshes: readonly Mesh[]): Layout {
  return { shafts: {}, gears: {}, meshes, interferences: [] };
}

function motor(id: string, shaftId: string, direction: 1 | -1 = 1): Motor {
  return { id, shaftId, size: 'S', rpm: 60, direction, on: true };
}

describe('computeGearInfo', () => {
  it('シーン A: g1 60 rpm・+1・1.00、g2 20 rpm・−1・3.00、g3 30 rpm・+1・2.00', () => {
    const info = infoOf(sceneA());
    expect(info.gear_g1?.rpm).toBeCloseTo(60, DIGITS);
    expect(info.gear_g1?.direction).toBe(1);
    expect(info.gear_g1?.ratio).toBeCloseTo(1, DIGITS);
    expect(info.gear_g2?.rpm).toBeCloseTo(20, DIGITS);
    expect(info.gear_g2?.direction).toBe(-1);
    expect(info.gear_g2?.ratio).toBeCloseTo(3, DIGITS);
    expect(info.gear_g3?.rpm).toBeCloseTo(30, DIGITS);
    expect(info.gear_g3?.direction).toBe(1);
    expect(info.gear_g3?.ratio).toBeCloseTo(2, DIGITS);
    for (const id of ['gear_g1', 'gear_g2', 'gear_g3']) {
      expect(info[id]?.gearId).toBe(id);
      expect(info[id]?.referenceMotorId).toBe('motor_m1');
    }
  });

  it('シーン A でモーターを OFF: rpm 0・向き 0、ギア比は同じ（1.00 / 3.00 / 2.00）', () => {
    const info = infoOf(sceneA(false));
    const expected: Record<string, number> = { gear_g1: 1, gear_g2: 3, gear_g3: 2 };
    for (const [id, ratio] of Object.entries(expected)) {
      expect(info[id]?.rpm).toBe(0);
      expect(info[id]?.direction).toBe(0);
      expect(info[id]?.ratio).toBeCloseTo(ratio, DIGITS);
      expect(info[id]?.referenceMotorId).toBe('motor_m1');
    }
  });

  it('一時停止中も rpm は 0 で、ギア比は同じ', () => {
    const scene = sceneA();
    const layout = resolveLayout(scene);
    const motion = solveMotion(scene, layout, initialMotionState(), { paused: true });
    const info = computeGearInfo(scene, layout, motion);
    expect(info.gear_g2?.rpm).toBe(0);
    expect(info.gear_g2?.direction).toBe(0);
    expect(info.gear_g2?.ratio).toBeCloseTo(3, DIGITS);
  });

  it('モーターのない連結成分の歯車: ratio null、referenceMotorId null', () => {
    const scene = plainScene([
      ['gear_a', 'shaft_a'],
      ['gear_b', 'shaft_b'],
    ]);
    const info = infoOf(
      scene,
      layoutOf([{ a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'spur' }]),
    );
    for (const id of ['gear_a', 'gear_b']) {
      expect(info[id]?.ratio).toBeNull();
      expect(info[id]?.referenceMotorId).toBeNull();
      expect(info[id]?.rpm).toBe(0);
      expect(info[id]?.direction).toBe(0);
    }
  });

  it('モーターが別の連結成分にだけある歯車: ratio null', () => {
    const scene = plainScene(
      [
        ['gear_a', 'shaft_a'],
        ['gear_b', 'shaft_b'],
      ],
      [motor('motor_a', 'shaft_a')],
    );
    const info = infoOf(scene, layoutOf([]));
    expect(info.gear_a?.ratio).toBeCloseTo(1, DIGITS);
    expect(info.gear_b?.ratio).toBeNull();
    expect(info.gear_b?.referenceMotorId).toBeNull();
  });

  it('三角形にかみ合って矛盾した連結成分: ratio null、rpm 0', () => {
    const scene = plainScene(
      [
        ['gear_a', 'shaft_a'],
        ['gear_b', 'shaft_b'],
        ['gear_c', 'shaft_c'],
      ],
      [motor('motor_a', 'shaft_a')],
    );
    const info = infoOf(
      scene,
      layoutOf([
        { a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'spur' },
        { a: 'gear_b', b: 'gear_c', source: 'tree', kind: 'spur' },
        { a: 'gear_a', b: 'gear_c', source: 'contact', kind: 'spur' },
      ]),
    );
    for (const id of ['gear_a', 'gear_b', 'gear_c']) {
      expect(info[id]?.ratio).toBeNull();
      expect(info[id]?.rpm).toBe(0);
      expect(info[id]?.direction).toBe(0);
    }
  });

  it('連結成分にモーターが 2 つ（motor_b と motor_a）: referenceMotorId は motor_a', () => {
    // A(12)–B(24)。motor_b を A、motor_a を B に付ける（シャフトの順と ID の順を逆にする）
    const scene = plainScene(
      [
        ['gear_a', 'shaft_a', 12],
        ['gear_b', 'shaft_b', 24],
      ],
      [motor('motor_b', 'shaft_a'), motor('motor_a', 'shaft_b', -1)],
    );
    const info = infoOf(
      scene,
      layoutOf([{ a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'spur' }]),
    );
    expect(info.gear_a?.referenceMotorId).toBe('motor_a');
    expect(info.gear_b?.referenceMotorId).toBe('motor_a');
    // 基準は B のシャフト。B が 1 回転すると A は 2 回転する
    expect(info.gear_b?.ratio).toBeCloseTo(1, DIGITS);
    expect(info.gear_a?.ratio).toBeCloseTo(0.5, DIGITS);
  });

  it('モーターのシャフトに載っている歯車は 1.00（同じシャフトの 2 枚目も）', () => {
    const base = sceneA();
    const scene: Scene = {
      ...base,
      gears: {
        ...base.gears,
        gear_g4: {
          id: 'gear_g4',
          kind: 'spur',
          shaftId: 'shaft_s1',
          size: 'S',
          teeth: 40,
          offset: 8,
        },
      },
    };
    const info = infoOf(scene);
    expect(info.gear_g1?.ratio).toBeCloseTo(1, DIGITS);
    expect(info.gear_g4?.ratio).toBeCloseTo(1, DIGITS);
    expect(info.gear_g4?.rpm).toBeCloseTo(60, DIGITS);
  });

  it('シーンの全歯車を含む', () => {
    expect(Object.keys(infoOf(sceneA())).sort()).toEqual(['gear_g1', 'gear_g2', 'gear_g3']);
  });
});

describe('formatRpm', () => {
  it('小数 1 桁、1000 以上は整数', () => {
    expect(formatRpm(20)).toBe('20.0 rpm');
    expect(formatRpm(0.04)).toBe('0.0 rpm');
    expect(formatRpm(1234.5)).toBe('1235 rpm');
    expect(formatRpm(0)).toBe('0.0 rpm');
    expect(formatRpm(1000)).toBe('1000 rpm');
  });
});

describe('formatRatio', () => {
  it('小数 2 桁、決まらなければ —', () => {
    expect(formatRatio(3)).toBe('3.00 : 1');
    expect(formatRatio(1 / 3)).toBe('0.33 : 1');
    expect(formatRatio(null)).toBe('—');
  });
});

describe('visibleInfoGearIds', () => {
  const scene = sceneA();
  it('OFF で選択なし → []', () => {
    expect(visibleInfoGearIds(scene, null, false)).toEqual([]);
  });
  it('OFF で g2 を選択 → [g2]', () => {
    expect(visibleInfoGearIds(scene, 'gear_g2', false)).toEqual(['gear_g2']);
  });
  it('OFF でシャフトを選択 → []', () => {
    expect(visibleInfoGearIds(scene, 'shaft_s2', false)).toEqual([]);
  });
  it('ON → 全歯車（選択に依らない）', () => {
    const all = ['gear_g1', 'gear_g2', 'gear_g3'];
    expect(visibleInfoGearIds(scene, null, true)).toEqual(all);
    expect(visibleInfoGearIds(scene, 'shaft_s2', true)).toEqual(all);
  });
});
