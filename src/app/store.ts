import type { Command } from '../core/edit/commands';
import {
  type EditState,
  emptyHistory,
  execute,
  type History,
  redo,
  undo,
} from '../core/edit/history';
import { initialMotionState, solveMotion } from '../core/kinematics/motion';
import type { MotionState } from '../core/kinematics/types';
import { resolveLayout } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import { createRandomIdGenerator, type IdGenerator } from '../core/scene/ids';
import type { Scene } from '../core/scene/types';

// アプリの状態（design.md §7）。欄は使うタスクで足していく
export interface AppState {
  readonly scene: Scene;
  readonly history: History; // Undo/Redo の履歴（S1-11）
  readonly motion: MotionState;
}

// loadScene: 履歴を空にしてシーンを置き換える（テストの準備用。Undo の対象にしない）。
// command: 編集コマンド（core/edit）を実行して履歴に積む。undo / redo: 履歴をたどる
export type AppAction =
  | { readonly type: 'loadScene'; readonly scene: Scene }
  | { readonly type: 'command'; readonly command: Command; readonly coalesceKey?: string }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' };

export interface StoreOptions {
  readonly ids?: IdGenerator; // 新しい部品の ID（既定はランダム）
}

export interface Store {
  getState(): AppState;
  dispatch(action: AppAction): void;
  subscribe(listener: (state: AppState) => void): () => void; // 解除する関数を返す
  // 毎フレームの運動の更新。購読者には知らせない（毎フレーム呼ばれるため）
  setMotion(motion: MotionState): void;
}

// シーンを読み込んだ直後の運動: 角度は 0、ω・ロック・負けたモーターは今のシーンから求めた値
export function initialMotion(scene: Scene, layout: Layout): MotionState {
  return solveMotion(scene, layout, initialMotionState());
}

// 編集でシーンが変わったとき: 角度はそのまま引き継ぎ、ω・ロック・負けたモーターを新しいシーンで求め直す
function withEdit(state: AppState, edited: EditState | null): AppState {
  if (edited === null || (edited.scene === state.scene && edited.history === state.history)) {
    return state;
  }
  const motion =
    edited.scene === state.scene
      ? state.motion
      : solveMotion(edited.scene, resolveLayout(edited.scene), state.motion);
  return { scene: edited.scene, history: edited.history, motion };
}

function reduce(state: AppState, action: AppAction, ids: IdGenerator): AppState {
  switch (action.type) {
    case 'loadScene':
      return {
        scene: action.scene,
        history: emptyHistory(),
        motion: initialMotion(action.scene, resolveLayout(action.scene)),
      };
    case 'command': {
      const options = action.coalesceKey === undefined ? {} : { coalesceKey: action.coalesceKey };
      const result = execute(state, action.command, { ids }, options);
      // 失敗したコマンドは何も変えない（想定内の失敗なので例外にしない）
      return result.ok ? withEdit(state, result.state) : state;
    }
    case 'undo':
      return withEdit(state, undo(state));
    case 'redo':
      return withEdit(state, redo(state));
  }
}

export function createStore(scene: Scene, options: StoreOptions = {}): Store {
  const ids = options.ids ?? createRandomIdGenerator();
  let state: AppState = {
    scene,
    history: emptyHistory(),
    motion: initialMotion(scene, resolveLayout(scene)),
  };
  const listeners = new Set<(state: AppState) => void>();
  return {
    getState: () => state,
    // 状態が変わったときだけ購読者に知らせる（loadScene は常に変わる）
    dispatch(action) {
      const next = reduce(state, action, ids);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setMotion(motion) {
      state = { ...state, motion };
    },
  };
}

// シーンの参照が同じなら前の結果を返す（design.md §5）
export function createLayoutMemo(): (scene: Scene) => Layout {
  let lastScene: Scene | undefined;
  let lastLayout: Layout | undefined;
  return (scene) => {
    if (scene !== lastScene || lastLayout === undefined) {
      lastScene = scene;
      lastLayout = resolveLayout(scene);
    }
    return lastLayout;
  };
}
