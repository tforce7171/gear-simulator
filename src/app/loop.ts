import { stepMotion } from '../core/kinematics/motion';
import { resolveLayout } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import type { Scene } from '../core/scene/types';
import type { SceneView } from '../render/scene-view';
import { warningParts } from '../render/warning-effects';
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
  readonly onFrame?: (dt: number) => void; // 描いた後に、そのフレームの経過時間（秒）を渡して呼ぶ
  // 描くシーン（ドラッグ中の仮のシーン。S1-17）。省略するとストアのシーン。運動はストアのシーンで進める
  readonly displayScene?: () => Scene;
}

// 1 フレーム分: 運動を進めてストアに入れ、描画に渡す。timeSec はロックの震え・光の時刻（秒）
export function runFrame(
  { store, view, layoutOf, displayScene }: LoopDeps,
  dt: number,
  timeSec = 0,
): void {
  const { scene, motion, sim } = store.getState();
  const layout = layoutOf(scene);
  const shown = displayScene?.() ?? scene;
  const shownLayout = shown === scene ? layout : resolveLayout(shown);
  view.sync(shown, shownLayout);
  // 一時停止中は全モーターを止めて解く（S1-22）。手で回している間は、つかんだシャフトを
  // 目標の角度にする（S1-21。一時停止中でも効く）
  const next = stepMotion(scene, layout, motion, dt, {
    paused: sim.paused,
    ...(sim.hand === null ? {} : { hand: sim.hand }),
  });
  store.setMotion(next);
  // ロック・干渉の表示は、運動を求めたシーン（ストアのシーン）で決める（S1-22）
  view.setWarnings?.(warningParts(scene, layout, next));
  view.update(next, shownLayout, timeSec);
  view.render();
}

// requestAnimationFrame で毎フレーム runFrame を呼ぶ。止める関数を返す
export function startLoop(deps: LoopDeps): () => void {
  let prev: number | null = null;
  let handle = 0;
  const tick = (now: number): void => {
    const dt = frameDt(prev, now);
    runFrame(deps, dt, now / 1000);
    prev = now;
    deps.onFrame?.(dt);
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
