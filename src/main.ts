import { Vector3 } from 'three';
import { getLanguage, onLanguageChange, setLanguage, t } from './app/i18n';
import { createInfoOverlay } from './app/info-overlay';
import { createInteractions } from './app/interactions';
import { createJsonIo } from './app/json-io';
import { startLoop } from './app/loop';
import { restoreScene } from './app/restore';
import { selectionForPick } from './app/selection';
import { createLayoutMemo, createStore } from './app/store';
import { createWorks } from './app/works';
import { createAudioEngine } from './audio/engine';
import { computeMeshVoices, computeMotorHums, lockPosition } from './core/audio-model';
import { AUTOSAVE_DEBOUNCE_MS, THUMBNAIL_SIZE } from './core/constants';
import { toSaveFile } from './core/io/save-file';
import { boundsOf } from './core/layout/bounds';
import { meshableKinds } from './core/layout/candidates';
import { resolveLayout } from './core/layout/resolve';
import { shaftWorldOrigin } from './core/layout/world';
import { defaultSettings } from './core/settings';
import { nextTheme, THEME_AUDIO_MATERIAL } from './core/theme';
import { installGearSim } from './debug/gear-sim';
import { type ContextRequest, createCameraInput } from './input/camera';
import { createKeyboard, isTypingTarget } from './input/keyboard';
import type { PickKind } from './input/pick-priority';
import { createSelectionInput } from './input/selection-input';
import { createSpaceTapDetector } from './input/space-tap';
import { createAxisGizmo } from './render/axis-gizmo';
import { infoArrowSpec } from './render/info-arrows';
import {
  createRenderer,
  INITIAL_CAMERA_POSITION,
  INITIAL_CAMERA_TARGET,
  ORTHO_FRUSTUM_HEIGHT,
} from './render/renderer';
import { motorCenter } from './render/sync';
import { warningParts } from './render/warning-effects';
import { createAutosaver } from './storage/autosave';
import * as db from './storage/db';
import { browserStorage, loadSettings, saveSettings } from './storage/settings-storage';
import { createContextMenu } from './ui/context-menu/controller';
import { createFilePicker, downloadText } from './ui/file-io';
import { createInfoLabels } from './ui/info-labels';
import { createPalette } from './ui/palette';
import { createPauseIndicator } from './ui/pause-indicator';
import { createProperties } from './ui/properties';
import { openSaveDialog } from './ui/save-dialog';
import { createSettingsDialog } from './ui/settings-dialog';
import { createUiShell } from './ui/shell';
import { showToast } from './ui/toast';
import { openWorksDialog } from './ui/works-dialog';

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('#root が見つからない');

// 設定（S1-30）: 最初の描画の前に localStorage から読む。使えない・壊れていれば初期値（言語はブラウザの言語）。
// 言語は画面を作る前に合わせる
const settingsStorage = browserStorage();
const initialSettings = loadSettings(settingsStorage, defaultSettings(navigator.language));
setLanguage(initialSettings.language);

// 画面の骨組み（S1-15）。canvas は中央の描画領域に入れる
const shell = createUiShell(root);
const canvas = document.createElement('canvas');
canvas.id = 'app';
shell.canvasHost.append(canvas);

// タブの題名と <html lang> を現在の言語に合わせる（design.md §8）
function applyLanguage(): void {
  document.title = t('app.title');
  document.documentElement.lang = getLanguage();
}
applyLanguage();
onLanguageChange(applyLanguage);

