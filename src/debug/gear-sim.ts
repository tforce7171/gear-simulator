// window.__gearSim（開発用・テスト用ビルドのみ。design.md §10）
import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import type { Scene } from '../core/scene/types';

export interface GearSimDebug {
  /** 最初のフレームを描いたら true */
  isReady(): boolean;
  getScene(): Scene;
  getLayout(): Layout;
  getMotion(): MotionState;
  /** シーンを置き換え、運動の状態を初期化する */
  loadScene(scene: Scene): void;
  /** ワールド座標の点の、ページ座標（CSS ピクセル） */
  projectToScreen(world: Vec3): { x: number; y: number };
}

declare global {
  interface Window {
    __gearSim?: GearSimDebug;
  }
}

/** production では何もしない */
export function installGearSim(api: GearSimDebug): void {
  if (import.meta.env.MODE === 'production') return;
  window.__gearSim = api;
}
