import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Vec3 } from '../core/math/vec3';
import type { Axis } from '../core/scene/types';
import { type HandleKind, type HandleSpec, handlePickId } from '../input/handle-drag';
import { placeOnAxis } from './frame';
import { setPickTarget } from './picking';

// ハンドルの描画（S1-17）。HandleSpec の一覧から Object3D を作り、位置を合わせる。
// Renderer.pickRoot に足して setPickTarget(object, 'handle', '<kind>:<targetId>') の印を付けるので、
// ピッキングで最優先になる。部品の陰でも見つけられるように、奥行きを無視して最後に重ねて描く。
// 種類ごとの形は HANDLE_BUILDERS に登録する（S1-19 が 'arc'・'axial' を足した）。
// 付け直しのドラッグ（S1-19）の候補の輪も、ここで描く（createReattachView）

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
// 円弧（S1-19）: 今の角度の前後にこれだけ描く
export const ARC_HANDLE_HALF_SPAN = (40 * Math.PI) / 180;
const ARC_TUBE = 0.7;
const ARC_PICK_TUBE = 3.5;
const ARC_KNOB_RADIUS = 3.5;
// 軸方向の矢印（S1-19）: 両向きの矢印の全長と、矢じりの大きさ
const AXIAL_LENGTH = 22;
const AXIAL_HEAD_RADIUS = 2.6;
const AXIAL_HEAD_LENGTH = 6;

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
  readonly bodies: readonly Mesh[]; // 色を変える本体
  place(spec: HandleSpec): void;
}

type HandleBuilder = (materials: HandleMaterials) => HandleObject;

// 位置: 原点の真下の床に置く平たい四角
const buildMove: HandleBuilder = (materials) => {
  const body = new Mesh(new BoxGeometry(MOVE_SIZE, MOVE_THICKNESS, MOVE_SIZE), materials.normal);
  body.renderOrder = HANDLE_RENDER_ORDER;
  return {
    object: body,
    bodies: [body],
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
    bodies: [body],
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

// 外周の角度（S1-19）: 親の軸を中心に、親の軸に垂直な面に描く円弧（今の角度の前後 ±40°）と、
// 今の角度の位置のつまみ。frame.center に置き、ローカルの x・y・z を親の軸の u・v・w に合わせる
const buildArc: HandleBuilder = (materials) => {
  const group = new Group();
  const arc = new Mesh(undefined, materials.line);
  arc.renderOrder = HANDLE_RENDER_ORDER;
  const proxy = new Mesh(undefined, materials.pick);
  const knob = new Mesh(new SphereGeometry(ARC_KNOB_RADIUS, 16, 12), materials.normal);
  knob.renderOrder = HANDLE_RENDER_ORDER + 1;
  group.add(arc, proxy, knob);
  let radius = -1;
  return {
    object: group,
    bodies: [knob],
    place(spec) {
      const frame = spec.frame;
      if (frame === undefined) return;
      if (frame.radius !== radius) {
        radius = frame.radius;
        arc.geometry.dispose();
        proxy.geometry.dispose();
        arc.geometry = new TorusGeometry(radius, ARC_TUBE, 6, 48, 2 * ARC_HANDLE_HALF_SPAN);
        proxy.geometry = new TorusGeometry(radius, ARC_PICK_TUBE, 6, 24, 2 * ARC_HANDLE_HALF_SPAN);
      }
      placeOnAxis(group, frame.center, frame.axis);
      // 円環は +x から反時計回りに伸びるので、今の角度の 40° 手前から始める
      arc.rotation.z = frame.angle - ARC_HANDLE_HALF_SPAN;
      proxy.rotation.z = arc.rotation.z;
      knob.position.set(radius * Math.cos(frame.angle), radius * Math.sin(frame.angle), 0);
    },
  };
};

// シャフト上の位置（S1-19）: 選んだ歯車の歯先円の少し外に、軸に平行な両向きの矢印
const buildAxial: HandleBuilder = (materials) => {
  const group = new Group();
  const lineLength = AXIAL_LENGTH - 2 * AXIAL_HEAD_LENGTH;
  const line = new Mesh(new CylinderGeometry(LINE_RADIUS * 1.5, LINE_RADIUS * 1.5, lineLength, 6));
  line.material = materials.normal;
  const up = new Mesh(new ConeGeometry(AXIAL_HEAD_RADIUS, AXIAL_HEAD_LENGTH, 12), materials.normal);
  up.position.y = (lineLength + AXIAL_HEAD_LENGTH) / 2;
  const down = new Mesh(
    new ConeGeometry(AXIAL_HEAD_RADIUS, AXIAL_HEAD_LENGTH, 12),
    materials.normal,
  );
  down.position.y = -(lineLength + AXIAL_HEAD_LENGTH) / 2;
  down.rotation.z = Math.PI;
  const proxy = new Mesh(
    new CylinderGeometry(ARROW_PICK_RADIUS, ARROW_PICK_RADIUS, AXIAL_LENGTH, 8),
    materials.pick,
  );
  // 円柱・円錐はローカルの y に沿うので、y を軸（ローカルの z = w）に向ける
  const arrow = new Group();
  arrow.rotation.x = Math.PI / 2;
  for (const m of [line, up, down]) m.renderOrder = HANDLE_RENDER_ORDER + 1;
  arrow.add(line, up, down, proxy);
  group.add(arrow);
  return {
    object: group,
    bodies: [line, up, down],
    place(spec) {
      placeOnAxis(group, spec.position, spec.frame?.axis ?? 'y');
    },
  };
};

export const HANDLE_BUILDERS: Partial<Record<HandleKind, HandleBuilder>> = {
  move: buildMove,
  height: buildHeight,
  arc: buildArc,
  axial: buildAxial,
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
        for (const body of entry.bodies) {
          body.material = id === activeId ? materials.active : materials.normal;
        }
      }
      for (const [id, entry] of objects) {
        if (wanted.has(id)) continue;
        dispose(entry);
        objects.delete(id);
      }
    },
  };
}

