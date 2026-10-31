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
import type { HandConstraint, MotionState } from '../core/kinematics/types';
import type { PaletteKind } from '../core/layout/candidates';
import { resolveLayout, withShaftSpans } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import { createRandomIdGenerator, type IdGenerator } from '../core/scene/ids';
import type { Scene, SizeKey } from '../core/scene/types';
import { defaultSettings, type Settings } from '../core/settings';
import { pruneSelection } from './selection';

// 設定（design.md §7 の Settings）。型・初期値・保存の形は core/settings.ts（S1-30）
export type { Settings } from '../core/settings';

// createStore に settings を渡さないときの初期値（言語は英語）。アプリは main.ts が localStorage から
// 読んだ設定を渡す（S1-30）
export const DEFAULT_SETTINGS: Settings = defaultSettings('');

// 表示の状態（design.md §7 の AppState.view）。保存しない
export interface ViewState {
  readonly watchMode: boolean; // 眺めるモード（S1-14）
  readonly infoOverlay: boolean; // 情報表示を全歯車に出す（S1-23）。OFF は選択中の歯車だけ
}

export const DEFAULT_VIEW: ViewState = { watchMode: false, infoOverlay: false };

// 運動の入力（design.md §7 の AppState.sim）。保存せず、Undo の対象にしない
export interface SimState {
  readonly paused: boolean; // 全モーターの一時停止（S1-22）。シーンのモーターの on は変えない
  readonly hand: HandConstraint | null; // 手で回しているシャフトと目標の角度（S1-21）。回していなければ null
}

export const DEFAULT_SIM: SimState = { paused: false, hand: null };

// 部品パレットで選んでいるもの（design.md §7 の AppState.palette。S1-17・S2-05）。シーンに含めず、Undo の対象にしない
export interface PaletteState {
  readonly size: SizeKey; // 起点を置く・同じ軸に生やす歯車の大きさ
  // 生やす歯車の種類（S2-05）。S4-02 からラック・遊星も選べ、候補はこの種類の歯車ができるものだけになる
  readonly kind: PaletteKind;
}

export const DEFAULT_PALETTE: PaletteState = { size: 'M', kind: 'spur' };

// アプリの状態（design.md §7）。欄は使うタスクで足していく
export interface AppState {
  readonly scene: Scene;
  readonly history: History; // Undo/Redo の履歴（S1-11）
  readonly selection: string | null; // 選択中の歯車かシャフト。1 つだけ（S1-16）
  readonly motion: MotionState;
  readonly sim: SimState; // S1-21
  readonly view: ViewState; // S1-14
  readonly settings: Settings; // S1-14
  readonly palette: PaletteState; // S1-17
  // いま開いている作品（S1-27）。保存しない（再読み込み後は null）
  readonly currentWork: CurrentWork | null;
}

export interface CurrentWork {
  readonly id: string;
  readonly name: string;
}

// loadScene: 履歴を空にしてシーンを置き換える（テストの準備用。Undo の対象にしない）。
// command: 編集コマンド（core/edit）を実行して履歴に積む。undo / redo: 履歴をたどる
export type AppAction =
  | { readonly type: 'loadScene'; readonly scene: Scene }
  // selectCreated: 成功して部品を作ったら、最後に作った部品を選ぶ（起点を置いたら歯車を選ぶ。S1-17）
  | {
      readonly type: 'command';
      readonly command: Command;
      readonly coalesceKey?: string;
      readonly selectCreated?: boolean;
    }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  // 設定の一部を書き換える（S1-30 の設定画面も同じ経路を使う）
  | { readonly type: 'updateSettings'; readonly patch: Partial<Settings> }
  | { readonly type: 'setWatchMode'; readonly on: boolean }
  // 情報表示の ON/OFF（S1-23。S1-29 のコンテキストメニューも同じ経路を使う）
  | { readonly type: 'setInfoOverlay'; readonly on: boolean }
  // 選択を置き換える（null で外す）。シーンに無い ID は null として扱う（S1-16）
  | { readonly type: 'select'; readonly id: string | null }
  // パレットで選ぶ歯車の大きさ（S1-17）
  | { readonly type: 'setPaletteSize'; readonly size: SizeKey }
  // パレットで選ぶ、同じ軸に生やす歯車の種類（S2-05）
  | { readonly type: 'setPaletteKind'; readonly kind: PaletteKind }
  // 全モーターの一時停止を切り替える（S1-22）。シーンと履歴は変えない
  | { readonly type: 'togglePause' }
  // いま開いている作品を置き換える（S1-27。保存・開く・名前の変更・削除で使う）。シーンと履歴は変えない
  | { readonly type: 'setCurrentWork'; readonly work: CurrentWork | null };

export interface StoreOptions {
  readonly ids?: IdGenerator; // 新しい部品の ID（既定はランダム）
  readonly settings?: Settings; // 設定の初期値（S1-30。既定は DEFAULT_SETTINGS）
}

