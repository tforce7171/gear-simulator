// 部品パレットの中身（S1-17）。歯車の大きさの選択と、床へドラッグして置く起点のシャフトの項目。
// ドラッグは項目に setPointerCapture して受け、位置（ページ座標）を知らせる。どこで離したか
// （描画領域の上か）の判断と、置く処理は受け取る側（app/interactions）が行う
import type { MessageKey } from '../core/i18n';
import type { SizeKey } from '../core/scene/types';
import { bindText, h } from './dom';
import './palette.css';

export const PALETTE_SIZES: readonly SizeKey[] = ['S', 'M', 'L'];

export interface PaletteDeps {
  readonly body: HTMLElement; // UiShell.palette.body
  readonly getSize: () => SizeKey;
  readonly setSize: (size: SizeKey) => void;
  // 起点のシャフトの項目のドラッグ（左ボタン）
  readonly onRootDragStart: (pageX: number, pageY: number) => void;
  readonly onRootDragMove: (pageX: number, pageY: number) => void;
  readonly onRootDragEnd: (pageX: number, pageY: number) => void;
  readonly onRootDragCancel: () => void;
}

export interface Palette {
  // 大きさのボタンの押された状態を、今の値に合わせる（ストアが変わったら呼ぶ）
  refresh(): void;
  dispose(): void;
}

export function createPalette(deps: PaletteDeps): Palette {
  const unbind: Array<() => void> = [];
  const text = (el: HTMLElement, key: MessageKey, attr?: 'title' | 'aria-label'): void => {
    unbind.push(bindText(el, key, attr));
  };

  // 歯車の大きさ（小・中・大）
  const sizeSection = h('section', 'gs-palette__section');
  const sizeLabel = h('h3', 'gs-palette__label', 'palette-size-label');
  sizeLabel.id = 'gs-palette-size-label';
  text(sizeLabel, 'palette.size');
  const sizeGroup = h('div', 'gs-palette__sizes', 'palette-size');
  sizeGroup.setAttribute('role', 'radiogroup');
  sizeGroup.setAttribute('aria-labelledby', sizeLabel.id);
  const sizeButtons = new Map<SizeKey, HTMLButtonElement>();
  for (const size of PALETTE_SIZES) {
    const button = h('button', 'gs-palette__size', `palette-size-${size}`);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.size = size;
    text(button, `palette.size.${size}`);
    text(button, `palette.size.${size}.tooltip`, 'title');
    button.addEventListener('click', () => {
      deps.setSize(size);
      refresh();
    });
    sizeButtons.set(size, button);
    sizeGroup.append(button);
  }
  sizeSection.append(sizeLabel, sizeGroup);

  // 置く部品
  const partsSection = h('section', 'gs-palette__section');
  const partsLabel = h('h3', 'gs-palette__label');
  text(partsLabel, 'palette.parts');
  const rootItem = h('div', 'gs-palette__item', 'palette-root-shaft');
  rootItem.setAttribute('role', 'button');
  rootItem.setAttribute('aria-roledescription', 'draggable');
  text(rootItem, 'palette.rootShaft.tooltip', 'title');
  const icon = h('span', 'gs-palette__icon');
  icon.setAttribute('aria-hidden', 'true');
  const label = h('span', 'gs-palette__item-label');
  text(label, 'palette.rootShaft');
  rootItem.append(icon, label);
  partsSection.append(partsLabel, rootItem);

  deps.body.append(sizeSection, partsSection);

  // ドラッグ: 項目にポインターを捕捉し、パネルの外（描画領域の上）に出ても受け取る
  let dragPointer: number | null = null;
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || dragPointer !== null) return;
    e.preventDefault(); // 文字の選択を始めない
    dragPointer = e.pointerId;
    try {
      rootItem.setPointerCapture(e.pointerId);
    } catch {
      // 捕捉できなくても、項目の上では受け取れる
    }
    rootItem.classList.add('is-dragging');
    deps.onRootDragStart(e.pageX, e.pageY);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== dragPointer) return;
    deps.onRootDragMove(e.pageX, e.pageY);
  };
  const finish = (): void => {
    dragPointer = null;
    rootItem.classList.remove('is-dragging');
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== dragPointer || e.button !== 0) return;
    finish();
    if (rootItem.hasPointerCapture(e.pointerId)) rootItem.releasePointerCapture(e.pointerId);
    deps.onRootDragEnd(e.pageX, e.pageY);
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== dragPointer) return;
    finish();
    deps.onRootDragCancel();
  };
  rootItem.addEventListener('pointerdown', onPointerDown);
  rootItem.addEventListener('pointermove', onPointerMove);
  rootItem.addEventListener('pointerup', onPointerUp);
  rootItem.addEventListener('pointercancel', onPointerCancel);
  rootItem.addEventListener('lostpointercapture', onPointerCancel);

  function refresh(): void {
    const current = deps.getSize();
    for (const [size, button] of sizeButtons) {
      const on = size === current;
      button.setAttribute('aria-checked', String(on));
      button.classList.toggle('is-selected', on);
    }
  }
  refresh();

  return {
    refresh,
    dispose() {
      for (const off of unbind) off();
      sizeSection.remove();
      partsSection.remove();
    },
  };
}
