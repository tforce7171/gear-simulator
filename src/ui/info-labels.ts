// 情報表示のラベル（S1-23、要件 §7.3）。歯車の中心を投影した位置の少し上に、2 行
// （"20.0 rpm" / "ギア比 3.00 : 1"）を DOM で重ねる。ポインターは下の canvas に通す
import { onLanguageChange, t } from '../app/i18n';
import { formatRatio, formatRpm } from '../core/kinematics/info';
import type { GearId } from '../core/scene/types';
import { h } from './dom';
import './info-labels.css';

export interface InfoLabelValues {
  readonly rpm: number;
  readonly ratio: number | null;
}

export interface InfoLabels {
  // 出す歯車の一覧と値で置き換える（文字を書き換える。10 Hz で呼ぶ）
  setValues(values: ReadonlyMap<GearId, InfoLabelValues>): void;
  // 位置（host の左上からの CSS ピクセル）。visible が false なら隠す（毎フレーム呼ぶ）
  setPosition(gearId: GearId, x: number, y: number, visible: boolean): void;
  dispose(): void;
}

interface Label {
  readonly el: HTMLElement;
  readonly rpm: HTMLElement;
  readonly ratio: HTMLElement;
  values: InfoLabelValues;
}

function render(label: Label): void {
  label.rpm.textContent = formatRpm(label.values.rpm);
  label.ratio.textContent = `${t('info.ratio')} ${formatRatio(label.values.ratio)}`;
}

// host は描画領域（position が static でない要素）
export function createInfoLabels(host: HTMLElement): InfoLabels {
  const layer = h('div', 'gs-info-labels', 'info-labels');
  host.append(layer);
  const labels = new Map<GearId, Label>();
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
          el.dataset.gearId = id;
          el.hidden = true; // 位置が決まるまで隠す
          const rpm = h('div', 'gs-info-label__rpm');
          const ratio = h('div', 'gs-info-label__ratio');
          el.append(rpm, ratio);
          layer.append(el);
          label = { el, rpm, ratio, values: value };
          labels.set(id, label);
        } else if (label.values.rpm === value.rpm && label.values.ratio === value.ratio) {
          continue;
        }
        label.values = value;
        render(label);
      }
    },
    setPosition(gearId, x, y, visible) {
      const label = labels.get(gearId);
      if (label === undefined) return;
      label.el.hidden = !visible;
      if (visible) label.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    },
    dispose() {
      offLanguage();
      layer.remove();
      labels.clear();
    },
  };
}
