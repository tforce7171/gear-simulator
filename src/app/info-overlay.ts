// 情報表示の組み立て（S1-23、要件 §7.3）。出す歯車を決め、値（rpm・ギア比・向き）を 10 Hz で求めて
// ラベルと矢印に渡す。ラベルの位置は毎フレーム更新する
import type { Lang } from '../core/i18n';
import {
  computeCarrierInfo,
  computeGearInfo,
  computeRackInfo,
  type GearInfo,
  visibleInfoGearIds,
  visibleInfoPartIds,
} from '../core/kinematics/info';
import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import { gearWorldCenter, rackWorldOrigin } from '../core/layout/world';
import { axisVector } from '../core/math/axis';
import { add, scale, type Vec3 } from '../core/math/vec3';
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
  // キーは部品の ID（歯車・キャリア・ラック。S3-05）
  readonly labels: {
    setValues(values: ReadonlyMap<string, InfoLabelValues>): void;
    setPosition(id: string, x: number, y: number, visible: boolean): void;
    setArrowAngle(id: string, angle: number | null): void;
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

// ラックの矢印の向きを求めるときに、ラックの位置から動く向きへ進める長さ（mm）
const RACK_ARROW_PROBE = 20;

// ラベルの位置（ワールド座標）。歯車は公転した中心、キャリアは板の中心、ラックは今の基準位置（S3-05）
function labelAnchor(
  layout: Layout,
  motion: MotionState,
  part: { kind: 'gear' | 'carrier' | 'rack'; id: string },
): Vec3 | null {
  switch (part.kind) {
    case 'gear':
      return layout.gears[part.id] === undefined ? null : gearWorldCenter(layout, motion, part.id);
    case 'carrier':
      return layout.carriers[part.id]?.center ?? null;
    case 'rack':
      return layout.racks[part.id] === undefined ? null : rackWorldOrigin(layout, motion, part.id);
  }
}

export function createInfoOverlay(deps: InfoOverlayDeps): InfoOverlay {
  let lastInputs: Inputs | null = null;
  let lastMs: number | null = null;
  let shown: Array<{ kind: 'gear' | 'carrier' | 'rack'; id: string }> = [];
  // ラックの動く向き（direction の軸の正・負。S3-05）
  let rackDirections = new Map<string, 1 | -1 | 0>();
  let arrows: Array<{ gearId: GearId; direction: 1 | -1 }> = [];

  function refresh(state: AppState, layout: Layout): void {
    const ids = visibleInfoGearIds(state.scene, state.selection, state.view.infoOverlay);
    const info: Record<GearId, GearInfo> =
      ids.length === 0 ? {} : computeGearInfo(state.scene, layout, state.motion);
    const values = new Map<string, InfoLabelValues>();
    // 'toothClash' のロックの成分の部品（S5-05）。ラベルに「歯が合わない」を出す
    const clashed = new Set<string>();
    for (const lock of state.motion.locks) {
      if (lock.reason !== 'toothClash') continue;
      for (const id of [...lock.gearIds, ...(lock.rackIds ?? [])]) clashed.add(id);
    }
    const clash = (id: string) => (clashed.has(id) ? { toothClash: true } : {});
    const parts: Array<{ kind: 'gear' | 'carrier' | 'rack'; id: string }> = [];
    const specs: InfoArrowSpec[] = [];
    const nextArrows: Array<{ gearId: GearId; direction: 1 | -1 }> = [];
    for (const id of ids) {
      const item = info[id];
      const gear = state.scene.gears[id];
      const gearLayout = layout.gears[id];
      if (item === undefined || gear === undefined || gearLayout === undefined) continue;
      values.set(id, {
        rpm: item.rpm,
        ratio: item.ratio,
        wormRatio: item.wormRatio,
        ...clash(id),
      });
      parts.push({ kind: 'gear', id });
      if (item.direction === 0) continue;
      // 遊星の歯車（S3-03）は今の公転の位置に置く（10 Hz で置き直す）
      const placed = { ...gearLayout, center: gearWorldCenter(layout, state.motion, id) };
      specs.push(deps.arrowSpec(gear, placed, item.direction));
      nextArrows.push({ gearId: id, direction: item.direction });
    }
    // キャリアの rpm とギア比、ラックの速度と向き（S3-05）
    const visible = visibleInfoPartIds(state.scene, state.selection, state.view.infoOverlay);
    const carriers =
      visible.carriers.length === 0 ? {} : computeCarrierInfo(state.scene, layout, state.motion);
    for (const id of visible.carriers) {
      const item = carriers[id];
      if (item === undefined || layout.carriers[id] === undefined) continue;
      values.set(id, { kind: 'carrier', rpm: item.rpm, ratio: item.ratio });
      parts.push({ kind: 'carrier', id });
    }
    const racks = computeRackInfo(state.scene, state.motion);
    const nextDirections = new Map<string, 1 | -1 | 0>();
    for (const id of visible.racks) {
      const item = racks[id];
      if (item === undefined || layout.racks[id] === undefined) continue;
      values.set(id, { kind: 'rack', speed: item.speed, direction: item.direction, ...clash(id) });
      parts.push({ kind: 'rack', id });
      nextDirections.set(id, item.direction);
    }
    shown = parts;
    rackDirections = nextDirections;
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
      for (const part of shown) {
        // 遊星の歯車（S3-03）は公転した今の位置、ラック（S3-05）は今の位置
        const at = labelAnchor(layout, state.motion, part);
        if (at === null) continue;
        const p = deps.project(at);
        deps.labels.setPosition(part.id, p.x, p.y, p.visible);
        if (part.kind !== 'rack') continue;
        // ラックの矢印: 動く向きを画面に投影した角度
        const placed = layout.racks[part.id];
        const sign = rackDirections.get(part.id) ?? 0;
        if (placed === undefined || sign === 0) {
          deps.labels.setArrowAngle(part.id, null);
          continue;
        }
        const ahead = deps.project(
          add(at, scale(axisVector(placed.direction), RACK_ARROW_PROBE * sign)),
        );
        const dx = ahead.x - p.x;
        const dy = ahead.y - p.y;
        deps.labels.setArrowAngle(part.id, dx === 0 && dy === 0 ? null : Math.atan2(dy, dx));
      }
    },
    arrows: () => arrows.map((a) => ({ ...a })),
  };
}
