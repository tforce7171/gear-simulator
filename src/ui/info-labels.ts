// 情報表示のラベル（S1-23、要件 §7.3）。歯車の中心を投影した位置の少し上に、2 行
// （"20.0 rpm" / "ギア比 3.00 : 1"）を DOM で重ねる。ウォームの組の歯車には 3 行目に
// "ウォーム比 30:1"（S2-05）を出す。ポインターは下の canvas に通す。
// S3-05 でキャリア（歯車と同じ rpm とギア比）とラック（速度 "6.3 mm/s" と、動く向きの矢印）のラベルを足した。
// ラックの矢印は、動く向きを画面に投影した角度に回す（setArrowAngle。毎フレーム）
import { onLanguageChange, t } from '../app/i18n';
import {
  formatRatio,
  formatRpm,
  formatSpeed,
  formatWormRatio,
  type WormRatio,
} from '../core/kinematics/info';
import { h } from './dom';
import './info-labels.css';

// 回転する部品（歯車・キャリア）の値
export interface RotationLabelValues {
  readonly kind?: 'gear' | 'carrier'; // 省くと歯車
  readonly rpm: number;
  readonly ratio: number | null;
  readonly wormRatio?: WormRatio | null; // ウォームの組のギア比（S2-05）
  readonly toothClash?: boolean; // 'toothClash' のロックの成分の部品（S5-05）。「歯が合わない」を出す
}

// ラックの値（S3-05）。direction は動く向き（止まっていれば 0）
export interface RackLabelValues {
  readonly kind: 'rack';
  readonly speed: number; // mm/s（絶対値）
  readonly direction: 1 | -1 | 0;
  readonly toothClash?: boolean; // S5-05
}

export type InfoLabelValues = RotationLabelValues | RackLabelValues;

export interface InfoLabels {
  // 出す部品の一覧と値で置き換える（文字を書き換える。10 Hz で呼ぶ）。キーは部品の ID
  setValues(values: ReadonlyMap<string, InfoLabelValues>): void;
  // 位置（host の左上からの CSS ピクセル）。visible が false なら隠す（毎フレーム呼ぶ）
  setPosition(id: string, x: number, y: number, visible: boolean): void;
  // ラックの矢印の画面上の角度（rad。右が 0、時計回りが正）。null なら矢印を出さない（S3-05）
  setArrowAngle(id: string, angle: number | null): void;
  dispose(): void;
}

interface Label {
  readonly el: HTMLElement;
  readonly main: HTMLElement;
  readonly sub: HTMLElement;
  readonly worm: HTMLElement;
  readonly arrow: HTMLElement;
  readonly lock: HTMLElement; // ロックの理由（S5-05。今は 'toothClash' だけ）
  values: InfoLabelValues;
}

function render(label: Label): void {
  const v = label.values;
  label.lock.hidden = v.toothClash !== true;
  label.lock.textContent = v.toothClash === true ? t('info.lock.toothClash') : '';
  if (v.kind === 'rack') {
    label.main.textContent = t('info.speed', { speed: formatSpeed(v.speed) });
    label.sub.textContent = v.direction === 0 ? t('info.rack.stopped') : t('info.rack.direction');
    if (v.direction === 0) label.arrow.hidden = true;
    label.worm.hidden = true;
    label.worm.textContent = '';
    return;
  }
  label.main.textContent = formatRpm(v.rpm);
  label.sub.textContent = `${t('info.ratio')} ${formatRatio(v.ratio)}`;
  label.arrow.hidden = true;
  const worm = v.wormRatio ?? null;
  label.worm.hidden = worm === null;
  label.worm.textContent = worm === null ? '' : `${t('info.wormRatio')} ${formatWormRatio(worm)}`;
}

function sameWorm(a: WormRatio | null | undefined, b: WormRatio | null | undefined): boolean {
  return (
    (a?.wheelTeeth ?? null) === (b?.wheelTeeth ?? null) &&
    (a?.threads ?? null) === (b?.threads ?? null)
  );
}

function sameValues(a: InfoLabelValues, b: InfoLabelValues): boolean {
  if ((a.toothClash === true) !== (b.toothClash === true)) return false;
  if (a.kind === 'rack' || b.kind === 'rack') {
    return (
      a.kind === 'rack' && b.kind === 'rack' && a.speed === b.speed && a.direction === b.direction
    );
  }
  return a.rpm === b.rpm && a.ratio === b.ratio && sameWorm(a.wormRatio, b.wormRatio);
}

// host は描画領域（position が static でない要素）
export function createInfoLabels(host: HTMLElement): InfoLabels {
  const layer = h('div', 'gs-info-labels', 'info-labels');
  host.append(layer);
  const labels = new Map<string, Label>();
  const offLanguage = onLanguageChange(() => {
    for (const label of labels.values()) render(label);
  });

  return {
    setValues(values) {
      for (const [id, label] of labels) {
        if (values.has(id)) continue;
        label.el.remove();
        labels.delete(id);
      }
      for (const [id, value] of values) {
        let label = labels.get(id);
        if (label === undefined) {
          const el = h('div', 'gs-info-label', 'info-label');
          const kind = value.kind ?? 'gear';
          // 歯車は data-gear-id（S1-23）。どの部品も data-part-id と data-part-kind を持つ（S3-05）
          if (kind === 'gear') el.dataset.gearId = id;
          el.dataset.partId = id;
          el.dataset.partKind = kind;
          el.hidden = true; // 位置が決まるまで隠す
          const main = h('div', 'gs-info-label__rpm', 'info-label-main');
          const sub = h('span', 'gs-info-label__ratio');
          const arrow = h('span', 'gs-info-label__arrow', 'info-label-arrow');
          arrow.textContent = '→';
          arrow.hidden = true;
          const row = h('div', 'gs-info-label__sub');
          row.append(sub, arrow);
          const worm = h('div', 'gs-info-label__worm', 'info-label-worm');
          const lock = h('div', 'gs-info-label__lock', 'info-label-lock');
          lock.hidden = true;
          el.append(main, row, worm, lock);
          layer.append(el);
          label = { el, main, sub, worm, arrow, lock, values: value };
          labels.set(id, label);
        } else if (sameValues(label.values, value)) {
          continue;
        }
        label.values = value;
        render(label);
      }
    },
    setPosition(id, x, y, visible) {
      const label = labels.get(id);
      if (label === undefined) return;
      label.el.hidden = !visible;
      if (visible) label.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    },
    setArrowAngle(id, angle) {
      const label = labels.get(id);
      if (label === undefined || label.values.kind !== 'rack') return;
      const show = angle !== null && label.values.direction !== 0;
      label.arrow.hidden = !show;
      if (show) label.arrow.style.transform = `rotate(${angle}rad)`;
    },
    dispose() {
      offLanguage();
      layer.remove();
      labels.clear();
    },
  };
}
