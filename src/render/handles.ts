import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import { type HandleKind, type HandleSpec, handlePickId } from '../input/handle-drag';
import { setPickTarget } from './picking';

// ハンドルの描画（S1-17）。HandleSpec の一覧から Object3D を作り、位置を合わせる。
// Renderer.pickRoot に足して setPickTarget(object, 'handle', '<kind>:<targetId>') の印を付けるので、
// ピッキングで最優先になる。部品の陰でも見つけられるように、奥行きを無視して最後に重ねて描く。
// 種類ごとの形は HANDLE_BUILDERS に登録する（S1-19 が 'arc'・'axial' を足す）

const HANDLE_COLOR = 0xffb02e;
const HANDLE_ACTIVE_COLOR = 0xffe08a;
const HANDLE_LINE_COLOR = 0xc98a24;
const HANDLE_RENDER_ORDER = 10;

const MOVE_SIZE = 9; // mm。床の四角の一辺
const MOVE_THICKNESS = 0.8;
const ARROW_RADIUS = 3;
const ARROW_LENGTH = 8;
const LINE_RADIUS = 0.4;
// 矢印は細くて当てにくいので、見えない太めの当たり判定を付ける
const ARROW_PICK_RADIUS = 4.5;

interface HandleMaterials {
  normal: MeshBasicMaterial;
  active: MeshBasicMaterial;
  line: MeshBasicMaterial;
  pick: MeshBasicMaterial;
}

function overlay(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
}

// 1 つのハンドルの見た目。place は位置が変わるたびに呼ぶ
interface HandleObject {
  readonly object: Object3D;
  readonly body: Mesh; // 色を変える本体
  place(spec: HandleSpec): void;
}

type HandleBuilder = (materials: HandleMaterials) => HandleObject;

// 位置: 原点の真下の床に置く平たい四角
const buildMove: HandleBuilder = (materials) => {
  const body = new Mesh(new BoxGeometry(MOVE_SIZE, MOVE_THICKNESS, MOVE_SIZE), materials.normal);
  body.renderOrder = HANDLE_RENDER_ORDER;
  return {
    object: body,
    body,
    place(spec) {
      body.position.set(spec.position[0], spec.position[1], spec.position[2]);
    },
  };
};

// 高さ: 床から伸びる縦の線と、その先の上向きの矢印（position は矢印の中心）
const buildHeight: HandleBuilder = (materials) => {
  const group = new Group();
  const body = new Mesh(new ConeGeometry(ARROW_RADIUS, ARROW_LENGTH, 16), materials.normal);
  body.renderOrder = HANDLE_RENDER_ORDER + 1;
  const proxy = new Mesh(
    new CylinderGeometry(ARROW_PICK_RADIUS, ARROW_PICK_RADIUS, ARROW_LENGTH + 2, 8),
    materials.pick,
  );
  body.add(proxy);
  // 線の長さは 1 で作り、place で高さに合わせて伸ばす
  const line = new Mesh(new CylinderGeometry(LINE_RADIUS, LINE_RADIUS, 1, 6), materials.line);
  line.renderOrder = HANDLE_RENDER_ORDER;
  // 線は当たり判定にしない（真下の床の四角をつかめるように）
  line.raycast = () => {};
  group.add(body, line);
  return {
    object: group,
    body,
    place(spec) {
      const y = spec.position[1];
      group.position.set(spec.position[0], 0, spec.position[2]);
      body.position.set(0, y, 0);
      const length = Math.max(y - ARROW_LENGTH / 2, 1e-3);
      line.scale.set(1, length, 1);
      line.position.set(0, length / 2, 0);
    },
  };
};

export const HANDLE_BUILDERS: Partial<Record<HandleKind, HandleBuilder>> = {
  move: buildMove,
  height: buildHeight,
};

export interface HandleView {
  readonly root: Group;
  // 出すハンドルの一覧と、ドラッグ中のハンドルのピッキングの ID（明るく描く）
  set(handles: readonly HandleSpec[], activeId: string | null): void;
}

export function createHandleView(): HandleView {
  const root = new Group();
  const materials: HandleMaterials = {
    normal: overlay(HANDLE_COLOR),
    active: overlay(HANDLE_ACTIVE_COLOR),
    line: overlay(HANDLE_LINE_COLOR),
    pick: new MeshBasicMaterial({ visible: false }),
  };
  const objects = new Map<string, HandleObject>();

  function dispose(entry: HandleObject): void {
    root.remove(entry.object);
    entry.object.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh === true) mesh.geometry.dispose();
    });
  }

  return {
    root,
    set(handles, activeId) {
      const wanted = new Set<string>();
      for (const spec of handles) {
        const id = handlePickId(spec);
        const builder = HANDLE_BUILDERS[spec.kind];
        if (builder === undefined) continue;
        wanted.add(id);
        let entry = objects.get(id);
        if (entry === undefined) {
          entry = builder(materials);
          setPickTarget(entry.object, 'handle', id);
          root.add(entry.object);
          objects.set(id, entry);
        }
        entry.place(spec);
        entry.body.material = id === activeId ? materials.active : materials.normal;
      }
      for (const [id, entry] of objects) {
        if (wanted.has(id)) continue;
        dispose(entry);
        objects.delete(id);
      }
    },
  };
}
