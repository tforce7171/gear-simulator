import { applyCommand, type Command } from '../core/edit/commands';
import { pitchRadius } from '../core/geometry/mesh';
import { type GrowCandidate, isPaletteGearKind } from '../core/layout/candidates';
import { newInterferences } from '../core/layout/interference-diff';
import { resolveLayout } from '../core/layout/resolve';
import { axisVector } from '../core/math/axis';
import type { Vec3 } from '../core/math/vec3';
import type { IdKind } from '../core/scene/ids';
import { type Axis, isFreePlacement, type Scene } from '../core/scene/types';
import { grabTarget, type HandRotateSession, startHandRotate } from '../input/hand-rotate';
import {
  type DragInput,
  type HandleDragSession,
  type HandleSpec,
  handleMovedParts,
  handlePickId,
  listHandles,
  movedParts,
  type Ray,
  selectedShaftId,
  startHandleDrag,
} from '../input/handle-drag';
import { closestParamOnLine } from '../input/handle-math';
import type { PickKind } from '../input/pick-priority';
import { intersectRayPlane, nextAxis, rootPlacementCommand } from '../input/placement';
import { exceedsDragThreshold } from '../input/pointer-route';
import type { CandidateSpec } from '../render/candidates';
import type { ReattachRing } from '../render/handles';
import type { PreviewStyle } from '../render/sync';
import {
  candidateSpec,
  candidatesFor,
  growCommand,
  type ShaftGhost,
  shaftGhostAt,
  shaftGhostOffset,
} from './grow';
import {
  applyReattach,
  type ReattachCandidate,
  reattachCandidates,
  reattachCommand,
} from './reattach';
import type { Store } from './store';

// 編集の操作（S1-17）: パレットから起点のシャフトを置くドラッグ、ハンドルのドラッグ、R での向きの切り替え。
// ドラッグ中は履歴に積まない仮のシーン（displayScene）を描かせ、離したら 1 つの編集コマンドで確定する。
// 生やす候補（S1-18）: 歯車を選んでいる間は候補を出し、クリックした候補で growGear を実行する。
// 付け直し（S1-19）: 選んでいる detached のシャフトの本体を左ドラッグして、別の歯車の外周の候補の上で離す
// 手で回す（S1-21）: それ以外の部品の本体の左ドラッグで、そのシャフトを手の角度に拘束する（AppState.sim.hand）
// シャフトの上に置く（S4-03）: シャフトを選んでいる間、そのシャフトにマウスを乗せると、パレットの種類・大きさの半透明の歯車が
// ポインターに合わせて軸に沿って動き（4 mm 刻み）、クリックでその位置に置く（重なる位置では赤く、置けない）

// 置く前の仮の部品の ID（シーンの ID と重ならない）
export const GHOST_SHAFT_ID = '__ghost_shaft';
export const GHOST_GEAR_ID = '__ghost_gear';

const FLOOR_POINT: Vec3 = [0, 0, 0];
const UP: Vec3 = [0, 1, 0];

// 付け直しのドラッグで、子の中心を画面に写した点からこの距離（px）以内の候補を強調する（UI だけで使う）
export const REATTACH_PICK_PX = 24;

export interface InteractionsDeps {
  readonly store: Store;
  readonly canvas: HTMLCanvasElement;
  readonly rayAt: (pageX: number, pageY: number) => Ray | null;
  // ページ座標の点が描画領域（canvas）の上か。パネルの上なら false
  readonly isOverViewport: (pageX: number, pageY: number) => boolean;
  readonly setPreviewStyle: (style: PreviewStyle | null) => void;
  readonly setHandles: (handles: readonly HandleSpec[], activeId: string | null) => void;
  // 生やす候補の表示（S1-18。Renderer.setCandidates）
  readonly setCandidates: (candidates: readonly CandidateSpec[], hovered: number | null) => void;
  // 付け直しの候補の輪（S1-19。Renderer.setReattachRings）
  readonly setReattachRings: (rings: readonly ReattachRing[], highlighted: number | null) => void;
  // ワールド座標の点のページ座標（S1-19。付け直しの候補の判定と、円弧の代用の角度）
  readonly projectToScreen: (world: Vec3) => { x: number; y: number };
}