export interface Store {
  getState(): AppState;
  dispatch(action: AppAction): void;
  subscribe(listener: (state: AppState) => void): () => void; // 解除する関数を返す
  // 毎フレームの運動の更新。購読者には知らせない（毎フレーム呼ばれるため）
  setMotion(motion: MotionState): void;
  // 手の拘束（S1-21）。ポインターが動くたびに呼ばれるので、購読者には知らせない
  setHand(hand: HandConstraint | null): void;
}

// シーンを読み込んだ直後の運動: 角度は 0、ω・ロック・負けたモーターは今のシーンから求めた値
// paused: 一時停止中なら全モーターを止めた状態で解く（S1-22）
export function initialMotion(scene: Scene, layout: Layout, paused = false): MotionState {
  return solveMotion(scene, layout, initialMotionState(), { paused });
}

// 編集でシーンが変わったとき: 角度はそのまま引き継ぎ、ω・ロック・負けたモーターを新しいシーンで求め直す
function withEdit(state: AppState, edited: EditState | null): AppState {
  if (edited === null || (edited.scene === state.scene && edited.history === state.history)) {
    return state;
  }
  const motion =
    edited.scene === state.scene
      ? state.motion
      : solveMotion(edited.scene, resolveLayout(edited.scene), state.motion, {
          paused: state.sim.paused,
        });
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
    case 'loadScene': {
      // 範囲を省いたシャフト（テストのシーンなど）には、載っている部品から求めた範囲を入れる（S4-03）
      const scene = withShaftSpans(action.scene);
      return {
        ...state,
        scene,
        history: emptyHistory(),
        // 一時停止は保つ（シーンを差し替えても切り替わらない。S1-22）
        sim: { ...state.sim, hand: null },
        motion: initialMotion(scene, resolveLayout(scene), state.sim.paused),
      };
    }
    case 'command': {
      const options = action.coalesceKey === undefined ? {} : { coalesceKey: action.coalesceKey };
      const result = execute(state, action.command, { ids }, options);
      // 失敗したコマンドは何も変えない（想定内の失敗なので例外にしない）
      if (!result.ok) return state;
      const edited = withEdit(state, result.state);
      const created = result.created[result.created.length - 1];
      if (action.selectCreated !== true || created === undefined || edited === state) return edited;
      return { ...edited, selection: pruneSelection(created, edited.scene) };
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
    case 'setInfoOverlay':
      return state.view.infoOverlay === action.on
        ? state
        : { ...state, view: { ...state.view, infoOverlay: action.on } };
    case 'select': {
      const selection = pruneSelection(action.id, state.scene);
      return selection === state.selection ? state : { ...state, selection };
    }
    case 'setPaletteSize':
      return state.palette.size === action.size
        ? state
        : { ...state, palette: { ...state.palette, size: action.size } };
    case 'setPaletteKind':
      return state.palette.kind === action.kind
        ? state
        : { ...state, palette: { ...state.palette, kind: action.kind } };
    case 'togglePause': {
      const paused = !state.sim.paused;
      // 運動はすぐに解き直す（次のフレームを待たずに ω が 0 になる・戻る）。角度は引き継ぐ
      const motion = solveMotion(state.scene, resolveLayout(state.scene), state.motion, { paused });
      return { ...state, sim: { ...state.sim, paused }, motion };
    }
    case 'setCurrentWork': {
      const prev = state.currentWork;
      const next = action.work;
      if (
        prev === next ||
        (prev !== null && next !== null && prev.id === next.id && prev.name === next.name)
      ) {
        return state;
      }
      return { ...state, currentWork: next };
    }
  }
}

// シーンが変わって選択中の部品が無くなったら（削除、Undo など）選択を外す（S1-16）
function reduceWithSelection(state: AppState, action: AppAction, ids: IdGenerator): AppState {
  const next = reduce(state, action, ids);
  if (next === state || next.scene === state.scene) return next;
  const selection = pruneSelection(next.selection, next.scene);
  return selection === next.selection ? next : { ...next, selection };
}

export function createStore(initialScene: Scene, options: StoreOptions = {}): Store {
  const ids = options.ids ?? createRandomIdGenerator();
  // 範囲を省いたシャフトには、載っている部品から求めた範囲を入れる（S4-03。loadScene と同じ）
  const scene = withShaftSpans(initialScene);
  let state: AppState = {
    scene,
    history: emptyHistory(),
    selection: null,
    motion: initialMotion(scene, resolveLayout(scene)),
    sim: DEFAULT_SIM,
    view: DEFAULT_VIEW,
    settings: options.settings ?? DEFAULT_SETTINGS,
    palette: DEFAULT_PALETTE,
    currentWork: null,
  };
  const listeners = new Set<(state: AppState) => void>();
  return {
    getState: () => state,
    // 状態が変わったときだけ購読者に知らせる（loadScene は常に変わる）
    dispatch(action) {
      const next = reduceWithSelection(state, action, ids);
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
    setHand(hand) {
      if (hand === state.sim.hand) return;
      state = { ...state, sim: { ...state.sim, hand } };
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
