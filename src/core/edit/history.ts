import { HISTORY_LIMIT } from '../constants';
import type { Scene } from '../scene/types';
import { applyCommand, type Command, type CommandContext, type CommandErrorCode } from './commands';

// Undo/Redo の履歴（design.md §7）。過去と未来のシーンの列を持つ純粋なデータ。
// 成功し、シーンの参照が変わったコマンドだけを積む。積むと未来は消える。上限は HISTORY_LIMIT。
// coalesceKey: 直前に積んだときと同じキーなら新しく積まない（連続した入力を 1 回の Undo にする）。
// Undo・Redo・キーなしの実行で、キーは途切れる

export interface History {
  readonly past: readonly Scene[]; // 古い順
  readonly future: readonly Scene[]; // 次に Redo するものが先頭
  readonly coalesceKey: string | null;
}

export function emptyHistory(): History {
  return { past: [], future: [], coalesceKey: null };
}

export interface EditState {
  scene: Scene;
  history: History;
}

export type ExecuteResult =
  | { ok: true; state: EditState; created: string[] }
  | { ok: false; error: { code: CommandErrorCode; message: string } };

export function execute(
  state: EditState,
  command: Command,
  ctx: CommandContext,
  options?: { coalesceKey?: string },
): ExecuteResult {
  const result = applyCommand(state.scene, command, ctx);
  if (!result.ok) return result;
  // 何も変わらないコマンドは積まない（履歴もそのまま）
  if (result.scene === state.scene) return { ok: true, state, created: result.created };

  const key = options?.coalesceKey ?? null;
  const { history } = state;
  const coalesce = key !== null && key === history.coalesceKey && history.past.length > 0;
  const past = coalesce ? history.past : [...history.past, state.scene].slice(-HISTORY_LIMIT);
  return {
    ok: true,
    state: { scene: result.scene, history: { past, future: [], coalesceKey: key } },
    created: result.created,
  };
}

// 戻せなければ null
export function undo(state: EditState): EditState | null {
  const { past, future } = state.history;
  const previous = past[past.length - 1];
  if (previous === undefined) return null;
  return {
    scene: previous,
    history: { past: past.slice(0, -1), future: [state.scene, ...future], coalesceKey: null },
  };
}

export function redo(state: EditState): EditState | null {
  const { past, future } = state.history;
  const next = future[0];
  if (next === undefined) return null;
  return {
    scene: next,
    history: {
      past: [...past, state.scene].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      coalesceKey: null,
    },
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}
