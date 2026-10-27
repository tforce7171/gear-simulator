import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT } from '../constants';
import { createSequentialIdGenerator } from '../scene/ids';
import { emptyScene } from '../scene/scene';
import type { Command, CommandContext } from './commands';
import { canRedo, canUndo, type EditState, emptyHistory, execute, redo, undo } from './history';

const BASIC_COMMANDS: readonly Command[] = [
  { type: 'addRootShaft', axis: 'y', origin: [0, 20, 0], gear: { size: 'S', teeth: 12 } },
  { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: Math.PI / 2, teeth: 24 },
  { type: 'growGear', mode: 'coaxial', shaftId: 'shaft_2', offset: 4, size: 'S', teeth: 24 },
  { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_3', angle: 0, teeth: 12 },
  { type: 'addMotor', shaftId: 'shaft_1', size: 'S' },
];

function run(
  state: EditState,
  command: Command,
  ctx: CommandContext,
  options?: { coalesceKey?: string },
): EditState {
  const result = execute(state, command, ctx, options);
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`);
  return result.state;
}

function must(state: EditState | null): EditState {
  if (state === null) throw new Error('unexpected null');
  return state;
}

function basic(): { state: EditState; ctx: CommandContext } {
  const ctx: CommandContext = { ids: createSequentialIdGenerator() };
  let state: EditState = { scene: emptyScene(), history: emptyHistory() };
  for (const command of BASIC_COMMANDS) state = run(state, command, ctx);
  return { state, ctx };
}

describe('history', () => {
  it('5 回 undo で空のシーン、6 回目は null、5 回 redo で同じ参照', () => {
    const { state } = basic();
    expect(state.history.past).toHaveLength(5);
    let s = state;
    for (let i = 0; i < 5; i++) s = must(undo(s));
    expect(s.scene).toEqual(emptyScene());
    expect(canUndo(s.history)).toBe(false);
    expect(undo(s)).toBeNull();
    for (let i = 0; i < 5; i++) s = must(redo(s));
    expect(s.scene).toBe(state.scene);
    expect(redo(s)).toBeNull();
    expect(canRedo(s.history)).toBe(false);
  });

  it('deleteParts → undo で削除前と同じ参照', () => {
    const { state, ctx } = basic();
    const deleted = run(state, { type: 'deleteParts', ids: ['gear_2'] }, ctx);
    expect(must(undo(deleted)).scene).toBe(state.scene);
  });

  it('失敗したコマンド・何も変えないコマンドは積まない', () => {
    const { state, ctx } = basic();
    const failed = execute(state, { type: 'deleteParts', ids: ['gear_99'] }, ctx);
    expect(failed.ok).toBe(false);
    const same = execute(state, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 12 }, ctx);
    if (!same.ok) throw new Error('failed');
    expect(same.state.scene).toBe(state.scene);
    expect(same.state.history.past).toHaveLength(state.history.past.length);
  });

  it('undo の後に新しいコマンドで future が空になる', () => {
    const { state, ctx } = basic();
    const undone = must(undo(state));
    expect(canRedo(undone.history)).toBe(true);
    const next = run(undone, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 20 }, ctx);
    expect(next.history.future).toEqual([]);
  });

  it('上限: 101 回 moveShaft で past は 100', () => {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    let state: EditState = { scene: emptyScene(), history: emptyHistory() };
    state = run(state, BASIC_COMMANDS[0] as Command, ctx);
    for (let i = 1; i <= 101; i++) {
      state = run(state, { type: 'moveShaft', shaftId: 'shaft_1', origin: [i, 20, 0] }, ctx);
    }
    expect(HISTORY_LIMIT).toBe(100);
    expect(state.history.past.length).toBe(100);
  });

  it('coalesceKey: 同じキーの連続は undo 1 回で戻る', () => {
    const { state, ctx } = basic();
    let s = state;
    for (const rpm of [70, 80, 90]) {
      s = run(s, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm } }, ctx, {
        coalesceKey: 'rpm-drag-1',
      });
    }
    expect(s.scene.motors.motor_1?.rpm).toBe(90);
    const back = must(undo(s));
    expect(back.scene.motors.motor_1?.rpm).toBe(60);
    expect(back.scene).toBe(state.scene);
  });

  it('coalesceKey: 間に undo が入ると途切れる', () => {
    const { state, ctx } = basic();
    const key = { coalesceKey: 'rpm-drag-1' };
    let s = run(state, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 70 } }, ctx, key);
    s = run(s, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 80 } }, ctx, key);
    s = must(undo(s)); // 60 に戻る
    expect(s.scene.motors.motor_1?.rpm).toBe(60);
    s = run(s, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 90 } }, ctx, key);
    s = run(s, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 100 } }, ctx, key);
    s = must(undo(s));
    expect(s.scene.motors.motor_1?.rpm).toBe(60);
    expect(s.scene).toBe(state.scene);
  });

  it('coalesceKey: 間にキーなしのコマンドが入ると途切れる', () => {
    const { state, ctx } = basic();
    const key = { coalesceKey: 'rpm-drag-1' };
    let s = run(state, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 70 } }, ctx, key);
    s = run(s, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 20 }, ctx);
    s = run(s, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 80 } }, ctx, key);
    s = must(undo(s));
    expect(s.scene.motors.motor_1?.rpm).toBe(70);
    expect(s.scene.gears.gear_1?.teeth).toBe(20);
  });
});
