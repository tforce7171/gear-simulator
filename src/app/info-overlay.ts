// 情報表示の組み立て（S1-23、要件 §7.3）。出す歯車を決め、値（rpm・ギア比・向き）を 10 Hz で求めて
// ラベルと矢印に渡す。ラベルの位置は毎フレーム更新する
import type { Lang } from '../core/i18n';
import { computeGearInfo, type GearInfo, visibleInfoGearIds } from '../core/kinematics/info';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import type { GearId, Scene } from '../core/scene/types';
import type { InfoArrowSpec } from '../render/info-arrows';
import type { InfoLabelValues } from '../ui/info-labels';
import type { AppState } from './store';

// ラベルの文字と矢印を書き換える間隔（ms）。毎フレーム書き換えると読みにくい
export const INFO_REFRESH_MS = 100;

export interface InfoOverlayDeps {
  readonly getState: () => AppState;
  readonly layoutOf: (scene: Scene) => Layout;
  readonly getLanguage: () => Lang;
  readonly labels: {
    setValues(values: ReadonlyMap<GearId, InfoLabelValues>): void;
    setPosition(gearId: GearId, x: number, y: number, visible: boolean): void;
  };
  readonly setArrows: (arrows: readonly InfoArrowSpec[]) => void;
  // 歯車と配置から矢印の置き方を決める（render/info-arrows.ts の infoArrowSpec）
  readonly arrowSpec: (
    gear: Scene['gears'][string],
    layout: Layout['gears'][string],
    direction: 1 | -1,
  ) => InfoArrowSpec;
  // ワールド座標の点の、ラベルの層の左上からの位置。カメラの後ろ・画面外なら visible: false
  readonly project: (world: Vec3) => { x: number; y: number; visible: boolean };
}

export interface InfoOverlay {
  // 描く前に毎フレーム呼ぶ。nowMs は単調に増える時刻（ms）
  frame(nowMs: number): void;
  // 今出している矢印（gearId の昇順。止まっている歯車は含まない）
  arrows(): Array<{ gearId: GearId; direction: 1 | -1 }>;
}

// 値を求め直す前提が変わったか（変われば 10 Hz を待たずに求め直す）
interface Inputs {
  readonly scene: Scene;
  readonly selection: string | null;
  readonly infoOverlay: boolean;
  readonly paused: boolean;
  readonly lang: Lang;
}

function sameInputs(a: Inputs | null, b: Inputs): boolean {
  return (
    a !== null &&
    a.scene === b.scene &&
    a.selection === b.selection &&
    a.infoOverlay === b.infoOverlay &&
    a.paused === b.paused &&
    a.lang === b.lang
  );
}

// 値を書き換えるか: 前提が変わった、または前の書き換えから INFO_REFRESH_MS 以上たった
export function shouldRefresh(
  prev: Inputs | null,
  next: Inputs,
  lastMs: number | null,
  nowMs: number,
): boolean {
  if (!sameInputs(prev, next)) return true;
  return lastMs === null || nowMs - lastMs >= INFO_REFRESH_MS;
}

export function createInfoOverlay(deps: InfoOverlayDeps): InfoOverlay {
  let lastInputs: Inputs | null = null;
  let lastMs: number | null = null;
  let shown: GearId[] = [];
  let arrows: Array<{ gearId: GearId; direction: 1 | -1 }> = [];

  function refresh(state: AppState, layout: Layout): void {
    const ids = visibleInfoGearIds(state.scene, state.selection, state.view.infoOverlay);
    const info: Record<GearId, GearInfo> =
      ids.length === 0 ? {} : computeGearInfo(state.scene, layout, state.motion);
    const values = new Map<GearId, InfoLabelValues>();
    const specs: InfoArrowSpec[] = [];
    const nextArrows: Array<{ gearId: GearId; direction: 1 | -1 }> = [];
    for (const id of ids) {
      const item = info[id];
      const gear = state.scene.gears[id];
      const gearLayout = layout.gears[id];
      if (item === undefined || gear === undefined || gearLayout === undefined) continue;
      values.set(id, { rpm: item.rpm, ratio: item.ratio, wormRatio: item.wormRatio });
      if (item.direction === 0) continue;
      specs.push(deps.arrowSpec(gear, gearLayout, item.direction));
      nextArrows.push({ gearId: id, direction: item.direction });
    }
    shown = [...values.keys()];
    arrows = nextArrows;
    deps.labels.setValues(values);
    deps.setArrows(specs);
  }

  return {
    frame(nowMs) {
      const state = deps.getState();
      const layout = deps.layoutOf(state.scene);
      const inputs: Inputs = {
        scene: state.scene,
        selection: state.selection,
        infoOverlay: state.view.infoOverlay,
        paused: state.sim.paused,
        lang: deps.getLanguage(),
      };
      if (shouldRefresh(lastInputs, inputs, lastMs, nowMs)) {
        refresh(state, layout);
        lastInputs = inputs;
        lastMs = nowMs;
      }
      for (const id of shown) {
        const center = layout.gears[id]?.center;
        if (center === undefined) continue;
        const p = deps.project(center);
        deps.labels.setPosition(id, p.x, p.y, p.visible);
      }
    },
    arrows: () => arrows.map((a) => ({ ...a })),
  };
}
