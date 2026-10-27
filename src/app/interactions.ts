import { applyCommand, type Command } from '../core/edit/commands';
import { pitchRadius } from '../core/geometry/mesh';
import type { GrowCandidate } from '../core/layout/candidates';
import { newInterferences } from '../core/layout/interference-diff';
import { resolveLayout } from '../core/layout/resolve';
import type { Vec3 } from '../core/math/vec3';
import type { Axis, Scene } from '../core/scene/types';
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
import type { PickKind } from '../input/pick-priority';
import { intersectRayPlane, nextAxis, rootPlacementCommand } from '../input/placement';
import { exceedsDragThreshold } from '../input/pointer-route';
import type { CandidateSpec } from '../render/candidates';
import type { ReattachRing } from '../render/handles';
import type { PreviewStyle } from '../render/sync';
import { candidateSpec, candidatesFor, growCommand } from './grow';
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
  beginHandleDrag(e: PointerEvent, handleId: string): boolean;
  // ポインターの下の部品の本体（候補・ハンドルを除いたピッキング）が、選んでいる detached のシャフトの
  // 本体（シャフト・その上の歯車・モーター）か。そうなら左ボタンは付け直しのドラッグになる（S1-19）
  isReattachBody(body: { kind: PickKind; id: string } | null): boolean;
  // 部品の本体の上の 'app' の pointerdown。付け直しのドラッグを待ち始めたら true（S1-19。
  // DRAG_THRESHOLD_PX 以上動いたら始まり、それまでに離せばクリックのまま）
  pressBody(e: PointerEvent, body: { kind: PickKind; id: string } | null): boolean;
  // R キー
  rotate(): void;
  // Esc キー。ドラッグをやめたら true（選択は外さない）
  cancel(): boolean;
  // 何かをドラッグしている途中か
  isDragging(): boolean;
  // 今出している生やす候補（S1-18）。選択が歯車でない・ドラッグ中は []。
  // 選択・シーン・パレットの大きさが変わったときだけ列挙し直す（同じ間は同じ参照）
  candidates(): readonly GrowCandidate[];
  // マウスを乗せた候補の番号（濃く表示する）。無ければ null
  setHoveredCandidate(index: number | null): void;
  // 候補（番号）をクリックした: その歯車を生やして選ぶ。生やしたら true
  grow(index: number): boolean;
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

const NO_RINGS: readonly ReattachRing[] = [];

const ghostIds = (kind: 'shaft' | 'gear' | 'motor'): string =>
  kind === 'shaft' ? GHOST_SHAFT_ID : GHOST_GEAR_ID;

export function createInteractions(deps: InteractionsDeps): Interactions {
  const { store, canvas } = deps;
  let rootDrag: RootDrag | null = null;
  let handleDrag: HandleDrag | null = null;
  let reattachDrag: ReattachDrag | null = null;
  let style: PreviewStyle | null = null;
  let styleKey = '';
  let hoveredCandidate: number | null = null;
  const NO_CANDIDATES: { list: readonly GrowCandidate[]; specs: readonly CandidateSpec[] } = {
    list: [],
    specs: [],
  };
  let candidateMemo: {
    scene: Scene;
    selection: string | null;
    size: string;
    list: readonly GrowCandidate[];
    specs: readonly CandidateSpec[];
  } | null = null;

  // 選択中の歯車の候補と、その見た目。ドラッグ中（ハンドル・起点を置く）は出さない
  function currentCandidates(): {
    list: readonly GrowCandidate[];
    specs: readonly CandidateSpec[];
  } {
    if (rootDrag !== null || handleDrag !== null || reattachDrag?.active != null) {
      return NO_CANDIDATES;
    }
    const { scene, selection, palette } = store.getState();
    const memo = candidateMemo;
    if (
      memo !== null &&
      memo.scene === scene &&
      memo.selection === selection &&
      memo.size === palette.size
    ) {
      return memo;
    }
    const list = candidatesFor(scene, selection, palette.size);
    const specs = list.map((c) => candidateSpec(scene, c));
    candidateMemo = { scene, selection, size: palette.size, list, specs };
    return candidateMemo;
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

  const onPointerMove = (e: PointerEvent): void => {
    if (reattachDrag !== null && e.pointerId === reattachDrag.pointerId) {
      moveReattach(reattachDrag, { x: e.pageX, y: e.pageY });
      return;
    }
    if (handleDrag === null || e.pointerId !== handleDrag.pointerId) return;
    const ray = deps.rayAt(e.pageX, e.pageY);
    if (ray !== null) handleDrag.session.update(ray, dragInput(e));
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (reattachDrag !== null && e.pointerId === reattachDrag.pointerId) {
      moveReattach(reattachDrag, { x: e.pageX, y: e.pageY });
      endReattachDrag(true);
      return;
    }
    if (handleDrag === null || e.pointerId !== handleDrag.pointerId) return;
    const ray = deps.rayAt(e.pageX, e.pageY);
    if (ray !== null) handleDrag.session.update(ray, dragInput(e));
    endHandleDrag(true);
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (handleDrag !== null && e.pointerId === handleDrag.pointerId) endHandleDrag(false);
    if (reattachDrag !== null && e.pointerId === reattachDrag.pointerId) endReattachDrag(false);
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  // Undo などでドラッグ中にシーンが変わったら、ハンドルのドラッグはやめる（元のシーンが前提のため）。
  // 起点を置くドラッグは今のシーンで置き直す
  store.subscribe((state) => {
    if (handleDrag !== null && state.scene !== handleDrag.session.startScene) endHandleDrag(false);
    if (reattachDrag !== null && state.scene !== reattachDrag.startScene) endReattachDrag(false);
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
      const { specs } = currentCandidates();
      deps.setCandidates(
        specs,
        hoveredCandidate !== null && hoveredCandidate < specs.length ? hoveredCandidate : null,
      );
    },
    beginRootDrag(pageX, pageY) {
      endHandleDrag(false);
      endReattachDrag(false);
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
    beginHandleDrag(e, handleId) {
      if (rootDrag !== null || handleDrag !== null || reattachDrag !== null) return false;
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
      if (rootDrag !== null || handleDrag !== null || reattachDrag !== null) return false;
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
      // mesh のシャフトの向きは親から導くので、R では変えない
      if (placement === undefined || placement.kind === 'mesh') return;
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
      return false;
    },
    isDragging: () => rootDrag !== null || handleDrag !== null || reattachDrag?.active != null,
    candidates: () => currentCandidates().list,
    setHoveredCandidate(index) {
      hoveredCandidate = index;
    },
    grow(index) {
      const candidate = currentCandidates().list[index];
      if (candidate === undefined) return false;
      // 生やした歯車を選ぶ（外周は [シャフト, 歯車] の最後、同じ軸は [歯車]）。続けて次の候補が出る
      store.dispatch({ type: 'command', command: growCommand(candidate), selectCreated: true });
      return true;
    },
  };
}
