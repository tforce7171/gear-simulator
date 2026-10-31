import {
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  TorusGeometry,
} from 'three';
import { GEAR_SIZES } from '../core/constants';
import { gearEnvelope } from '../core/geometry/dimensions';
import { spurDimensions } from '../core/geometry/involute';
import type { GearLayout } from '../core/layout/types';
import { axisVector } from '../core/math/axis';
import { add, scale, type Vec3 } from '../core/math/vec3';
import type { Axis, Gear, GearId, GearKind } from '../core/scene/types';
import { placeOnAxis } from './frame';

// 情報表示の回転方向の矢印（S1-23、要件 §7.3）。歯車の軸の正の側の面の少し外に、歯先円の 1.15 倍の
// 半径で 90° の円弧の矢印を描く。矢印は回さない（歯車の回転とは別の Group に置く）

export const ARROW_RADIUS_FACTOR = 1.15; // 歯先円の半径に掛ける
const ARROW_ARC = Math.PI / 2;
// 面から軸の正の向きに離す距離・管の太さ・矢じりの大きさ（モジュールに掛ける）
const FACE_GAP_PER_MODULE = 0.6;
const TUBE_PER_MODULE = 0.25;
const HEAD_LENGTH_PER_MODULE = 1.6;
const HEAD_RADIUS_PER_MODULE = 0.7;
const ARROW_COLOR = 0xffc83d;

export interface InfoArrowSpec {
  readonly gearId: GearId;
  readonly position: Vec3; // 円弧の中心（歯車の中心から軸の正の向きにずらした点）
  readonly axis: Axis;
  readonly radius: number; // 円弧の半径
  readonly module: number;
  readonly direction: 1 | -1; // 軸の正の向きから見て 1 は反時計回り
}

// 歯車の形と配置から、矢印の置き方を決める
export function infoArrowSpec(
  gear: Pick<Gear, 'id' | 'size' | 'teeth' | 'width'> & { readonly kind?: GearKind },
  layout: Pick<GearLayout, 'center' | 'axis'>,
  direction: 1 | -1,
): InfoArrowSpec {
  const { module, faceWidth } = GEAR_SIZES[gear.size];
  // 種類が分かれば、歯車を囲む円柱（ウォームは長さ 5πm・半径 6m。S2-03）の外に出す
  const envelope =
    gear.kind === undefined
      ? {
          radius: spurDimensions(module, gear.teeth).addendumRadius,
          halfWidth: (gear.width ?? faceWidth) / 2,
        }
      : gearEnvelope({
          kind: gear.kind,
          size: gear.size,
          teeth: gear.teeth,
          ...(gear.width === undefined ? {} : { width: gear.width }),
        });
  const addendumRadius = envelope.radius;
  const lift = envelope.halfWidth + FACE_GAP_PER_MODULE * module;
  return {
    gearId: gear.id,
    position: add(layout.center, scale(axisVector(layout.axis), lift)),
    axis: layout.axis,
    radius: ARROW_RADIUS_FACTOR * addendumRadius,
    module,
    direction,
  };
}

export interface InfoArrowView {
  readonly root: Group;
  // 出す矢印の一覧で置き換える。形の同じ矢印は作り直さない
  set(arrows: readonly InfoArrowSpec[]): void;
  dispose(): void;
}

const material = new MeshBasicMaterial({ color: ARROW_COLOR, side: DoubleSide });

// ローカルの xy 平面（= 軸の基底の u・v）に、角度 0 から 90° まで反時計回りの円弧と、
// 終わり（角度 90°）の矢じりを作る。向きが −1 なら v のまわりに 180° 回して時計回りにする
function buildArrow(radius: number, module: number): { group: Group; flip: Object3D } {
  const tube = TUBE_PER_MODULE * module;
  const headLength = HEAD_LENGTH_PER_MODULE * module;
  const headRadius = HEAD_RADIUS_PER_MODULE * module;
  const arc = new Mesh(new TorusGeometry(radius, tube, 8, 32, ARROW_ARC), material);
  const head = new Mesh(new ConeGeometry(headRadius, headLength, 16), material);
  head.name = 'info-arrow-head';
  // 円錐は +y を向く。終わりの点 (0, R) での反時計回りの接線 −x に向ける
  head.rotation.z = Math.PI / 2;
  head.position.set(-headLength / 2, radius, 0);
  const flip = new Group();
  flip.add(arc, head);
  const group = new Group();
  group.add(flip);
  return { group, flip };
}

interface Entry {
  readonly key: string;
  readonly group: Group;
  readonly flip: Object3D;
}

export function createInfoArrowView(): InfoArrowView {
  const root = new Group();
  root.name = 'info-arrows';
  const entries = new Map<GearId, Entry>();

  function disposeEntry(entry: Entry): void {
    root.remove(entry.group);
    entry.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
  }

  return {
    root,
    set(arrows) {
      const keep = new Set<GearId>();
      for (const spec of arrows) {
        keep.add(spec.gearId);
        const key = `${spec.radius}:${spec.module}`;
        let entry = entries.get(spec.gearId);
        if (entry === undefined || entry.key !== key) {
          if (entry !== undefined) disposeEntry(entry);
          const built = buildArrow(spec.radius, spec.module);
          entry = { key, ...built };
          entries.set(spec.gearId, entry);
          root.add(entry.group);
        }
        placeOnAxis(entry.group, spec.position, spec.axis);
        entry.flip.rotation.y = spec.direction === 1 ? 0 : Math.PI;
      }
      for (const [id, entry] of entries) {
        if (keep.has(id)) continue;
        disposeEntry(entry);
        entries.delete(id);
      }
    },
    dispose() {
      for (const entry of entries.values()) disposeEntry(entry);
      entries.clear();
    },
  };
}
