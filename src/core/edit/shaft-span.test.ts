import { describe, expect, it } from 'vitest';
import { listGrowCandidates } from '../layout/candidates';
import { requiredShaftSpans, resolveLayout } from '../layout/resolve';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Gear, Scene, Shaft } from '../scene/types';
import { validateScene } from '../scene/validate';
import {
  applyCommand,
  type Command,
  type CommandResult,
  fitShaftSpans,
  stretchShaftSpan,
} from './commands';
import { emptyHistory, execute, redo, undo } from './history';

// S4-03: シャフトの範囲（Shaft.span）、伸縮のコマンド（setShaftSpan）、シャフトの上の位置を指定して歯車を足すコマンド
// （growGear の coaxial）

function root(id: string, origin: [number, number, number], span?: [number, number]): Shaft {
  return {
    id,
    placement: { kind: 'root', origin, axis: 'y' },
    ...(span === undefined ? {} : { span }),
  };
}

function spur(id: string, shaftId: string, offset = 0, teeth = 20): Gear {
  return { id, kind: 'spur', shaftId, size: 'M', teeth, offset };
}

function scene(shafts: Shaft[], gears: Gear[]): Scene {
  return {
    shafts: Object.fromEntries(shafts.map((s) => [s.id, s])),
    gears: Object.fromEntries(gears.map((g) => [g.id, g])),
    motors: {},
    anchors: {},
    carriers: {},
    racks: {},
  };
}

function apply(s: Scene, command: Command): CommandResult {
  return applyCommand(s, command, { ids: createSequentialIdGenerator() });
}

function ok(result: CommandResult): Scene {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.scene;
}

function code(result: CommandResult): string | null {
  return result.ok ? null : result.error.code;
}

// 縦の起点 A（原点 [0, 0, 0]）に中・20 歯（区画 [0, 8]、範囲 [−4, 12]）。その真上の起点 B（原点 [0, 60, 0]）にも同じ歯車。
// A を上へ伸ばすと、y = 56 で B のシャフトの下端に触れ、それより先は B のシャフト・歯車にぶつかる
const tower = scene(
  [root('shaft_a', [0, 0, 0], [-4, 12]), root('shaft_b', [0, 60, 0], [-4, 12])],
  [spur('gear_a', 'shaft_a'), spur('gear_b', 'shaft_b')],
);

describe('シャフトの範囲とレイアウト', () => {
  it('範囲を持つシャフトのレイアウトの span はその値（部品から求めない）', () => {
    const s = scene([root('shaft_a', [0, 0, 0], [-20, 40])], [spur('gear_a', 'shaft_a')]);
    expect(resolveLayout(s).shafts.shaft_a?.span).toEqual([-20, 40]);
    expect(validateScene(s)).toEqual({ ok: true });
  });

  it('範囲を省いたシャフトは、載っている部品の範囲（S4-03 より前と同じ長さ）', () => {
    const s = scene([root('shaft_a', [0, 0, 0])], [spur('gear_a', 'shaft_a', 8)]);
    expect(resolveLayout(s).shafts.shaft_a?.span).toEqual([4, 20]);
    expect(requiredShaftSpans(s).shaft_a).toEqual([4, 20]);
  });

  it('検証: 歯車の範囲（余白込み）がシャフトの範囲からはみ出す → spanTooShort。範囲の形が壊れている → invalidSpan', () => {
    const short = scene([root('shaft_a', [0, 0, 0], [-4, 8])], [spur('gear_a', 'shaft_a')]);
    const result = validateScene(short);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([
        ['spanTooShort', 'shafts.shaft_a.span'],
      ]);
    }
    const reversed = scene([root('shaft_a', [0, 0, 0], [12, -4])], [spur('gear_a', 'shaft_a')]);
    const r2 = validateScene(reversed);
    expect(r2.ok === false && r2.errors[0]?.code).toBe('invalidSpan');
  });
});