export interface Interactions {
  // 描くシーン（ドラッグ中は仮のシーン、それ以外はストアのシーン）
  displayScene(): Scene;
  // 今出しているハンドル（displayScene と選択から）
  handles(): HandleSpec[];
  // 描く前に毎フレーム呼ぶ: ハンドルと仮の部品の見た目を描画に渡す
  beforeRender(): void;
  // パレットの起点のシャフトの項目のドラッグ
  beginRootDrag(pageX: number, pageY: number): void;
  moveRootDrag(pageX: number, pageY: number): void;
  endRootDrag(pageX: number, pageY: number): void;
  cancelRootDrag(): void;
  // ハンドル（ピッキングの ID）の上の 'app' の pointerdown。ドラッグを始めたら true
  // deferred が真なら、DRAG_THRESHOLD_PX 以上動くまでハンドルを動かさず、それまでに離せば何もしない（クリックのまま。
  // S4-02: ハンドルの陰に候補があるとき、クリックは候補に渡す）
  beginHandleDrag(e: PointerEvent, handleId: string, deferred?: boolean): boolean;
  // ポインターの下の部品の本体（候補・ハンドルを除いたピッキング）が、選んでいる detached のシャフトの
  // 本体（シャフト・その上の歯車・モーター）か。そうなら左ボタンは付け直しのドラッグになる（S1-19）
  isReattachBody(body: { kind: PickKind; id: string } | null): boolean;
  // 部品の本体の上の 'app' の pointerdown。付け直しのドラッグを待ち始めたら true（S1-19。
  // DRAG_THRESHOLD_PX 以上動いたら始まり、それまでに離せばクリックのまま）
  pressBody(e: PointerEvent, body: { kind: PickKind; id: string } | null): boolean;
  // 部品の本体の上の 'app' の pointerdown で、pressBody が false だったとき。手で回すのを待ち始めたら true
  // （S1-21。DRAG_THRESHOLD_PX 以上動いたら回し始め、それまでに離せばクリックのまま）
  pressHand(e: PointerEvent, body: { kind: PickKind; id: string; point: Vec3 } | null): boolean;
  // R キー
  rotate(): void;
  // Esc キー。ドラッグをやめたら true（選択は外さない）。手で回している最中なら回すのを終える
  cancel(): boolean;
  // 何かをドラッグしている途中か
  isDragging(): boolean;
  // 今出している生やす候補（S1-18）。選択が歯車でない・ドラッグ中・手で回している間は []。
  // 選択・シーン・パレットの大きさが変わったときだけ列挙し直す（同じ間は同じ参照）
  candidates(): readonly GrowCandidate[];
  // マウスを乗せた候補の番号（濃く表示する）。無ければ null
  setHoveredCandidate(index: number | null): void;
  // 候補（番号）をクリックした: その歯車を生やして選ぶ。生やしたら true。
  // シャフトの上の仮の歯車（S4-03。候補の一覧の最後の番号）なら、その位置に置く（シャフトの選択は保つ）
  grow(index: number): boolean;
  // マウスを乗せた位置（ページ座標）と、そこで当たった部品（S4-03）。選んでいるシャフトの上なら、仮の歯車を動かす。
  // 描く前に毎フレーム呼ぶ
  setHover(
    point: { x: number; y: number } | null,
    hit: { kind: PickKind; id: string } | null,
  ): void;
  // 部品の上のクリック（S4-03）。当たったのが選んでいるシャフト（か、その上の仮の歯車）で、パレットが歯車の種類なら、
  // その位置に歯車を置いて 'placed'（重なる位置なら何もせず 'blocked'）。それ以外は null
  placeOnShaft(
    point: { x: number; y: number },
    hit: { kind: PickKind; id: string } | null,
  ): 'placed' | 'blocked' | null;
  // 今出している、シャフトの上の仮の歯車（S4-03）。無ければ null
  shaftGhost(): ShaftGhost | null;
}

interface RootDrag {
  axis: Axis;
  last: { x: number; y: number } | null;
  preview: { scene: Scene; command: Command; invalid: boolean } | null;
}

interface HandleDrag {
  pointerId: number;
  session: HandleDragSession;
  moved: ReadonlySet<string>;
  // 押した位置（deferred のとき）。DRAG_THRESHOLD_PX 以上動くまでは null にしない（S4-02）
  pending: { x: number; y: number } | null;
}

