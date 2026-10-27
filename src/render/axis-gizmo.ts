// 軸の目印（S1-14）。描画領域の右下（UiShell.gizmoSlot）に置き、メインのカメラと同じ向きで回す。
// X（赤）・Y（緑）・Z（青）の正の向きに文字付きの球、負の向きに小さい球。球をクリックすると
// その軸の側から見る視点になる。球はボタン（キーボードでも押せる）、軸の線は SVG で描く
import type { Camera } from 'three';
import { Vector3 } from 'three';
import type { Vec3 } from '../core/math/vec3';
import type { ViewName } from '../input/views';
import { bindText, h } from '../ui/dom';
import './axis-gizmo.css';
import { type GizmoAxis, layoutGizmo } from './axis-gizmo-layout';

const SVG_NS = 'http://www.w3.org/2000/svg';
// 中心から球の中心までの長さの、目印の一辺に対する割合
const AXIS_LENGTH_RATIO = 0.36;
const LABELS: Readonly<Record<GizmoAxis, string>> = { x: 'X', y: 'Y', z: 'Z' };

export interface GizmoTarget {
  view: ViewName;
  x: number; // ページ座標（CSS ピクセル）
  y: number;
}

export interface AxisGizmo {
  update(camera: Camera): void; // 毎フレーム、描く前に呼ぶ（向きが変わったときだけ書き換える）
  targets(): GizmoTarget[]; // 球の中心の画面上の位置
  dispose(): void;
}

export function createAxisGizmo(slot: HTMLElement, onSelect: (view: ViewName) => void): AxisGizmo {
  const root = h('div', 'gs-gizmo', 'axis-gizmo');
  root.setAttribute('role', 'group');
  const unbind: Array<() => void> = [bindText(root, 'gizmo.label', 'aria-label')];

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('gs-gizmo__lines');
  svg.setAttribute('aria-hidden', 'true');
  const lines = new Map<GizmoAxis, SVGLineElement>();
  for (const axis of ['x', 'y', 'z'] as const) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.classList.add('gs-gizmo__line', `gs-gizmo--${axis}`);
    svg.append(line);
    lines.set(axis, line);
  }
  root.append(svg);

  const buttons = new Map<ViewName, HTMLButtonElement>();
  for (const item of layoutGizmo({ right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] }, 1, 1)) {
    const button = h('button', `gs-gizmo__ball gs-gizmo--${item.axis}`, `gizmo-${item.view}`);
    button.type = 'button';
    button.dataset.view = item.view;
    if (item.positive) {
      button.classList.add('gs-gizmo__ball--positive');
      button.textContent = LABELS[item.axis];
    }
    unbind.push(bindText(button, `gizmo.${item.view}`, 'aria-label'));
    unbind.push(bindText(button, `gizmo.${item.view}`, 'title'));
    button.addEventListener('click', () => onSelect(item.view));
    buttons.set(item.view, button);
    root.append(button);
  }
  slot.append(root);

  const right = new Vector3();
  const up = new Vector3();
  const back = new Vector3();
  const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];
  let lastKey = '';

  return {
    update(camera) {
      const size = slot.clientWidth || 96;
      const e = camera.matrixWorld.elements;
      const key = `${size}:${e.slice(0, 11).map((n) => n.toFixed(4))}`;
      if (key === lastKey) return;
      lastKey = key;
      camera.matrixWorld.extractBasis(right, up, back);
      right.normalize();
      up.normalize();
      back.normalize();
      const items = layoutGizmo(
        { right: toVec3(right), up: toVec3(up), back: toVec3(back) },
        size,
        size * AXIS_LENGTH_RATIO,
      );
      items.forEach((item, order) => {
        const button = buttons.get(item.view);
        if (button === undefined) return;
        button.style.left = `${item.x}px`;
        button.style.top = `${item.y}px`;
        // 手前の球を上に重ねる
        button.style.zIndex = String(order + 1);
        if (item.positive) {
          const line = lines.get(item.axis);
          line?.setAttribute('x1', String(size / 2));
          line?.setAttribute('y1', String(size / 2));
          line?.setAttribute('x2', String(item.x));
          line?.setAttribute('y2', String(item.y));
        }
      });
    },
    targets() {
      const result: GizmoTarget[] = [];
      for (const [view, button] of buttons) {
        const rect = button.getBoundingClientRect();
        result.push({
          view,
          x: rect.left + window.scrollX + rect.width / 2,
          y: rect.top + window.scrollY + rect.height / 2,
        });
      }
      return result;
    },
    dispose() {
      for (const off of unbind) off();
      root.remove();
    },
  };
}
