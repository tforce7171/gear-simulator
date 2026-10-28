// window.__gearSim（開発用・テスト用ビルドのみ。design.md §10）

import type { CandidateKind } from '../app/grow';
import type { Settings } from '../app/store';
import type { AudioState } from '../audio/engine';
import type { Command } from '../core/edit/commands';
import type { Lang } from '../core/i18n';
import type { HandConstraint, MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import type { GearId, Scene } from '../core/scene/types';
import type { Quality, ThemeId } from '../core/theme';
import type { CameraPose } from '../input/camera';
import type { HandleKind } from '../input/handle-drag';
import type { ViewName } from '../input/views';
import type { InputDevice } from '../input/wheel';
import type { PickHit } from '../render/picking';
import type { RenderStats } from '../render/renderer';

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
  /** 今の設定（AppState.settings。S1-30）。localStorage に保存している値と同じ */
  getSettings(): Settings;
  /** 眺めるモードの ON/OFF（S1-14） */
  setWatchMode(on: boolean): void;
  /** 表示の状態（S1-29）。情報表示を全歯車に出すか（ツールバー・メニュー）と、眺めるモードか */
  getView(): { infoOverlay: boolean; watchMode: boolean };
  /** 軸の目印の球の中心のページ座標（S1-14） */
  getGizmoTargets(): Array<{ view: ViewName; x: number; y: number }>;
  /** 選択中の部品の ID。無ければ []、あれば [id]（選択は 1 つだけ。S1-16） */
  getSelection(): string[];
  /** ページ座標の点の下の部品（優先順位つき）。何も無ければ null（S1-16） */
  pick(x: number, y: number): PickHit | null;
  /** 選択を置き換える。null で外す。シーンに無い ID は null と同じ（S1-16） */
  select(id: string | null): void;
  /**
   * 今出ているハンドル（S1-17・S1-19）。position はドラッグを始めるのに適した点
   * （projectToScreen して押す）。targetId は move・height・arc ではシャフト、axial では歯車
   */
  getHandles(): Array<{ kind: HandleKind; targetId: string; position: Vec3 }>;
  /**
   * 今表示している生やす候補（S1-18）。center は仮の歯車の中心のワールド座標。
   * index はピッキングの ID（pick の結果の kind: 'candidate' の id は String(index)）
   */
  getCandidates(): Array<{ index: number; kind: CandidateKind; center: Vec3 }>;
  /** 手で回しているシャフトと目標の角度（S1-21）。手で回していなければ null */
  getHand(): HandConstraint | null;
  /** 全モーターの一時停止中か（S1-22。Space の押して離すで切り替わる） */
  isPaused(): boolean;
  /**
   * ロック中・干渉中として表示している部品の ID（S1-22。どちらも昇順）。ロックはその成分の
   * 歯車・シャフト・モーター、干渉は組に含まれる部品で、ロック中のものは interfering に入れない
   */
  getWarningParts(): { locked: string[]; interfering: string[] };
  /**
   * 情報表示（S1-23）。enabled はツールバーの ON/OFF（OFF でも選択中の歯車には出る）。
   * arrows は今描いている回転方向の矢印（gearId の昇順。止まっている歯車は含まない）
   */
  getInfoOverlay(): { enabled: boolean; arrows: Array<{ gearId: GearId; direction: 1 | -1 }> };
  /**
   * 描画の状態（S1-24）。theme・quality は描画に適用済みの値、shadowMapEnabled は影の計算をしているか、
   * pixelRatio は描画の解像度、textures は GPU にあるテクスチャの数（renderer.info.memory.textures）
   */
  getRenderInfo(): {
    theme: ThemeId;
    quality: Quality;
    shadowMapEnabled: boolean;
    pixelRatio: number;
    textures: number;
  };
  /**
   * 描画の負荷（S1-31。scripts/perf.ts が使う）。frame は実際に描いた回数（renderer.info.render.frame。
   * 見た目が変わらないフレームは描かないので、rAF の回数より少ないことがある）、calls・triangles は
   * 最後に描いたフレームの値、redrawChecks・redrawCheckMs は描き直しの判定の回数と時間の合計（ms）
   */
  getRenderStats(): RenderStats;
  /**
   * 音の状態（S1-25）。contextState は AudioContext を作る前は 'none'（最初のユーザー操作で作る）。
   * voices は今鳴らしているかみ合い（動いている組のうち Layout.meshes の順で最初の 16 組）。
   * key は meshKey、frequency は歯の通過頻度（Hz、クランプしない）、click・tone はクロスフェードの重み
   */
  getAudio(): AudioState;
  /**
   * 保存の状態（S1-27）。lastAutosaveAt は最後に自動保存を書き終えた時刻（Date.now()。まだなら null）、
   * pendingAutosave は書いていない変更がある（デバウンスで待っている間と、書き込みが終わるまで）、
   * currentWorkId はいま開いている作品の ID（無ければ null）
   */
  getStorageStatus(): {
    lastAutosaveAt: number | null;
    pendingAutosave: boolean;
    currentWorkId: string | null;
  };
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
