import { initialMotionState, solveMotion } from '../core/kinematics/motion';
import type { MotionState } from '../core/kinematics/types';
import { resolveLayout } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import type { Scene } from '../core/scene/types';

// アプリの状態（design.md §7）。欄は使うタスクで足していく
export interface AppState {
  readonly scene: Scene;
  readonly motion: MotionState;
}

// このタスクでは内部のアクションだけ。編集コマンドは S1-11 で足す
export type AppAction = { readonly type: 'loadScene'; readonly scene: Scene };

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

function reduce(_state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'loadScene':
      return {
        scene: action.scene,
        motion: initialMotion(action.scene, resolveLayout(action.scene)),
      };
  }
}

export function createStore(scene: Scene): Store {
  let state: AppState = { scene, motion: initialMotion(scene, resolveLayout(scene)) };
  const listeners = new Set<(state: AppState) => void>();
  return {
    getState: () => state,
    dispatch(action) {
      state = reduce(state, action);
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
