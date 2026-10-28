import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, type CommandContext } from '../edit/commands';
import { type EditState, emptyHistory, execute, redo, undo } from '../edit/history';
import { resolveLayout } from '../layout/resolve';
import { createSequentialIdGenerator } from '../scene/ids';
import { parseScene } from '../scene/parse';
import { anchorOfShaft } from '../scene/scene';
import type { Scene } from '../scene/types';
import { validateScene } from '../scene/validate';
import { computeGearInfo } from './info';
import { initialMotionState, type MotionOptions, solveMotion, stepMotion } from './motion';
import type { MotionState } from './types';

// S3-01: 固定具（アンカー）

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

const DIGITS = 10;

function ctx(): CommandContext {
  return { ids: createSequentialIdGenerator() };
}

function apply(scene: Scene, command: Command, context: CommandContext = ctx()): Scene {
  const result = applyCommand(scene, command, context);
  if (!result.ok) throw new Error(result.error.message);
  return result.scene;
}

function anchor(scene: Scene, shaftId: string): Scene {
  return apply(scene, { type: 'addAnchor', shaftId });
}

function solve(scene: Scene, opts?: MotionOptions): MotionState {
  return solveMotion(scene, resolveLayout(scene), initialMotionState(), opts);
}

function motorOff(scene: Scene, motorId: string): Scene {
  return apply(scene, { type: 'updateMotor', motorId, patch: { on: false } });
}

// anchor-pair: shaft_a（起点、モーター 中 30 rpm）に gear_a（中・20 歯）、外周に gear_b（中・40 歯、shaft_b）
const pair = fixture('anchor-pair');

describe('anchor-pair の運動', () => {
  it('固定具なし: A は π rad/s、B は −π/2 rad/s。ロックなし', () => {
    const motion = solve(pair);
    expect(motion.omegas.shaft_a).toBeCloseTo(Math.PI, DIGITS);
    expect(motion.omegas.shaft_b).toBeCloseTo(-Math.PI / 2, DIGITS);
    expect(motion.locks).toEqual([]);
  });

  it('B のシャフトを固定 → 両方の ω = 0、ロック 1 件（理由 anchor）', () => {
    const motion = solve(anchor(pair, 'shaft_b'));
    expect(motion.omegas).toEqual({ shaft_a: 0, shaft_b: 0 });
    expect(motion.locks).toEqual([
      { reason: 'anchor', shaftIds: ['shaft_a', 'shaft_b'], gearIds: ['gear_a', 'gear_b'] },
    ]);
  });

  it('A のシャフト（モーターのあるシャフト）を固定 → ロック（理由 anchor）', () => {
    const motion = solve(anchor(pair, 'shaft_a'));
    expect(motion.omegas).toEqual({ shaft_a: 0, shaft_b: 0 });
    expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
  });

  it('モーターを OFF にして B を固定 → ロックなし、ω = 0', () => {
    const motion = solve(anchor(motorOff(pair, 'motor_a'), 'shaft_b'));
    expect(motion.locks).toEqual([]);
    expect(motion.omegas).toEqual({ shaft_a: 0, shaft_b: 0 });
  });

  it('一時停止中に B を固定 → ロックなし', () => {
    const motion = solve(anchor(pair, 'shaft_b'), { paused: true });
    expect(motion.locks).toEqual([]);
  });

  it('固定を外すと回り出す（A は π rad/s）', () => {
    const anchored = anchor(pair, 'shaft_b');
    const id = anchorOfShaft(anchored, 'shaft_b')?.id ?? '';
    const freed = apply(anchored, { type: 'removeAnchor', anchorId: id });
    const motion = solve(freed);
    expect(motion.locks).toEqual([]);
    expect(motion.omegas.shaft_a).toBeCloseTo(Math.PI, DIGITS);
  });

  it('固定したまま進めても角度は変わらない', () => {
    const scene = anchor(pair, 'shaft_b');
    const layout = resolveLayout(scene);
    let motion = initialMotionState();
    for (let i = 0; i < 10; i++) motion = stepMotion(scene, layout, motion, 1 / 60);
    expect(motion.angles).toEqual({ shaft_a: 0, shaft_b: 0 });
  });

  it('情報表示のギア比は固定してもかみ合いの比のまま（B は 2.00 : 1）、rpm は 0', () => {
    const scene = anchor(pair, 'shaft_b');
    const info = computeGearInfo(scene, resolveLayout(scene), solve(scene));
    expect(info.gear_b?.ratio).toBeCloseTo(2, DIGITS);
    expect(info.gear_b?.rpm).toBe(0);
  });
});