describe('setShaftSpan（伸縮のコマンド）', () => {
  it('4 mm の倍数で伸ばす・縮める → 通り、範囲だけが変わる', () => {
    const longer = ok(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-12, 40] }));
    expect(longer.shafts.shaft_a?.span).toEqual([-12, 40]);
    expect(longer.gears).toBe(tower.gears);
    expect(resolveLayout(longer).shafts.shaft_a?.span).toEqual([-12, 40]);
    const back = ok(apply(longer, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-4, 12] }));
    expect(back.shafts.shaft_a?.span).toEqual([-4, 12]);
  });

  it('歯車の範囲より短い → notAllowed', () => {
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-4, 8] }))).toBe(
      'notAllowed',
    );
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [0, 12] }))).toBe(
      'notAllowed',
    );
  });

  it('ほかの部品とぶつかる → notAllowed（触れるだけの 56 までは通る）', () => {
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-4, 56] }))).toBe(
      null,
    );
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-4, 60] }))).toBe(
      'notAllowed',
    );
  });

  it('4 mm の倍数でない → invalidValue。空・有限でない範囲 → invalidValue。無いシャフト → notFound', () => {
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-4, 14] }))).toBe(
      'invalidValue',
    );
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-6, 12] }))).toBe(
      'invalidValue',
    );
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [12, 12] }))).toBe(
      'invalidValue',
    );
    expect(
      code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [Number.NaN, 12] })),
    ).toBe('invalidValue');
    expect(code(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_x', span: [-4, 12] }))).toBe(
      'notFound',
    );
  });

  it('変えない端は 4 の倍数でなくてよい（version 3 から移したかさ歯車のシャフトなど）', () => {
    const odd = scene([root('shaft_a', [0, 0, 0], [-4, 13])], [spur('gear_a', 'shaft_a')]);
    expect(code(apply(odd, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-8, 13] }))).toBe(
      null,
    );
  });

  it('同じ範囲 → 同じシーンの参照', () => {
    const result = apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-4, 12] });
    expect(result.ok && result.scene).toBe(tower);
  });

  it('伸縮は 1 回の編集として Undo/Redo できる', () => {
    const state0 = { scene: tower, history: emptyHistory() };
    const done = execute(
      state0,
      { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-4, 40] },
      { ids: createSequentialIdGenerator() },
    );
    if (!done.ok) throw new Error('失敗');
    expect(done.state.scene.shafts.shaft_a?.span).toEqual([-4, 40]);
    const undone = undo(done.state);
    expect(undone?.scene).toBe(tower);
    const redone = undone === null ? null : redo(undone);
    expect(redone?.scene.shafts.shaft_a?.span).toEqual([-4, 40]);
  });
});

describe('stretchShaftSpan（つまみのドラッグ）', () => {
  it('4 mm 刻みに丸める', () => {
    expect(stretchShaftSpan(tower, 'shaft_a', 1, 30.7)).toEqual([-4, 32]);
    expect(stretchShaftSpan(tower, 'shaft_a', 0, -9.9)).toEqual([-8, 12]);
  });

  it('ほかの部品にぶつかる手前（触れる位置）で止まる', () => {
    expect(stretchShaftSpan(tower, 'shaft_a', 1, 100)).toEqual([-4, 56]);
    // B を下へ伸ばすと、A のシャフトの上端（y = 12）に触れる位置 −48 で止まる
    expect(stretchShaftSpan(tower, 'shaft_b', 0, -100)).toEqual([-48, 12]);
  });

  it('歯車の範囲より短くはならない', () => {
    expect(stretchShaftSpan(tower, 'shaft_a', 1, -50)).toEqual([-4, 12]);
    expect(stretchShaftSpan(tower, 'shaft_a', 0, 50)).toEqual([-4, 12]);
    const long = ok(apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span: [-20, 40] }));
    expect(stretchShaftSpan(long, 'shaft_a', 1, 0)).toEqual([-20, 12]);
  });

  it('返す範囲は setShaftSpan が受け付ける', () => {
    for (const target of [-100, -13, 0, 7, 21.9, 33, 55, 57, 200]) {
      for (const end of [0, 1] as const) {
        const span = stretchShaftSpan(tower, 'shaft_a', end, target);
        if (span === null) throw new Error('null');
        const result = apply(tower, { type: 'setShaftSpan', shaftId: 'shaft_a', span });
        expect(result.ok, `${end} ${target} → ${span.join(',')}`).toBe(true);
      }
    }
  });
});