// 最初の描画の前に自動保存を読み、あればそのシーンで始める（S1-27。履歴は空）。読めない・壊れているときは
// 空のシーンで始め、壊れていたときだけトーストで知らせる。IndexedDB を使えなければ自動保存を止める
const restored = await restoreScene(db.loadAutosave);
if (restored.status === 'failed') showToast('storage.restoreFailed', 'error');
const storageAvailable = restored.status !== 'unavailable';
const store = createStore(restored.scene, { settings: initialSettings });
// 設定の参照が変わったら localStorage に書く（S1-30）。書けなければトーストで 1 回だけ知らせる（起動中に
// 何度失敗しても 1 回）
let savedSettings = store.getState().settings;
let settingsSaveFailedShown = false;
store.subscribe(({ settings }) => {
  if (settings === savedSettings) return;
  savedSettings = settings;
  if (!saveSettings(settingsStorage, settings) && !settingsSaveFailedShown) {
    settingsSaveFailedShown = true;
    showToast('settings.saveFailed', 'error');
  }
});
// 言語（S1-30）: settings.language と i18n の言語をいつも一致させる。設定画面などで設定が変わったら
// i18n に、ほかの経路で i18n の言語が変わったら設定に映す
store.subscribe(({ settings }) => setLanguage(settings.language));
onLanguageChange((language) => store.dispatch({ type: 'updateSettings', patch: { language } }));
const layoutOf = createLayoutMemo();
const renderer = createRenderer(canvas, {
  theme: store.getState().settings.theme,
  quality: store.getState().settings.quality,
});
// テーマと品質（S1-24）: 設定が変わったら描画に反映する（同じ値なら renderer 側で何もしない）
store.subscribe(({ settings }) => renderer.applyTheme(settings.theme, settings.quality));
const themeButton = shell.toolbar.button('theme');
themeButton.disabled = false;
themeButton.addEventListener('click', () => {
  store.dispatch({
    type: 'updateSettings',
    patch: { theme: nextTheme(store.getState().settings.theme) },
  });
});
const keyboard = createKeyboard(window);
const cameraInput = createCameraInput({
  camera: renderer.camera,
  orthoCamera: renderer.orthoCamera,
  orthoFrustumHeight: ORTHO_FRUSTUM_HEIGHT,
  setProjection: renderer.setProjection,
  canvas,
  keyboard,
  boundsOf: (ids) => {
    const { scene } = store.getState();
    return boundsOf(scene, layoutOf(scene), ids);
  },
  pickPoint: renderer.pickPoint,
  initialPose: { position: INITIAL_CAMERA_POSITION, target: INITIAL_CAMERA_TARGET },
  getSettings: () => store.getState().settings,
  isWatching: () => store.getState().view.watchMode,
  // F で寄る先（S1-16）
  getSelection: () => store.getState().selection,
});
// 編集の操作（S1-17）: パレットから起点を置く、ハンドルのドラッグ、R
const interactions = createInteractions({
  store,
  canvas,
  rayAt: renderer.rayAt,
  // パネル・軸の目印の上は描画領域の外として扱う
  isOverViewport: (x, y) =>
    document.elementFromPoint(x - window.scrollX, y - window.scrollY) === canvas,
  setPreviewStyle: renderer.setPreviewStyle,
  setHandles: renderer.setHandles,
  setCandidates: renderer.setCandidates,
  setReattachRings: renderer.setReattachRings,
  projectToScreen: (world) => renderer.projectToScreen(world),
});
// 描くシーン（ドラッグ中は仮のシーン）と、そのハンドルを描画に渡す
const syncDisplay = (): void => {
  const scene = interactions.displayScene();
  const { scene: stored } = store.getState();
  renderer.sync(scene, scene === stored ? layoutOf(scene) : resolveLayout(scene));
  interactions.beforeRender();
};
// ピッキング（S1-16）。描く前（loadScene や編集の直後）でも今のシーンで当てるように、先に同期する
const pickAt = (x: number, y: number, kinds?: readonly PickKind[]) => {
  syncDisplay();
  return renderer.pick(x, y, kinds);
};
// 部品の本体（候補・ハンドルを除く）。候補の陰にある本体を調べる（S1-19）
const BODY_KINDS = ['gear', 'carrier', 'rack', 'motor', 'shaft'] as const;
const bodyAt = (x: number, y: number) => {
  syncDisplay();
  return renderer.pick(x, y, BODY_KINDS);
};
// ハンドルの陰の候補（S4-02）
const candidateAt = (x: number, y: number) => pickAt(x, y, ['candidate']);
// クリックで受け取る部品（S4-02）。ハンドルの見えない太めの当たり判定にだけ当たり、その陰に候補があれば候補にする
// （ハンドルはドラッグでしか使わない。そうしないと、ハンドルの近くの候補をクリックしても置けない）。
// 見えているハンドルの形の上のクリックは、これまでどおりハンドル（何もしない）
// sync が偽なら描画の同期をしない（毎フレームのマウスの位置の判定。描く直前に同期済み）
const clickTargetAt = (x: number, y: number, sync = true) => {
  const pick = sync ? pickAt : renderer.pick;
  const hit = pick(x, y);
  if (hit?.kind !== 'handle' || hit.proxyOnly !== true) return hit;
  return pick(x, y, ['candidate']) ?? hit;
};
// 部品・ハンドルの上の左ボタンはカメラを回さない。候補の上は左クリックだけアプリが受け取り、
// 左ドラッグはカメラの回転にする（候補は手で回せないため。S1-18）。ただし、選んでいる detached の
// シャフトの本体が候補の陰にあれば、左ドラッグは付け直しにする（S1-19）
cameraInput.setHitTest((x, y) => {
  const hit = pickAt(x, y);
  if (hit === null) return 'none';
  if (hit.kind !== 'candidate') return 'app';
  return interactions.isReattachBody(bodyAt(x, y)) ? 'app' : 'click-only';
});