describe('段階 1 の理由が残る', () => {
  it('三角形にかみ合う 3 枚（モーター付き）の 1 枚を固定 → 理由は contradiction のまま', () => {
    const triangle = fixture('lock-triangle');
    expect(solve(triangle).locks.map((l) => l.reason)).toEqual(['contradiction']);
    for (const shaftId of Object.keys(triangle.shafts)) {
      const motion = solve(anchor(triangle, shaftId));
      expect(motion.locks.map((l) => l.reason)).toEqual(['contradiction']);
    }
  });
});

// 離れた所に、独立したモーター付きの歯車（shaft_1 / gear_1 / motor_1）を置く
function withIndependent(scene: Scene): Scene {
  const context = ctx();
  const added = apply(
    scene,
    { type: 'addRootShaft', axis: 'y', origin: [200, 35, 0], gear: { size: 'M', teeth: 20 } },
    context,
  );
  return apply(added, { type: 'addMotor', shaftId: 'shaft_1', size: 'M' }, context);
}

describe('別の連結成分', () => {
  it('B を固定し、別の場所に独立したモーター付きの歯車 → そちらは回り続ける', () => {
    const scene = withIndependent(anchor(pair, 'shaft_b'));
    const motion = solve(scene);
    expect(motion.locks.map((l) => [l.reason, l.shaftIds])).toEqual([
      ['anchor', ['shaft_a', 'shaft_b']],
    ]);
    expect(motion.omegas.shaft_1).toBeGreaterThan(0.1);
  });
});

describe('手で回す', () => {
  it('B を固定して A をつかむ → ロック（anchor）。角度は変わらない', () => {
    const scene = anchor(pair, 'shaft_b');
    const motion = stepMotion(scene, resolveLayout(scene), initialMotionState(), 1 / 60, {
      hand: { shaftId: 'shaft_a', angle: 1 },
    });
    expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
    expect(motion.angles).toEqual({ shaft_a: 0, shaft_b: 0 });
    expect(motion.omegas).toEqual({ shaft_a: 0, shaft_b: 0 });
  });

  it('モーター OFF で B を固定して B 自身をつかむ → ロック（anchor）', () => {
    const scene = anchor(motorOff(pair, 'motor_a'), 'shaft_b');
    const motion = solve(scene, { hand: { shaftId: 'shaft_b', angle: 1 } });
    expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
  });

  it('固定のない成分をつかむ → 段階 1 と同じく追従（固定した成分はロックのまま）', () => {
    const scene = withIndependent(anchor(pair, 'shaft_b'));
    const motion = stepMotion(scene, resolveLayout(scene), initialMotionState(), 1 / 60, {
      hand: { shaftId: 'shaft_1', angle: 0.5 },
    });
    expect(motion.angles.shaft_1).toBeCloseTo(0.5, DIGITS);
    expect(motion.omegas.shaft_1).toBeCloseTo(0.5 * 60, DIGITS);
    expect(motion.locks.map((l) => l.shaftIds)).toEqual([['shaft_a', 'shaft_b']]);
  });

  it('固定具のない三角形をつかむ → 段階 1 の contradiction のまま', () => {
    const triangle = fixture('lock-triangle');
    const shaftId = Object.keys(triangle.shafts).sort()[0] as string;
    const motion = solve(triangle, { hand: { shaftId, angle: 1 } });
    expect(motion.locks.map((l) => l.reason)).toEqual(['contradiction']);
  });
});