interface ReattachDrag {
  pointerId: number;
  down: { x: number; y: number };
  shaftId: string;
  startScene: Scene;
  // DRAG_THRESHOLD_PX 以上動いてから埋める
  active: {
    candidates: readonly ReattachCandidate[];
    rings: readonly ReattachRing[];
    moved: ReadonlySet<string>;
    hovered: number | null;
    preview: Scene | null;
  } | null;
}

interface HandDrag {
  pointerId: number;
  down: { x: number; y: number };
  startScene: Scene;
  session: HandRotateSession;
  // DRAG_THRESHOLD_PX 以上動いたら true（回し始める）
  active: boolean;
}

// 手で回している間のカーソル
const GRABBING_CURSOR = 'grabbing';

const NO_RINGS: readonly ReattachRing[] = [];

const ghostIds = (kind: IdKind): string => (kind === 'shaft' ? GHOST_SHAFT_ID : GHOST_GEAR_ID);

export function createInteractions(deps: InteractionsDeps): Interactions {
  const { store, canvas } = deps;
  let rootDrag: RootDrag | null = null;
  let handleDrag: HandleDrag | null = null;
  let reattachDrag: ReattachDrag | null = null;
  let handDrag: HandDrag | null = null;
  let style: PreviewStyle | null = null;
  let styleKey = '';
  let hoveredCandidate: number | null = null;
  // シャフトの上の仮の歯車（S4-03）。key は作り直すかの判定（シーン・シャフト・offset・パレット）
  let ghost: { key: string; scene: Scene; value: ShaftGhost } | null = null;
  let specsMemo: {
    base: readonly CandidateSpec[];
    ghost: ShaftGhost | null;
    specs: readonly CandidateSpec[];
  } | null = null;
  const NO_CANDIDATES: { list: readonly GrowCandidate[]; specs: readonly CandidateSpec[] } = {
    list: [],
    specs: [],
  };
  let candidateMemo: {
    scene: Scene;
    selection: string | null;
    size: string;
    kind: string; // パレットの種類（S2-05）
    list: readonly GrowCandidate[];
    specs: readonly CandidateSpec[];
  } | null = null;

  // 選択中の歯車の候補と、その見た目。ドラッグ中（ハンドル・起点を置く）は出さない
  function currentCandidates(): {
    list: readonly GrowCandidate[];
    specs: readonly CandidateSpec[];
  } {
    if (
      rootDrag !== null ||
      (handleDrag !== null && handleDrag.pending === null) ||
      reattachDrag?.active != null ||
      handDrag?.active === true
    ) {
      return NO_CANDIDATES;
    }
    const { scene, selection, palette } = store.getState();
    const memo = candidateMemo;
    if (
      memo !== null &&
      memo.scene === scene &&
      memo.selection === selection &&
      memo.size === palette.size &&
      memo.kind === palette.kind
    ) {
      return memo;
    }
    // 同じ軸に作る歯車の種類はパレットで選んだもの（S2-05）
    const list = candidatesFor(scene, selection, palette.kind);
    const specs = list.map((c) => candidateSpec(scene, c));
    candidateMemo = { scene, selection, size: palette.size, kind: palette.kind, list, specs };
    return candidateMemo;
  }

  // 仮の歯車を出せる状態か（ドラッグ中でない）。出せるなら選んでいるシャフトの ID
  function ghostShaft(): string | null {
    if (
      rootDrag !== null ||
      (handleDrag !== null && handleDrag.pending === null) ||
      reattachDrag?.active != null ||
      handDrag?.active === true
    ) {
      return null;
    }
    const { scene, selection, palette } = store.getState();
    if (selection === null || scene.shafts[selection] === undefined) return null;
    return isPaletteGearKind(palette.kind) ? selection : null;
  }

  // ページ座標の点の、選んでいるシャフトの上の仮の歯車。作り直さなくてよければ前のものを返す
  function ghostAt(shaftId: string, point: { x: number; y: number }): ShaftGhost | null {
    const { scene, palette } = store.getState();
    if (!isPaletteGearKind(palette.kind)) return null;
    const placed = resolveLayout(scene).shafts[shaftId];
    const ray = deps.rayAt(point.x, point.y);
    if (placed === undefined || ray === null) return null;
    const along = closestParamOnLine(
      ray.origin,
      ray.direction,
      placed.origin,
      axisVector(placed.axis),
    );
    if (along === null) return null;
    const offset = shaftGhostOffset(placed.span, along, palette.kind, palette.size);
    const key = `${shaftId}|${offset}|${palette.kind}|${palette.size}`;
    if (ghost !== null && ghost.scene === scene && ghost.key === key) return ghost.value;
    const value = shaftGhostAt(scene, shaftId, along, palette.size, palette.kind);
    ghost = value === null ? null : { key, scene, value };
    return value;
  }

  // 今の仮の歯車（シーン・選択が変わっていれば出さない）
  function currentGhost(): ShaftGhost | null {
    if (ghost === null) return null;
    const shaftId = ghostShaft();
    if (shaftId !== ghost.value.shaftId || ghost.scene !== store.getState().scene) return null;
    const { palette } = store.getState();
    if (palette.kind !== ghost.value.kind || palette.size !== ghost.value.size) return null;
    return ghost.value;
  }

  // 生やす候補の見た目に、シャフトの上の仮の歯車（S4-03）を最後に足したもの（同じ間は同じ参照）
  function displaySpecs(): readonly CandidateSpec[] {
    const base = currentCandidates().specs;
    const g = currentGhost();
    if (specsMemo !== null && specsMemo.base === base && specsMemo.ghost === g) {
      return specsMemo.specs;
    }
    const specs = g === null ? base : [...base, g.spec];
    specsMemo = { base, ghost: g, specs };
    return specs;
  }

  function placeGhost(g: ShaftGhost): void {
    if (g.blocked) return;
    // シャフトの選択は保つ（続けて同じシャフトに置ける）
    store.dispatch({ type: 'command', command: g.command });
    ghost = null;
  }

  // 置く位置の仮のシーン。描画領域の外や床に当たらない所なら null
  function computeRootPreview(drag: RootDrag): RootDrag['preview'] {
    const point = drag.last;
    if (point === null || !deps.isOverViewport(point.x, point.y)) return null;
    const ray = deps.rayAt(point.x, point.y);
    if (ray === null) return null;
    const hit = intersectRayPlane(ray.origin, ray.direction, FLOOR_POINT, UP);
    if (hit === null) return null;
    const { scene, palette } = store.getState();
    const command = rootPlacementCommand(hit, drag.axis, palette.size);
    const result = applyCommand(scene, command, { ids: ghostIds });
    if (!result.ok) return null;
    const invalid = newInterferences(resolveLayout(scene), resolveLayout(result.scene)).length > 0;
    return { scene: result.scene, command, invalid };
  }

  function updateRoot(point: { x: number; y: number } | null): void {
    if (rootDrag === null) return;
    if (point !== null) rootDrag.last = point;
    rootDrag.preview = computeRootPreview(rootDrag);
  }

  function endHandleDrag(commit: boolean): void {
    const drag = handleDrag;
    if (drag === null) return;
    handleDrag = null;
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    if (!commit) return;
    const command = drag.session.finish();
    if (command !== null) store.dispatch({ type: 'command', command });
  }

  function dragInput(e: PointerEvent): DragInput {
    return {
      shift: e.shiftKey,
      screen: { pointer: { x: e.pageX, y: e.pageY }, project: deps.projectToScreen },
    };
  }

  function endReattachDrag(commit: boolean): void {
    const drag = reattachDrag;
    if (drag === null) return;
    reattachDrag = null;
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    const active = drag.active;
    if (!commit || active === null || active.hovered === null) return;
    const candidate = active.candidates[active.hovered];
    if (candidate === undefined) return;
    store.dispatch({ type: 'command', command: reattachCommand(drag.shaftId, candidate) });
  }

  // 付け直しのドラッグ: しきい値を超えたら候補を列挙し、ポインターに最も近い候補を強調して仮のシーンにする
  function moveReattach(drag: ReattachDrag, point: { x: number; y: number }): void {
    if (drag.active === null) {
      if (!exceedsDragThreshold(drag.down, point)) return;
      const scene = drag.startScene;
      const candidates = reattachCandidates(scene, resolveLayout(scene), drag.shaftId);
      const rings = candidates.map((c): ReattachRing => {
        const gear = scene.gears[c.childGearId];
        const parent = resolveLayout(scene).gears[c.parentGearId];
        return {
          center: c.childCenter,
          axis: parent?.axis ?? 'y',
          radius: gear === undefined ? 10 : pitchRadius(gear.size, gear.teeth),
        };
      });
      drag.active = {
        candidates,
        rings,
        moved: movedParts(scene, drag.shaftId),
        hovered: null,
        preview: null,
      };
    }
    const active = drag.active;
    let hovered: number | null = null;
    let best = REATTACH_PICK_PX;
    active.candidates.forEach((c, i) => {
      const p = deps.projectToScreen(c.childCenter);
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d <= best) {
        best = d;
        hovered = i;
      }
    });
    if (hovered === active.hovered) return;
    active.hovered = hovered;
    const candidate = hovered === null ? undefined : active.candidates[hovered];
    active.preview =
      candidate === undefined ? null : applyReattach(drag.startScene, drag.shaftId, candidate);
  }

  function endHandDrag(): void {
    const drag = handDrag;
    if (drag === null) return;
    handDrag = null;
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    if (drag.active) canvas.style.cursor = '';
    // 角度はそのまま。次のフレームからつり合いの速度で回る
    store.setHand(null);
  }

  // 手で回す: しきい値を超えたら回し始め、目標の角度（押した位置が基準）をストアに入れる
  function moveHand(drag: HandDrag, e: PointerEvent): void {
    const point = { x: e.pageX, y: e.pageY };
    if (!drag.active) {
      if (!exceedsDragThreshold(drag.down, point)) return;
      drag.active = true;
      canvas.style.cursor = GRABBING_CURSOR;
    }
    const ray = deps.rayAt(point.x, point.y);
    if (ray !== null) drag.session.update(ray, dragInput(e));
    store.setHand({ shaftId: drag.session.shaftId, angle: drag.session.target() });
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (handDrag !== null && e.pointerId === handDrag.pointerId) {
      moveHand(handDrag, e);
      return;
    }
    if (reattachDrag !== null && e.pointerId === reattachDrag.pointerId) {
      moveReattach(reattachDrag, { x: e.pageX, y: e.pageY });
      return;
    }
    if (handleDrag === null || e.pointerId !== handleDrag.pointerId) return;
    if (handleDrag.pending !== null) {
      if (!exceedsDragThreshold(handleDrag.pending, { x: e.pageX, y: e.pageY })) return;
      handleDrag.pending = null;
    }
    const ray = deps.rayAt(e.pageX, e.pageY);
    if (ray !== null) handleDrag.session.update(ray, dragInput(e));
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (handDrag !== null && e.pointerId === handDrag.pointerId) {
      if (handDrag.active) moveHand(handDrag, e);
      endHandDrag();
      return;
    }
    if (reattachDrag !== null && e.pointerId === reattachDrag.pointerId) {
      moveReattach(reattachDrag, { x: e.pageX, y: e.pageY });
      endReattachDrag(true);
      return;
    }
    if (handleDrag === null || e.pointerId !== handleDrag.pointerId) return;
    // 動かさずに離した deferred のドラッグは、何も確定しない（クリックは候補が受ける。S4-02）
    if (handleDrag.pending !== null) {
      endHandleDrag(false);
      return;
    }
    const ray = deps.rayAt(e.pageX, e.pageY);
    if (ray !== null) handleDrag.session.update(ray, dragInput(e));
    endHandleDrag(true);
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (handleDrag !== null && e.pointerId === handleDrag.pointerId) endHandleDrag(false);
    if (reattachDrag !== null && e.pointerId === reattachDrag.pointerId) endReattachDrag(false);
    if (handDrag !== null && e.pointerId === handDrag.pointerId) endHandDrag();
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  // Undo などでドラッグ中にシーンが変わったら、ハンドルのドラッグはやめる（元のシーンが前提のため）。
  // 起点を置くドラッグは今のシーンで置き直す
  store.subscribe((state) => {
    if (handleDrag !== null && state.scene !== handleDrag.session.startScene) endHandleDrag(false);
    if (reattachDrag !== null && state.scene !== reattachDrag.startScene) endReattachDrag(false);
    // 手で回している間にシーンが変わったら（Undo・読み込みなど）、回すのを終える
    if (handDrag !== null && state.scene !== handDrag.startScene) endHandDrag();
    if (rootDrag !== null) updateRoot(null);
  });

  // 本体（kind・id）が、選んでいる detached のシャフトの本体なら、そのシャフト
  function reattachShaftFor(body: { kind: PickKind; id: string } | null): string | null {
    if (body === null) return null;
    const { scene, selection } = store.getState();
    const shaftId = selectedShaftId(scene, selection);
    if (shaftId === null || scene.shafts[shaftId]?.placement.kind !== 'detached') return null;
    const bodyShaft =
      body.kind === 'shaft'
        ? body.id
        : body.kind === 'gear'
          ? scene.gears[body.id]?.shaftId
          : body.kind === 'motor'
            ? scene.motors[body.id]?.shaftId
            : undefined;
    return bodyShaft === shaftId ? shaftId : null;
  }

  function displayScene(): Scene {
    if (rootDrag?.preview != null) return rootDrag.preview.scene;
    if (handleDrag !== null) return handleDrag.session.state().scene;
    if (reattachDrag?.active?.preview != null) return reattachDrag.active.preview;
    return store.getState().scene;
  }

  function handles(): HandleSpec[] {
    // 手で回している間はハンドルを隠す（S1-21）
    if (handDrag?.active === true) return [];
    const scene = displayScene();
    return listHandles(scene, resolveLayout(scene), store.getState().selection);
  }

  // 同じ見た目のあいだは同じ参照を渡す（描画側は参照が変わったときだけ材質を選び直す）
  function currentStyle(): PreviewStyle | null {
    let next: { ids: ReadonlySet<string>; ghost: boolean; invalid: boolean } | null = null;
    if (rootDrag?.preview != null) {
      next = {
        ids: new Set([GHOST_SHAFT_ID, GHOST_GEAR_ID]),
        ghost: true,
        invalid: rootDrag.preview.invalid,
      };
    } else if (handleDrag?.session.state().invalid === true) {
      next = { ids: handleDrag.moved, ghost: false, invalid: true };
    } else if (reattachDrag?.active?.preview != null) {
      // 付け直した仮のシーン（その先も含む）を半透明で見せる
      next = { ids: reattachDrag.active.moved, ghost: true, invalid: false };
    }
    const key =
      next === null ? '' : `${next.ghost}|${next.invalid}|${[...next.ids].sort().join(',')}`;
    if (key !== styleKey) {
      styleKey = key;
      style = next;
    }
    return style;
  }

  return {
    displayScene,
    handles,
    beforeRender() {
      const active = handleDrag === null ? null : handlePickId(handleDrag.session.handle);
      deps.setHandles(handles(), active);
      deps.setPreviewStyle(currentStyle());
      const reattaching = reattachDrag?.active ?? null;
      deps.setReattachRings(reattaching?.rings ?? NO_RINGS, reattaching?.hovered ?? null);
      const specs = displaySpecs();
      deps.setCandidates(
        specs,
        hoveredCandidate !== null && hoveredCandidate < specs.length ? hoveredCandidate : null,
      );
    },
    beginRootDrag(pageX, pageY) {
      endHandleDrag(false);
      endReattachDrag(false);
      endHandDrag();
      rootDrag = { axis: 'y', last: null, preview: null };
      updateRoot({ x: pageX, y: pageY });
    },
    moveRootDrag(pageX, pageY) {
      updateRoot({ x: pageX, y: pageY });
    },
    endRootDrag(pageX, pageY) {
      if (rootDrag === null) return;
      updateRoot({ x: pageX, y: pageY });
      const preview = rootDrag.preview;
      rootDrag = null;
      // 描画領域の外・床に当たらない所・新たな干渉を生む位置では置かない
      if (preview === null || preview.invalid) return;
      store.dispatch({ type: 'command', command: preview.command, selectCreated: true });
    },
    cancelRootDrag() {
      rootDrag = null;
    },
    beginHandleDrag(e, handleId, deferred = false) {
      if (rootDrag !== null || handleDrag !== null || reattachDrag !== null || handDrag !== null) {
        return false;
      }
      const handle = handles().find((h) => handlePickId(h) === handleId);
      const ray = deps.rayAt(e.pageX, e.pageY);
      if (handle === undefined || ray === null) return false;
      const { scene } = store.getState();
      const session = startHandleDrag(scene, handle, ray, dragInput(e));
      if (session === null) return false;
      handleDrag = {
        pointerId: e.pointerId,
        session,
        moved: handleMovedParts(scene, handle),
        pending: deferred ? { x: e.pageX, y: e.pageY } : null,
      };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 捕捉できなくても、キャンバスの上でのドラッグは動く
      }
      return true;
    },
    isReattachBody: (body) => reattachShaftFor(body) !== null,
    pressBody(e, body) {
      if (rootDrag !== null || handleDrag !== null || reattachDrag !== null || handDrag !== null) {
        return false;
      }
      const shaftId = reattachShaftFor(body);
      if (shaftId === null) return false;
      reattachDrag = {
        pointerId: e.pointerId,
        down: { x: e.pageX, y: e.pageY },
        shaftId,
        startScene: store.getState().scene,
        active: null,
      };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 捕捉できなくても、キャンバスの上でのドラッグは動く
      }
      return true;
    },
    pressHand(e, body) {
      if (rootDrag !== null || handleDrag !== null || reattachDrag !== null || handDrag !== null) {
        return false;
      }
      if (body === null) return false;
      const { scene, motion } = store.getState();
      const target = grabTarget(scene, resolveLayout(scene), body);
      const ray = deps.rayAt(e.pageX, e.pageY);
      if (target === null || ray === null) return false;
      handDrag = {
        pointerId: e.pointerId,
        down: { x: e.pageX, y: e.pageY },
        startScene: scene,
        // 回す基準は押した位置と、押したときのシャフトの角度
        session: startHandRotate({
          ...target,
          // ラック（S3-04）は押したときの変位 s
          startAngle:
            (target.linear === true
              ? motion.rackPositions[target.shaftId]
              : motion.angles[target.shaftId]) ?? 0,
          startRay: ray,
          startInput: dragInput(e),
        }),
        active: false,
      };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 捕捉できなくても、キャンバスの上でのドラッグは動く
      }
      return true;
    },
    rotate() {
      if (rootDrag !== null) {
        rootDrag.axis = nextAxis(rootDrag.axis);
        updateRoot(null);
        return;
      }
      if (handleDrag !== null) return;
      const { scene, selection } = store.getState();
      const shaftId = selectedShaftId(scene, selection);
      if (shaftId === null) return;
      const placement = scene.shafts[shaftId]?.placement;
      // mesh・bevel のシャフトの向きは親から導くので、R では変えない
      if (placement === undefined || !isFreePlacement(placement)) return;
      store.dispatch({
        type: 'command',
        command: { type: 'setShaftAxis', shaftId, axis: nextAxis(placement.axis) },
      });
    },
    cancel() {
      if (rootDrag !== null) {
        rootDrag = null;
        return true;
      }
      if (handleDrag !== null) {
        endHandleDrag(false);
        return true;
      }
      if (reattachDrag !== null) {
        endReattachDrag(false);
        return true;
      }
      if (handDrag !== null) {
        // 回している最中なら回すのを終えるだけ（選択は外さない）。押しただけならそのまま Esc の扱い
        const active = handDrag.active;
        endHandDrag();
        return active;
      }
      return false;
    },
    isDragging: () => rootDrag !== null || handleDrag !== null || reattachDrag?.active != null,
    candidates: () => currentCandidates().list,
    setHoveredCandidate(index) {
      hoveredCandidate = index;
    },
    grow(index) {
      const list = currentCandidates().list;
      const g = currentGhost();
      if (g !== null && index === list.length) {
        placeGhost(g);
        return !g.blocked;
      }
      const candidate = list[index];
      if (candidate === undefined) return false;
      // 生やした歯車を選ぶ（外周は [シャフト, 歯車] の最後、同じ軸は [歯車]）。続けて次の候補が出る
      store.dispatch({ type: 'command', command: growCommand(candidate), selectCreated: true });
      return true;
    },
    setHover(point, hit) {
      const shaftId = ghostShaft();
      if (shaftId === null || point === null || hit === null) {
        ghost = null;
        return;
      }
      const onGhost =
        hit.kind === 'candidate' &&
        ghost !== null &&
        Number(hit.id) === currentCandidates().list.length;
      if (!(hit.kind === 'shaft' && hit.id === shaftId) && !onGhost) {
        ghost = null;
        return;
      }
      ghostAt(shaftId, point);
    },
    placeOnShaft(point, hit) {
      const shaftId = ghostShaft();
      if (shaftId === null || hit === null) return null;
      const onGhost =
        hit.kind === 'candidate' && Number(hit.id) === currentCandidates().list.length;
      if (!(hit.kind === 'shaft' && hit.id === shaftId) && !onGhost) return null;
      const g = ghostAt(shaftId, point);
      if (g === null) return null;
      placeGhost(g);
      return g.blocked ? 'blocked' : 'placed';
    },
    shaftGhost: currentGhost,
  };
}