describe('シャフトの上の位置を指定して歯車を足す（growGear の coaxial）', () => {
  // A のシャフトを [−4, 60] に伸ばした（B は無し）
  const long = scene([root('shaft_a', [0, 0, 0], [-4, 60])], [spur('gear_a', 'shaft_a')]);
  const place = (s: Scene, offset: number, size: 'S' | 'M' = 'M'): CommandResult =>
    apply(s, {
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_a',
      offset,
      size,
      teeth: size === 'M' ? 20 : 30,
    });

  it('空いている位置 → 置ける（シャフトの範囲は変わらない）', () => {
    const next = ok(place(long, 32));
    const added = Object.values(next.gears).find((g) => g.id !== 'gear_a');
    expect(added).toMatchObject({ shaftId: 'shaft_a', offset: 32, size: 'M' });
    expect(next.shafts.shaft_a?.span).toEqual([-4, 60]);
    expect(resolveLayout(next).interferences).toEqual([]);
  });

  it('同じシャフトの歯車と重なる位置 → notAllowed（接する位置は置ける）', () => {
    expect(code(place(long, 4))).toBe('notAllowed');
    expect(code(place(long, -4))).toBe('notAllowed');
    expect(code(place(long, 8))).toBe(null);
  });

  it('ほかの部品と重なる位置 → notAllowed', () => {
    // 真横の起点 C（原点 [40, 0, 0]）の中・30 歯（歯先円 32）を y 32〜40 に。A に置く中・20 歯（歯先円 22）とは
    // 中心距離 40 < 22 + 32 で重なる。小・30 歯（歯先円 16）なら重ならない
    const withC = scene(
      [root('shaft_a', [0, 0, 0], [-4, 60]), root('shaft_c', [40, 0, 0], [28, 44])],
      [spur('gear_a', 'shaft_a'), spur('gear_c', 'shaft_c', 32, 30)],
    );
    expect(resolveLayout(withC).interferences).toEqual([]);
    expect(code(place(withC, 32))).toBe('notAllowed');
    expect(code(place(withC, 48))).toBe(null);
  });

  it('歯車を足してシャフトからはみ出す → シャフトが伸びる', () => {
    const next = ok(place(long, 64));
    // 新しい歯車 [64, 72] + 余白 4
    expect(next.shafts.shaft_a?.span).toEqual([-4, 76]);
    const below = ok(place(long, -24));
    expect(below.shafts.shaft_a?.span).toEqual([-28, 60]);
    expect(validateScene(next)).toEqual({ ok: true });
  });

  it('伸びた先がほかの部品にぶつかる → notAllowed', () => {
    // A の上 [0, 60, 0] の B（範囲 [−4, 12]）。A の 44〜52 に置くと、シャフトが 56 まで伸びて B の下端に触れるだけ。
    // 48〜56 に置くと、シャフトが 60 まで伸びて B の歯車に当たる
    expect(code(place(tower, 44))).toBe(null);
    expect(code(place(tower, 48))).toBe('notAllowed');
  });

  it('置いた歯車は Undo で消え、Redo で戻る', () => {
    const state0 = { scene: long, history: emptyHistory() };
    const done = execute(
      state0,
      { type: 'growGear', mode: 'coaxial', shaftId: 'shaft_a', offset: 32, size: 'M', teeth: 20 },
      { ids: createSequentialIdGenerator() },
    );
    if (!done.ok) throw new Error('失敗');
    expect(Object.keys(done.state.scene.gears)).toHaveLength(2);
    const undone = undo(done.state);
    expect(undone?.scene).toBe(long);
    const redone = undone === null ? null : redo(undone);
    expect(Object.keys(redone?.scene.gears ?? {})).toHaveLength(2);
  });
});

