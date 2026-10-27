// window.__gearSim（開発用・テスト用ビルドのみ。design.md §10）

import type { Settings } from '../app/store';
import type { Command } from '../core/edit/commands';
import type { Lang } from '../core/i18n';
import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import type { Scene } from '../core/scene/types';
import type { CameraPose } from '../input/camera';
import type { ViewName } from '../input/views';
import type { InputDevice } from '../input/wheel';

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
  /** 現在の画面の言語 */
  getLanguage(): Lang;
  /** 画面の言語を切り替える（タブの題名と <html lang> も変わる） */
  setLanguage(lang: Lang): void;
  /** 今のカメラの視点（移っている途中ならその時点の値） */
  getCamera(): CameraPose;
  /** カメラを transition なしで即座にその視点にする */
  setCamera(pose: Pick<CameraPose, 'position' | 'target'>): void;
  /** 最後のコンテキストメニューの要求（右クリックしたページ座標）。まだ無ければ null */
  getLastContextRequest(): { x: number; y: number } | null;
  /** 今使っている入力デバイス（判別した、または設定で固定した。S1-14） */
  getInputDevice(): InputDevice;
  /** 設定の一部を書き換える（S1-14。S1-30 で設定画面からも同じ経路を使う） */
  updateSettings(patch: Partial<Settings>): void;
  /** 眺めるモードの ON/OFF（S1-14） */
  setWatchMode(on: boolean): void;
  /** 軸の目印の球の中心のページ座標（S1-14） */
  getGizmoTargets(): Array<{ view: ViewName; x: number; y: number }>;
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
