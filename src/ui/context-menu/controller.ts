// コンテキストメニューを開いて項目を実行する（S1-29、要件 §7.1）。右クリック（ドラッグなし）の位置で部品の
// 本体をピッキングし、部品の上なら左クリックと同じ規則で選択を置き換えて部品のメニュー、何もない所なら
// 選択を変えずに何もない所のメニューを開く
import { selectionForPick } from '../../app/selection';
import type { AppAction, AppState } from '../../app/store';
import type { Vec3 } from '../../core/math/vec3';
import type { SizeKey } from '../../core/scene/types';
import type { PickKind } from '../../input/pick-priority';
import {
  buildContextMenuItems,
  type ContextTarget,
  type MenuAction,
  targetAnchorId,
  targetMotorId,
  targetShaftId,
} from './items';
import { createContextMenuView } from './menu';

// メニューから付けるモーターの大きさ。プロパティパネル（S1-20）は大きさを選んで付けるが、メニューでは
// 選ばせないので中にする（回転数・向き・ON は addMotor の初期値で、パネルと同じ）
export const CONTEXT_MENU_MOTOR_SIZE: SizeKey = 'M';

export interface ContextMenuDeps {
  readonly host: HTMLElement;
  readonly getState: () => AppState;
  readonly dispatch: (action: AppAction) => void;
  // ページ座標の点の下の部品の本体（歯車・モーター・シャフト。ハンドル・候補は除く）
  readonly pickBody: (x: number, y: number) => { kind: PickKind; id: string; point: Vec3 } | null;
  readonly dollyToPoint: (world: Vec3) => void; // ここに寄る（ダブルクリックと同じ）
  readonly fitAll: () => void; // 全体表示（Home と同じ）
}

export interface ContextMenu {
  // 右クリックの要求（ページ座標）を受けてメニューを開く
  openAt(x: number, y: number): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createContextMenu(deps: ContextMenuDeps): ContextMenu {
  let target: ContextTarget = { kind: 'empty' };

  function run(action: MenuAction): void {
    const { scene, view } = deps.getState();
    const command = (c: Extract<AppAction, { type: 'command' }>['command']): void =>
      deps.dispatch({ type: 'command', command: c });
    switch (action) {
      case 'delete':
        if (target.kind === 'part') command({ type: 'deleteParts', ids: [target.partId] });
        return;
      case 'attachMotor': {
        const shaftId = target.kind === 'part' ? targetShaftId(scene, target.partId) : null;
        if (shaftId !== null) {
          command({ type: 'addMotor', shaftId, size: CONTEXT_MENU_MOTOR_SIZE });
        }
        return;
      }
      case 'detachMotor': {
        const motorId = target.kind === 'part' ? targetMotorId(scene, target.partId) : null;
        if (motorId !== null) command({ type: 'removeMotor', motorId });
        return;
      }
      case 'anchor': {
        const shaftId = target.kind === 'part' ? targetShaftId(scene, target.partId) : null;
        if (shaftId !== null) command({ type: 'addAnchor', shaftId });
        return;
      }
      case 'unanchor': {
        const anchorId = target.kind === 'part' ? targetAnchorId(scene, target.partId) : null;
        if (anchorId !== null) command({ type: 'removeAnchor', anchorId });
        return;
      }
      case 'focusHere':
        if (target.kind === 'part') deps.dollyToPoint(target.point);
        return;
      case 'frameAll':
        deps.fitAll();
        return;
      case 'toggleWatch':
        deps.dispatch({ type: 'setWatchMode', on: !view.watchMode });
        return;
      case 'toggleInfo':
        deps.dispatch({ type: 'setInfoOverlay', on: !view.infoOverlay });
        return;
    }
  }

  const view = createContextMenuView(deps.host, run);

  return {
    openAt(x, y) {
      const hit = deps.pickBody(x, y);
      const partId = selectionForPick(hit, deps.getState().scene);
      if (hit !== null && partId !== null) {
        deps.dispatch({ type: 'select', id: partId });
        target = { kind: 'part', partId, point: hit.point };
      } else {
        target = { kind: 'empty' };
      }
      view.open(buildContextMenuItems(target, deps.getState()), { x, y });
    },
    close: () => view.close(),
    isOpen: () => view.isOpen(),
    dispose: () => view.dispose(),
  };
}
