// 部品パレットの中身（S1-17）。歯車の大きさの選択、生やす歯車の種類の選択（S2-05）と、床へドラッグして置く起点のシャフトの項目。
// ドラッグは項目に setPointerCapture して受け、位置（ページ座標）を知らせる。どこで離したか
// （描画領域の上か）の判断と、置く処理は受け取る側（app/interactions）が行う
import { onLanguageChange, t } from '../app/i18n';
import type { MessageKey } from '../core/i18n';
import { PALETTE_KIND_LIST, type PaletteKind } from '../core/layout/candidates';
import type { SizeKey } from '../core/scene/types';
import { bindText, h } from './dom';
import './palette.css';

export const PALETTE_SIZES: readonly SizeKey[] = ['S', 'M', 'L'];
// 生やす歯車の種類の並び（S2-05）: 平歯車・ハスバ・かさ・ウォーム・ホイール・ねじ歯車・内歯車（S3-02）・
// ラック・遊星（S4-02）
export const PALETTE_KINDS: readonly PaletteKind[] = PALETTE_KIND_LIST;

// パレットの種類の表示名（S4-02）。歯車の種類は gearKind.<種類>、ラック・遊星は paletteKind.<種類>
export function paletteKindLabel(kind: PaletteKind): MessageKey {
  return kind === 'rack' || kind === 'planetary' ? `paletteKind.${kind}` : `gearKind.${kind}`;
}

// 選んでいる部品とかみ合う向きに生やせる種類（S4-02。core/layout/candidates の meshableKinds）。
// subject は選んでいる部品が歯車かラックか。選択が無い・歯車でもラックでもなければ null
export interface MeshableInfo {
  readonly subject: 'gear' | 'rack';
  readonly kinds: readonly PaletteKind[];
}

export interface PaletteDeps {
  readonly body: HTMLElement; // UiShell.palette.body
  readonly getSize: () => SizeKey;
  readonly setSize: (size: SizeKey) => void;
  // 生やす歯車の種類（S2-05。S4-02 からラック・遊星も）
  readonly getKind: () => PaletteKind;
  readonly setKind: (kind: PaletteKind) => void;
  // 選んでいる部品とかみ合える種類（S4-02）。パレットの種類が入っていなければ注記を出す
  readonly getMeshable: () => MeshableInfo | null;
  // 起点のシャフトの項目のドラッグ（左ボタン）
  readonly onRootDragStart: (pageX: number, pageY: number) => void;
  readonly onRootDragMove: (pageX: number, pageY: number) => void;
  readonly onRootDragEnd: (pageX: number, pageY: number) => void;
  readonly onRootDragCancel: () => void;
}

export interface Palette {
  // 大きさ・種類のボタンの押された状態を、今の値に合わせる（ストアが変わったら呼ぶ）
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

  // 生やす歯車の種類（S2-05）。候補はこの種類の歯車ができるものだけ（S4-02）
  const kindSection = h('section', 'gs-palette__section');
  const kindLabel = h('h3', 'gs-palette__label', 'palette-kind-label');
  kindLabel.id = 'gs-palette-kind-label';
  text(kindLabel, 'palette.kind');
  const kindGroup = h('div', 'gs-palette__kinds', 'palette-kind');
  kindGroup.setAttribute('role', 'radiogroup');
  kindGroup.setAttribute('aria-labelledby', kindLabel.id);
  const kindButtons = new Map<PaletteKind, HTMLButtonElement>();
  for (const kind of PALETTE_KINDS) {
    const button = h('button', 'gs-palette__kind', `palette-kind-${kind}`);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.kind = kind;
    text(button, paletteKindLabel(kind));
    button.addEventListener('click', () => {
      deps.setKind(kind);
      refresh();
    });
    kindButtons.set(kind, button);
    kindGroup.append(button);
  }
  const kindHint = h('p', 'gs-palette__hint', 'palette-kind-hint');
  text(kindHint, 'palette.kind.hint');
  // 選んでいる部品とかみ合えない種類を選んでいるときの注記（S4-02）。「この歯車とかみ合えるのは〇〇です」
  const kindNote = h('p', 'gs-palette__note', 'palette-kind-note');
  kindNote.setAttribute('role', 'status');
  kindNote.hidden = true;
  kindSection.append(kindLabel, kindGroup, kindNote, kindHint);

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

  deps.body.append(sizeSection, kindSection, partsSection);

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

  // 注記の文字列。出さないなら null
  function noteText(): string | null {
    const meshable = deps.getMeshable();
    if (meshable === null || meshable.kinds.includes(deps.getKind())) return null;
    if (meshable.kinds.length === 0) return t('palette.kind.note.none');
    const names = meshable.kinds.map((k) => t(paletteKindLabel(k)));
    const key = meshable.subject === 'rack' ? 'palette.kind.note.rack' : 'palette.kind.note';
    return t(key, { kinds: names.join(t('palette.kind.note.separator')) });
  }
  function refreshNote(): void {
    const text = noteText();
    const hidden = text === null;
    if (kindNote.hidden !== hidden) kindNote.hidden = hidden;
    if (text !== null && kindNote.textContent !== text) kindNote.textContent = text;
  }
  unbind.push(onLanguageChange(refreshNote));

  function refresh(): void {
    const current = deps.getSize();
    for (const [size, button] of sizeButtons) {
      const on = size === current;
      button.setAttribute('aria-checked', String(on));
      button.classList.toggle('is-selected', on);
    }
    const kind = deps.getKind();
    for (const [k, button] of kindButtons) {
      const on = k === kind;
      button.setAttribute('aria-checked', String(on));
      button.classList.toggle('is-selected', on);
    }
    refreshNote();
  }
  refresh();

  return {
    refresh,
    dispose() {
      for (const off of unbind) off();
      sizeSection.remove();
      kindSection.remove();
      partsSection.remove();
    },
  };
}
