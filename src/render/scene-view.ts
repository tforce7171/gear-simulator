import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import type { Scene } from '../core/scene/types';
import type { WarningParts } from './warning-effects';

// app から見た描画の層
export interface SceneView {
  sync(scene: Scene, layout: Layout): void; // 参照が変わった部品だけ作り直す
  // 毎フレーム、回転角と、ロックの震え・光（timeSec は経過時間の秒。S1-22）を更新
  update(motion: MotionState, layout: Layout, timeSec?: number): void;
  // ロック中・干渉中の部品（S1-22）。毎フレーム update の前に呼ぶ
  setWarnings?(warnings: WarningParts): void;
  render(): void;
  projectToScreen(world: Vec3): { x: number; y: number }; // ページ座標（CSS ピクセル）
}