// 付け直しのドラッグ（S1-19）の候補の輪。子の歯車が付く位置に、ピッチ円の大きさの半透明の輪を描く。
// ポインターに最も近い候補（highlighted）は濃く太く描く。ピッキングの対象にしない
export interface ReattachRing {
  readonly center: Vec3;
  readonly axis: Axis;
  readonly radius: number;
}

export interface ReattachView {
  readonly root: Group;
  set(rings: readonly ReattachRing[], highlighted: number | null): void;
}

const RING_COLOR = 0x8fd8ff;
const RING_TUBE = 0.8;
const RING_HIGHLIGHT_TUBE = 1.4;

export function createReattachView(): ReattachView {
  const root = new Group();
  const normal = new MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
  });
  const strong = new MeshBasicMaterial({
    color: HANDLE_ACTIVE_COLOR,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  let current: readonly ReattachRing[] = [];
  let meshes: Mesh[] = [];
  let lastHighlighted: number | null = null;

  function build(): void {
    for (const mesh of meshes) {
      root.remove(mesh);
      mesh.geometry.dispose();
    }
    meshes = current.map((ring, i) => {
      const tube = i === lastHighlighted ? RING_HIGHLIGHT_TUBE : RING_TUBE;
      const mesh = new Mesh(new TorusGeometry(ring.radius, tube, 6, 48), normal);
      mesh.renderOrder = HANDLE_RENDER_ORDER - 1;
      mesh.raycast = () => {};
      placeOnAxis(mesh, ring.center, ring.axis);
      root.add(mesh);
      return mesh;
    });
  }

  return {
    root,
    set(rings, highlighted) {
      if (rings === current && highlighted === lastHighlighted) return;
      current = rings;
      lastHighlighted = highlighted;
      build();
      meshes.forEach((mesh, i) => {
        mesh.material = i === highlighted ? strong : normal;
      });
    },
  };
}