describe('ウォームを含む成分（S2-03 の区画の解き方）', () => {
  // worm-basic: ウォーム（shaft_w、モーター）→ ホイール（shaft_h）
  const worm = fixture('worm-basic');

  it('ホイールのシャフトを固定 → ロック（anchor）、全 ω = 0', () => {
    expect(solve(worm).locks).toEqual([]);
    const motion = solve(anchor(worm, 'shaft_h'));
    expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
    expect(Object.values(motion.omegas).every((w) => w === 0)).toBe(true);
  });

  it('ウォームのシャフトを固定 → ロック（anchor）', () => {
    const motion = solve(anchor(worm, 'shaft_w'));
    expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
  });

  it('モーターを OFF にしてホイールを固定 → ロックなし', () => {
    const motorId = Object.keys(worm.motors)[0] as string;
    const motion = solve(anchor(motorOff(worm, motorId), 'shaft_h'));
    expect(motion.locks).toEqual([]);
  });

  it('逆駆動（worm-backdrive）のどのシャフトを固定しても wormBackDrive のまま', () => {
    const backdrive = fixture('worm-backdrive');
    expect(solve(backdrive).locks.map((l) => l.reason)).toEqual(['wormBackDrive']);
    for (const shaftId of Object.keys(backdrive.shafts)) {
      const reasons = solve(anchor(backdrive, shaftId)).locks.map((l) => l.reason);
      expect(reasons).toEqual(['wormBackDrive']);
    }
  });
});

describe('編集', () => {
  function run(state: EditState, command: Command, context: CommandContext): EditState {
    const result = execute(state, command, context);
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  }

  it('固定 → Undo で anchors が空 → Redo で戻る。同じシャフトに 2 回固定しても 2 つ目は何もしない', () => {
    const context = ctx();
    const start: EditState = { scene: pair, history: emptyHistory() };
    const anchored = run(start, { type: 'addAnchor', shaftId: 'shaft_b' }, context);
    expect(anchored.scene.anchors).toEqual({
      anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 'shaft_b' } },
    });
    expect(validateScene(anchored.scene)).toEqual({ ok: true });

    const twice = run(anchored, { type: 'addAnchor', shaftId: 'shaft_b' }, context);
    expect(twice).toBe(anchored);

    const undone = undo(anchored);
    expect(undone?.scene.anchors).toEqual({});
    const redone = undone === null ? null : redo(undone);
    expect(redone?.scene).toBe(anchored.scene);
  });

  it('固定を外す → anchors が空。Undo で戻る。無い固定具は notFound', () => {
    const context = ctx();
    const start: EditState = { scene: anchor(pair, 'shaft_a'), history: emptyHistory() };
    const id = Object.keys(start.scene.anchors)[0] as string;
    const removed = run(start, { type: 'removeAnchor', anchorId: id }, context);
    expect(removed.scene.anchors).toEqual({});
    expect(undo(removed)?.scene).toBe(start.scene);
    const missing = applyCommand(removed.scene, { type: 'removeAnchor', anchorId: id }, context);
    expect(missing.ok ? null : missing.error.code).toBe('notFound');
  });

  it('シーンに無いシャフトは notFound', () => {
    const result = applyCommand(pair, { type: 'addAnchor', shaftId: 'shaft_x' }, ctx());
    expect(result.ok ? null : result.error.code).toBe('notFound');
  });

  it('固定したシャフトを削除 → anchors が空。Undo でシャフトと固定具が両方戻る', () => {
    const context = ctx();
    const start: EditState = { scene: pair, history: emptyHistory() };
    const anchored = run(start, { type: 'addAnchor', shaftId: 'shaft_b' }, context);
    const deleted = run(anchored, { type: 'deleteParts', ids: ['shaft_b'] }, context);
    expect(deleted.scene.shafts.shaft_b).toBeUndefined();
    expect(deleted.scene.anchors).toEqual({});
    expect(validateScene(deleted.scene)).toEqual({ ok: true });
    const undone = undo(deleted);
    expect(undone?.scene).toBe(anchored.scene);
    expect(undone?.scene.shafts.shaft_b).toBeDefined();
    expect(Object.keys(undone?.scene.anchors ?? {})).toEqual(['anchor_1']);
  });

  it('歯車を消して、その歯車だけのシャフトが消えると固定具も消える', () => {
    const deleted = apply(anchor(pair, 'shaft_b'), { type: 'deleteParts', ids: ['gear_b'] });
    expect(deleted.shafts.shaft_b).toBeUndefined();
    expect(deleted.anchors).toEqual({});
  });

  it('歯車を消しても、シャフトが残る限り固定具は残る', () => {
    const context = ctx();
    const coaxial = apply(
      pair,
      { type: 'growGear', mode: 'coaxial', shaftId: 'shaft_a', offset: 8, size: 'M', teeth: 20 },
      context,
    );
    const scene = apply(coaxial, { type: 'addAnchor', shaftId: 'shaft_a' }, context);
    const deleted = apply(scene, { type: 'deleteParts', ids: ['gear_a'] }, context);
    expect(deleted.shafts.shaft_a).toBeDefined();
    expect(Object.values(deleted.anchors).map((a) => a.target)).toEqual([
      { kind: 'shaft', id: 'shaft_a' },
    ]);
    expect(validateScene(deleted)).toEqual({ ok: true });
  });
});

