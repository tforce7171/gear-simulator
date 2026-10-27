import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import type { Scene } from '../core/scene/types';

// app から見た描画の層
export interface SceneView {
  sync(scene: Scene, layout: Layout): void; // 参照が変わった部品だけ作り直す
  update(motion: MotionState, layout: Layout): void; // 毎フレーム、回転角だけ更新
  render(): void;
  projectToScreen(world: Vec3): { x: number; y: number }; // ページ座標（CSS ピクセル）
}