// 経路 'app' の左ボタン: ハンドルの上ならハンドルのドラッグ（S1-17・S1-19）、選んでいる detached の
// シャフトの本体なら付け直しのドラッグ（S1-19）、それ以外の部品の本体なら手で回す（S1-21）
cameraInput.onAppPointerDown((e) => {
  const hit = pickAt(e.pageX, e.pageY);
  if (hit?.kind === 'handle') {
    // ハンドルの陰に候補があれば、しきい値以上動いてからハンドルを動かす（動かさずに離せば候補のクリック。S4-02）
    interactions.beginHandleDrag(e, hit.id, candidateAt(e.pageX, e.pageY) !== null);
    return;
  }
  const body = bodyAt(e.pageX, e.pageY);
  if (interactions.pressBody(e, body)) return;
  interactions.pressHand(e, body);
});

// 選択（S1-16）。左クリックで当たった部品を選び（モーターはそのシャフト）、何もない所なら外す。
// ハンドルのクリックでは選択を変えない（S1-17）。候補のクリックでは歯車を生やして選ぶ（S1-18）
const selectAt = (x: number, y: number): void => {
  const { scene } = store.getState();
  const hit = clickTargetAt(x, y);
  if (hit?.kind === 'handle') return;
  // 選んでいるシャフト（とその上の仮の歯車）のクリックは、パレットの種類の歯車をその位置に置く（S4-03）
  const placed = interactions.placeOnShaft({ x, y }, hit);
  if (placed === 'blocked') showToast('shaftPlace.blocked', 'error');
  if (placed !== null) return;
  if (hit?.kind === 'candidate') {
    interactions.grow(Number(hit.id));
    return;
  }
  store.dispatch({ type: 'select', id: selectionForPick(hit, scene) });
};
// マウスを乗せた位置。ハイライトする部品は描く前に求め直す（シーンやカメラが動いても追従する）
let hoverPoint: { x: number; y: number } | null = null;
createSelectionInput({
  canvas,
  onClick: selectAt,
  onHover: (point) => {
    hoverPoint = point;
  },
});
// コンテキストメニュー（S1-29）。右クリック（ドラッグなし）の位置で部品の本体を当て、部品の上なら選択を
// 置き換えて部品のメニュー、何もない所なら何もない所のメニューを開く
const contextMenu = createContextMenu({
  host: document.body,
  getState: () => store.getState(),
  dispatch: (action) => store.dispatch(action),
  pickBody: bodyAt,
  dollyToPoint: (world) => cameraInput.dollyToPoint(world),
  fitAll: () => cameraInput.fitAll(),
});
// Esc: メニューを開いていれば閉じるだけ（S1-29。ふつうはメニューが先に受け取る）。ドラッグ中ならやめて
// 元に戻す（S1-17）。手で回している最中なら回すのを終える（S1-21）。それ以外は選択を外す
const unselect = (): void => {
  if (contextMenu.isOpen()) {
    contextMenu.close();
    return;
  }
  if (interactions.cancel()) return;
  store.dispatch({ type: 'select', id: null });
};
const deleteSelection = (): void => {
  const { selection } = store.getState();
  if (selection === null) return;
  store.dispatch({ type: 'command', command: { type: 'deleteParts', ids: [selection] } });
};
keyboard.bind({ key: 'Escape' }, { onDown: unselect });
keyboard.bind({ key: 'Delete' }, { onDown: deleteSelection });
// Mac のキーボードの delete キーは Backspace
keyboard.bind({ key: 'Backspace' }, { onDown: deleteSelection });
// Ctrl は Mac の Cmd も含む（keyboard.ts）
keyboard.bind(
  { key: 'z', ctrl: true, shift: false },
  { onDown: () => store.dispatch({ type: 'undo' }), allowRepeat: true },
);
keyboard.bind(
  { key: 'z', ctrl: true, shift: true },
  { onDown: () => store.dispatch({ type: 'redo' }), allowRepeat: true },
);
// Space の押して離す: 全モーターの一時停止を切り替える（S1-22）。押している間にカメラのドラッグ
// （Space+ドラッグの平行移動）があった、または長く押していたときは切り替えない。押している間の
// 平行移動は camera.ts が同じキーで受け取る
const spaceTap = createSpaceTapDetector();
keyboard.bind(
  { key: ' ' },
  {
    onDown: (e) => {
      spaceTap({ type: 'keydown', repeat: e.repeat, timeMs: e.timeStamp });
    },
    onUp: (e) => {
      // テキストの入力中は文字の入力に任せる。それ以外（ボタンにフォーカスがあるときなど）は、
      // 離したときのボタンの押下も止める（押したときは keyboard.ts が止める）
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (spaceTap({ type: 'keyup', timeMs: e.timeStamp }) === 'tap') {
        store.dispatch({ type: 'togglePause' });
      }
    },
    allowRepeat: true,
  },
);
cameraInput.onDragStart(() => {
  spaceTap({ type: 'drag' });
});
// R: 起点を置くドラッグ中は仮の部品の向き、それ以外は選んだ起点（detached）のシャフトの向き（S1-17）
keyboard.bind({ key: 'r' }, { onDown: () => interactions.rotate() });
// 部品パレット（S1-17）: 歯車の大きさ、生やす歯車の種類（S2-05）と、床へドラッグして置く起点のシャフト
const palette = createPalette({
  body: shell.palette.body,
  getSize: () => store.getState().palette.size,
  setSize: (size) => store.dispatch({ type: 'setPaletteSize', size }),
  getKind: () => store.getState().palette.kind,
  setKind: (kind) => store.dispatch({ type: 'setPaletteKind', kind }),
  // 選んでいる歯車・ラックとかみ合える種類（S4-02。パレットの注記）
  getMeshable: () => {
    const { scene, selection } = store.getState();
    if (selection === null) return null;
    if (scene.racks[selection] !== undefined) {
      return { subject: 'rack', kinds: meshableKinds(scene, selection) };
    }
    if (scene.gears[selection] !== undefined) {
      return { subject: 'gear', kinds: meshableKinds(scene, selection) };
    }
    return null;
  },
  onRootDragStart: (x, y) => interactions.beginRootDrag(x, y),
  onRootDragMove: (x, y) => interactions.moveRootDrag(x, y),
  onRootDragEnd: (x, y) => interactions.endRootDrag(x, y),
  onRootDragCancel: () => interactions.cancelRootDrag(),
});
store.subscribe(() => palette.refresh());
// 一時停止中の表示（S1-22）。描画領域の上部中央
const pauseIndicator = createPauseIndicator(shell.canvasHost);
store.subscribe((state) => pauseIndicator.setPaused(state.sim.paused));
// 情報表示（S1-23）: 歯車ごとの rpm・ギア比のラベルと回転方向の矢印。ツールバーのボタンで
// 全歯車に出す（ON）・選択中の歯車だけ（OFF）を切り替える
const infoOverlay = createInfoOverlay({
  getState: () => store.getState(),
  layoutOf,
  getLanguage,
  labels: createInfoLabels(shell.canvasHost),
  setArrows: renderer.setInfoArrows,
  arrowSpec: infoArrowSpec,
  project: renderer.projectToCanvas,
});
const infoButton = shell.toolbar.button('info');
infoButton.disabled = false;
const applyInfoButton = (on: boolean): void => {
  infoButton.setAttribute('aria-pressed', String(on));
};
applyInfoButton(store.getState().view.infoOverlay);
infoButton.addEventListener('click', () => {
  store.dispatch({ type: 'setInfoOverlay', on: !store.getState().view.infoOverlay });
});
store.subscribe((state) => applyInfoButton(state.view.infoOverlay));
// プロパティパネル（S1-20）: 選択・シーン（Undo を含む）・言語が変わるたびに作り直す
const properties = createProperties({
  setContent: shell.properties.setContent,
  getState: () => store.getState(),
  getLayout: layoutOf,
  dispatch: (action) => store.dispatch(action),
});
store.subscribe(() => properties.refresh());
// 音（S1-25）。AudioContext は最初のユーザー操作（pointerdown・keydown）で作って resume する。
// 描画領域に限らずどこを操作しても始めるので、window で capture する。ミュート中でも作る（主音量 0）
// 音の材質はテーマに結び付ける（S1-30。真鍮 → 金属、木製 → 木）
const audio = createAudioEngine({
  muted: store.getState().settings.muted,
  material: THEME_AUDIO_MATERIAL[store.getState().settings.theme],
});
store.subscribe(({ settings }) => audio.setMaterial(THEME_AUDIO_MATERIAL[settings.theme]));
const startAudio = (): void => audio.start();
window.addEventListener('pointerdown', startAudio, { capture: true });
window.addEventListener('keydown', startAudio, { capture: true });
const muteButton = shell.toolbar.button('mute');
muteButton.disabled = false;
const applyMute = (muted: boolean): void => {
  muteButton.setAttribute('aria-pressed', String(muted));
  audio.setMuted(muted);
};
applyMute(store.getState().settings.muted);
const toggleMute = (): void => {
  store.dispatch({ type: 'updateSettings', patch: { muted: !store.getState().settings.muted } });
};
muteButton.addEventListener('click', toggleMute);
keyboard.bind({ key: 'm' }, { onDown: toggleMute });
store.subscribe((state) => applyMute(state.settings.muted));
// 自動保存（S1-27）: シーンの参照が変わってから AUTOSAVE_DEBOUNCE_MS 後に最後のシーンを書く。
// ページを離れる・隠れるときは待たずに書く（書き切れなくてもよい）
let lastAutosaveAt: number | null = null;
const autosaver = createAutosaver(async (scene) => {
  if (!storageAvailable) return;
  await db.saveAutosave(toSaveFile(scene));
  lastAutosaveAt = Date.now();
}, AUTOSAVE_DEBOUNCE_MS);
let autosavedScene = store.getState().scene;
store.subscribe(({ scene }) => {
  if (scene === autosavedScene) return;
  autosavedScene = scene;
  if (storageAvailable) autosaver.notify(scene);
});
window.addEventListener('pagehide', () => {
  void autosaver.flush();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void autosaver.flush();
});
// 作品の保存と一覧（S1-27）。サムネイルは選択の強調・候補・ハンドル・情報表示の矢印を隠して撮る
const works = createWorks({
  store,
  db,
  isAvailable: () => storageAvailable,
  captureThumbnail: () =>
    new Promise<Blob>((resolve, reject) => {
      syncDisplay();
      renderer
        .captureThumbnail(THUMBNAIL_SIZE)
        .toBlob(
          (blob) => (blob === null ? reject(new Error('サムネイルを作れない')) : resolve(blob)),
          'image/png',
        );
    }),
  openSaveDialog,
  openWorksDialog,
  showToast,
  t,
  getLanguage,
  newId: () => `work_${crypto.randomUUID()}`,
});
const saveButton = shell.toolbar.button('save');
saveButton.disabled = false;
saveButton.addEventListener('click', () => {
  void works.save();
});
const worksButton = shell.toolbar.button('works');
worksButton.disabled = false;
worksButton.addEventListener('click', () => {
  void works.openList();
});
// JSON のエクスポートとインポート（S1-28）。インポートは replaceScene で読み込み、全体表示する
const jsonIo = createJsonIo({
  store,
  download: downloadText,
  fitAll: () => cameraInput.fitAll(),
  showToast,
});
const exportButton = shell.toolbar.button('export');
exportButton.disabled = false;
exportButton.addEventListener('click', () => jsonIo.exportScene());
const importPicker = createFilePicker(document.body, '.json,application/json', (file) => {
  void jsonIo.importFile(file);
});
const importButton = shell.toolbar.button('import');
importButton.disabled = false;
importButton.addEventListener('click', () => importPicker.open());
// 設定画面（S1-30）。選ぶとすぐ updateSettings で反映する
const settingsDialog = createSettingsDialog({
  getSettings: () => store.getState().settings,
  update: (patch) => store.dispatch({ type: 'updateSettings', patch }),
  subscribe: (listener) => store.subscribe(listener),
});
const settingsButton = shell.toolbar.button('settings');
settingsButton.disabled = false;
settingsButton.addEventListener('click', () => settingsDialog.open());
// 右下の軸の目印（S1-14）。球をクリックすると、その軸の側から見る
const gizmo = createAxisGizmo(shell.gizmoSlot, (v) => cameraInput.setView(v));
// 右クリック（ドラッグなし）の要求でコンテキストメニューを開く（S1-29）。最後の要求はテスト用に覚えておく
let lastContextRequest: ContextRequest | null = null;
cameraInput.onContextRequest((request) => {
  lastContextRequest = request;
  contextMenu.openAt(request.x, request.y);
});
// 描く前にカメラを進める
const view = {
  ...renderer,
  render() {
    cameraInput.update();
    const active = cameraInput.activeCamera();
    active.updateMatrixWorld();
    gizmo.update(active);
    const { scene, selection } = store.getState();
    const hit =
      hoverPoint === null || interactions.isDragging()
        ? null
        : clickTargetAt(hoverPoint.x, hoverPoint.y, false);
    // 選んでいるシャフトの上なら、仮の歯車をポインターに合わせて動かす（S4-03）
    interactions.setHover(interactions.isDragging() ? null : hoverPoint, hit);
    // マウスを乗せた候補は濃く表示する（S1-18）
    interactions.setHoveredCandidate(hit?.kind === 'candidate' ? Number(hit.id) : null);
    interactions.beforeRender();
    renderer.setHighlight({ selected: selection, hovered: selectionForPick(hit, scene) });
    // ラベルの位置は今のカメラで毎フレーム、文字と矢印は 10 Hz で書き換える（S1-23）
    infoOverlay.frame(performance.now());
    renderer.render();
  },
};

