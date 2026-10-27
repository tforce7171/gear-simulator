// window.__gearSim（開発用・テスト用ビルドのみ。design.md §10）
import type { Command } from '../core/edit/commands';
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
  /** 履歴を空にしてシーンを置き換え、運動の状態を初期化する（Undo の対象にしない） */
  loadScene(scene: Scene): void;
  /** 編集コマンドを実行する（Undo の履歴に積まれる。失敗したら何も変えない） */
  dispatch(command: Command): void;
  /** 1 つ前のシーンに戻す（戻せなければ何もしない） */
  undo(): void;
  /** Undo したシーンをやり直す（やり直せなければ何もしない） */
  redo(): void;
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