describe('既存の編集とシャフトの範囲（fitShaftSpans）', () => {
  it('伸ばしたシャフトの上で歯車を動かしてはみ出す → シャフトがその分だけ伸びる（縮めない）', () => {
    const long = scene([root('shaft_a', [0, 0, 0], [-4, 40])], [spur('gear_a', 'shaft_a')]);
    const moved = ok(apply(long, { type: 'setGearOffset', gearId: 'gear_a', offset: 36 }));
    expect(moved.shafts.shaft_a?.span).toEqual([-4, 48]);
    const inside = ok(apply(long, { type: 'setGearOffset', gearId: 'gear_a', offset: 16 }));
    expect(inside.shafts.shaft_a?.span).toEqual([-4, 40]);
  });

  it('部品にぴったりのシャフト（伸縮していない）は、部品が動くとついていく', () => {
    const tight = scene([root('shaft_a', [0, 0, 0], [-4, 12])], [spur('gear_a', 'shaft_a')]);
    const moved = ok(apply(tight, { type: 'setGearOffset', gearId: 'gear_a', offset: 16 }));
    expect(moved.shafts.shaft_a?.span).toEqual([12, 28]);
  });

  it('内歯車のウェブを反対にする → 部品にぴったりのシャフトはついていく（空洞に伸びたまま残らない）', () => {
    const ring: Gear = {
      id: 'gear_r',
      kind: 'internal',
      webSide: -1,
      shaftId: 'shaft_a',
      size: 'M',
      teeth: 40,
      offset: 0,
    };
    const s = scene([root('shaft_a', [0, 0, 0], [-16, -8])], [ring]);
    expect(validateScene(s)).toEqual({ ok: true });
    const flipped = ok(apply(s, { type: 'setWebSide', gearId: 'gear_r', webSide: 1 }));
    expect(flipped.shafts.shaft_a?.span).toEqual([16, 24]);
  });

  it('外周に生やした新しいシャフトには、載っている歯車の範囲が入る', () => {
    const next = ok(
      apply(tower, {
        type: 'growGear',
        mode: 'perimeter',
        parentGearId: 'gear_a',
        angle: 0,
        teeth: 20,
      }),
    );
    const added = Object.values(next.shafts).find((s) => !(s.id in tower.shafts));
    expect(added?.span).toEqual([-4, 12]);
  });

  it('範囲を省いたままの既存のシャフトはそのまま', () => {
    const bare = scene([root('shaft_a', [0, 0, 0])], [spur('gear_a', 'shaft_a')]);
    const moved = ok(apply(bare, { type: 'setGearOffset', gearId: 'gear_a', offset: 16 }));
    expect(moved.shafts.shaft_a?.span).toBeUndefined();
    expect(fitShaftSpans(bare, bare)).toBe(bare);
  });

  it('親の歯車を消して浮いたシャフトは、範囲を保つ', () => {
    const grown = ok(
      apply(scene([root('shaft_a', [0, 0, 0], [-4, 12])], [spur('gear_a', 'shaft_a')]), {
        type: 'growGear',
        mode: 'perimeter',
        parentGearId: 'gear_a',
        angle: 0,
        teeth: 20,
      }),
    );
    const childShaft = Object.keys(grown.shafts).find((id) => id !== 'shaft_a') as string;
    const stretched = ok(
      apply(grown, { type: 'setShaftSpan', shaftId: childShaft, span: [-20, 12] }),
    );
    const deleted = ok(apply(stretched, { type: 'deleteParts', ids: ['gear_a'] }));
    expect(deleted.shafts[childShaft]?.placement.kind).toBe('detached');
    expect(deleted.shafts[childShaft]?.span).toEqual([-20, 12]);
  });
});

describe('同じ軸の候補（S4-03 で廃止）', () => {
  it('listGrowCandidates に、選んだ歯車のシャフトに通す候補が出ない', () => {
    for (const kind of ['spur', 'helical', 'worm', 'internal'] as const) {
      const list = listGrowCandidates(tower, 'gear_a', { perimeterTeeth: 20, kind });
      expect(list.map((c) => c.kind as string)).not.toContain('coaxial');
    }
  });
});