let ready = false;
installGearSim({
  isReady: () => ready,
  getScene: () => store.getState().scene,
  getLayout: () => layoutOf(store.getState().scene),
  getMotion: () => store.getState().motion,
  getShaftWorldOrigin: (shaftId) => {
    const { scene, motion } = store.getState();
    return shaftWorldOrigin(layoutOf(scene), motion, shaftId);
  },
  loadScene: (scene) => store.dispatch({ type: 'loadScene', scene }),
  dispatch: (command) => store.dispatch({ type: 'command', command }),
  undo: () => store.dispatch({ type: 'undo' }),
  redo: () => store.dispatch({ type: 'redo' }),
  projectToScreen: (world) => view.projectToScreen(world),
  getLanguage,
  // 設定画面と同じ経路（settings.language を変え、購読で i18n の言語も変わる。S1-30）
  setLanguage: (language) => store.dispatch({ type: 'updateSettings', patch: { language } }),
  getSettings: () => store.getState().settings,
  getCamera: () => cameraInput.getPose(),
  setCamera: (pose) => cameraInput.setPose(pose, false),
  getLastContextRequest: () => lastContextRequest,
  getInputDevice: () => cameraInput.getInputDevice(),
  updateSettings: (patch) => store.dispatch({ type: 'updateSettings', patch }),
  setWatchMode: (on) => store.dispatch({ type: 'setWatchMode', on }),
  getView: () => {
    const { infoOverlay, watchMode } = store.getState().view;
    return { infoOverlay, watchMode };
  },
  getGizmoTargets: () => gizmo.targets(),
  getSelection: () => {
    const { selection } = store.getState();
    return selection === null ? [] : [selection];
  },
  pick: pickAt,
  select: (id) => store.dispatch({ type: 'select', id }),
  getHandles: () =>
    interactions
      .handles()
      .map((h) => ({ kind: h.kind, targetId: h.targetId, position: h.position })),
  getCandidates: () =>
    interactions.candidates().map((c, index) => ({ index, kind: c.kind, center: c.center })),
  getShaftGhost: () => {
    const g = interactions.shaftGhost();
    return g === null
      ? null
      : {
          shaftId: g.shaftId,
          kind: g.kind,
          size: g.size,
          offset: g.offset,
          center: g.spec.center,
          blocked: g.blocked,
        };
  },
  getHand: () => store.getState().sim.hand,
  isPaused: () => store.getState().sim.paused,
  getWarningParts: () => {
    const { scene, motion } = store.getState();
    const { locked, interfering } = warningParts(scene, layoutOf(scene), motion);
    return { locked: [...locked].sort(), interfering: [...interfering].sort() };
  },
  getRenderInfo: () => renderer.renderInfo(),
  getRenderStats: () => renderer.renderStats(),
  getInfoOverlay: () => ({
    enabled: store.getState().view.infoOverlay,
    arrows: infoOverlay.arrows(),
  }),
  getAudio: () => audio.state(),
  getStorageStatus: () => ({
    lastAutosaveAt,
    pendingAutosave: autosaver.pending(),
    currentWorkId: store.getState().currentWork?.id ?? null,
  }),
});

startLoop({
  store,
  view,
  layoutOf,
  displayScene: () => interactions.displayScene(),
  onFrame: (dt) => {
    // 音は運動を進めた後の状態で更新する（S1-25）。リスナーは今描いたカメラ（S1-26）
    const { scene, motion, sim } = store.getState();
    const layout = layoutOf(scene);
    const camera = cameraInput.activeCamera();
    camera.updateMatrixWorld();
    const forward = camera.getWorldDirection(new Vector3());
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    audio.update({
      voices: computeMeshVoices(scene, layout, motion),
      angles: motion.angles,
      dt,
      listener: {
        position: [camera.position.x, camera.position.y, camera.position.z],
        forward: [forward.x, forward.y, forward.z],
        up: [up.x, up.y, up.z],
      },
      motors: computeMotorHums(scene, motion, sim.paused, (motor) => {
        const placed = layout.shafts[motor.shaftId];
        return placed === undefined ? null : motorCenter(placed, motor.size);
      }),
      locks: motion.locks.map((info) => ({ info, position: lockPosition(layout, info) })),
    });
    ready = true;
  },
});