describe('読み込みと検証', () => {
  // S3-05: 暫定の補いを取り除いた。anchors の無い古いファイルは version 2 → 3 の移行が {} を足す
  it('anchors のないシーン → invalidShape（anchors）', () => {
    const { anchors: _anchors, ...raw } = pair;
    const result = parseScene(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: 'invalidShape', path: 'anchors' });
  });

  it('anchors のあるシーンは固定具を拾う（型にないフィールドは捨てる）', () => {
    const raw = {
      ...pair,
      anchors: {
        anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 'shaft_b', extra: 1 }, x: 2 },
      },
    };
    const result = parseScene(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.anchors).toEqual({
      anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 'shaft_b' } },
    });
  });

  it('形が違う固定具は invalidShape', () => {
    for (const anchors of [
      [],
      { bad_1: { id: 'bad_1', target: { kind: 'shaft', id: 'shaft_b' } } },
      { anchor_1: { id: 'anchor_1', target: 'shaft_b' } },
      { anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 3 } } },
    ]) {
      const result = parseScene({ ...pair, anchors });
      expect(result.ok ? null : result.errors[0]?.code).toBe('invalidShape');
    }
  });

  it('検証: 対象が無い → missingRef、種類が違う → invalidAnchorTarget、2 つ → multipleAnchors', () => {
    const codes = (anchors: Scene['anchors']): string[] => {
      const result = validateScene({ ...pair, anchors });
      return result.ok ? [] : result.errors.map((e) => e.code);
    };
    expect(
      codes({ anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 'shaft_x' } } }),
    ).toEqual(['missingRef']);
    expect(
      codes({ anchor_1: { id: 'anchor_1', target: { kind: 'motor', id: 'shaft_b' } as never } }),
    ).toEqual(['invalidAnchorTarget']);
    // S3-04 から対象にラックを足した（無いラックは missingRef）
    expect(codes({ anchor_1: { id: 'anchor_1', target: { kind: 'rack', id: 'rack_x' } } })).toEqual(
      ['missingRef'],
    );
    expect(
      codes({
        anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 'shaft_b' } },
        anchor_2: { id: 'anchor_2', target: { kind: 'shaft', id: 'shaft_b' } },
      }),
    ).toEqual(['multipleAnchors']);
    expect(
      codes({ anchor_1: { id: 'anchor_2', target: { kind: 'shaft', id: 'shaft_b' } } }),
    ).toEqual(['idMismatch']);
  });
});

describe('干渉', () => {
  it('resolveLayout の interferences は、固定具の有無で変わらない', () => {
    for (const name of ['anchor-pair', 'overlap', 'showcase', 'stage2-showcase']) {
      const scene = fixture(name);
      const context = ctx();
      let anchored = scene;
      for (const shaftId of Object.keys(scene.shafts)) {
        anchored = apply(anchored, { type: 'addAnchor', shaftId }, context);
      }
      expect(Object.keys(anchored.anchors)).toHaveLength(Object.keys(scene.shafts).length);
      expect(resolveLayout(anchored).interferences).toEqual(resolveLayout(scene).interferences);
    }
  });
});
