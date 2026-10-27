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
import type { InputDeviceSetting, TrackpadScroll } from '../input/wheel';

// 設定（design.md §7 の Settings）。項目は各担当タスクで足す（S1-30 で localStorage に保存する）
export interface Settings {
  readonly inputDevice: InputDeviceSetting; // 入力デバイス（S1-14）
  readonly trackpadScroll: TrackpadScroll; // 2 本指スクロールの割り当て（S1-14）
}

export const DEFAULT_SETTINGS: Settings = {
  inputDevice: 'auto',
  trackpadScroll: 'pan',
};

// 表示の状態（design.md §7 の AppState.view）。infoOverlay は S1-23 で足す
export interface ViewState {
  readonly watchMode: boolean; // 眺めるモード（S1-14）
}

export const DEFAULT_VIEW: ViewState = { watchMode: false };

// アプリの状態（design.md §7）。欄は使うタスクで足していく
export interface AppState {
  readonly scene: Scene;
  readonly history: History; // Undo/Redo の履歴（S1-11）
  readonly motion: MotionState;
  readonly view: ViewState; // S1-14
  readonly settings: Settings; // S1-14
}

// loadScene: 履歴を空にしてシーンを置き換える（テストの準備用。Undo の対象にしない）。
// command: 編集コマンド（core/edit）を実行して履歴に積む。undo / redo: 履歴をたどる
export type AppAction =
  | { readonly type: 'loadScene'; readonly scene: Scene }
  | { readonly type: 'command'; readonly command: Command; readonly coalesceKey?: string }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  // 設定の一部を書き換える（S1-30 の設定画面も同じ経路を使う）
  | { readonly type: 'updateSettings'; readonly patch: Partial<Settings> }
  | { readonly type: 'setWatchMode'; readonly on: boolean };

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
  return { ...state, scene: edited.scene, history: edited.history, motion };
}

// patch の値が undefined の項目は変えない。何も変わらなければ同じ参照を返す
function mergeSettings(settings: Settings, patch: Partial<Settings>): Settings {
  let next = settings;
  for (const key of Object.keys(patch) as Array<keyof Settings>) {
    const value = patch[key];
    if (value === undefined || value === settings[key]) continue;
    next = { ...next, [key]: value };
  }
  return next;
}

function reduce(state: AppState, action: AppAction, ids: IdGenerator): AppState {
  switch (action.type) {
    case 'loadScene':
      return {
        ...state,
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
    case 'updateSettings': {
      const settings = mergeSettings(state.settings, action.patch);
      return settings === state.settings ? state : { ...state, settings };
    }
    case 'setWatchMode':
      return state.view.watchMode === action.on
        ? state
        : { ...state, view: { ...state.view, watchMode: action.on } };
  }
}

export function createStore(scene: Scene, options: StoreOptions = {}): Store {
  const ids = options.ids ?? createRandomIdGenerator();
  let state: AppState = {
    scene,
    history: emptyHistory(),
    motion: initialMotion(scene, resolveLayout(scene)),
    view: DEFAULT_VIEW,
    settings: DEFAULT_SETTINGS,
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
