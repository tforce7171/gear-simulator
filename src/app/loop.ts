import { stepMotion } from '../core/kinematics/motion';
import type { Layout } from '../core/layout/types';
import type { Scene } from '../core/scene/types';
import type { SceneView } from '../render/scene-view';
import type { Store } from './store';

// タブが裏に回ったときなどの飛びを防ぐ、1 フレームの経過時間の上限（秒）
export const MAX_FRAME_DT = 0.1;

// 前のフレームの時刻（ms。最初のフレームは null）から経過時間（秒）を求める
export function frameDt(prevMs: number | null, nowMs: number): number {
  if (prevMs === null) return 0;
  return Math.min(Math.max((nowMs - prevMs) / 1000, 0), MAX_FRAME_DT);
}

export interface LoopDeps {
  readonly store: Store;
  readonly view: SceneView;
  readonly layoutOf: (scene: Scene) => Layout;
  readonly onFrame?: () => void; // 描いた後に呼ぶ
}

// 1 フレーム分: 運動を進めてストアに入れ、描画に渡す
export function runFrame({ store, view, layoutOf }: LoopDeps, dt: number): void {
  const { scene, motion } = store.getState();
  const layout = layoutOf(scene);
  view.sync(scene, layout);
  const next = stepMotion(scene, layout, motion, dt);
  store.setMotion(next);
  view.update(next, layout);
  view.render();
}

// requestAnimationFrame で毎フレーム runFrame を呼ぶ。止める関数を返す
export function startLoop(deps: LoopDeps): () => void {
  let prev: number | null = null;
  let handle = 0;
  const tick = (now: number): void => {
    runFrame(deps, frameDt(prev, now));
    prev = now;
    deps.onFrame?.();
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
