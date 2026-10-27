import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import { axisVector } from '../core/math/axis';
import { add, scale } from '../core/math/vec3';
import type { Gear, GearId, Motor, MotorId, Scene, Shaft, ShaftId } from '../core/scene/types';
import { placeOnAxis } from './frame';
import { createGeometryCache, type GeometryCache } from './gear-geometry';
import { setPickTarget } from './picking';

// 仮の見た目の寸法（mm）。形と質感は S1-24 で整える
const SHAFT_RADIUS = 1.5;
const MOTOR_BOX = 8; // 一辺
const MOTOR_GAP = 1; // シャフトの端とモーターの箱のすき間
// 細いシャフトをクリックしやすくする、見えない当たり判定の円柱の半径（S1-16）
export const SHAFT_PICK_RADIUS = 3;

// 選択とマウスを乗せたときのハイライト（S1-16）。ロックの赤（S1-22）と見分けられる水色
const SELECTED_EMISSIVE = 0x1ea7ff;
const SELECTED_EMISSIVE_INTENSITY = 0.9;
const HOVER_EMISSIVE = 0x1ea7ff;
const HOVER_EMISSIVE_INTENSITY = 0.25;

// ハイライトする部品の ID（歯車かシャフト。シャフトならそのモーターも光らせる）
export interface Highlight {
  readonly selected: string | null;
  readonly hovered: string | null;
}

type HighlightLevel = 'none' | 'hovered' | 'selected';

interface MaterialSet {
  none: MeshStandardMaterial;
  hovered: MeshStandardMaterial;
  selected: MeshStandardMaterial;
}

function materialSet(base: MeshStandardMaterial): MaterialSet {
  const hovered = base.clone();
  hovered.emissive.setHex(HOVER_EMISSIVE);
  hovered.emissiveIntensity = HOVER_EMISSIVE_INTENSITY;
  const selected = base.clone();
  selected.emissive.setHex(SELECTED_EMISSIVE);
  selected.emissiveIntensity = SELECTED_EMISSIVE_INTENSITY;
  return { none: base, hovered, selected };
}

interface GearEntry {
  gear: Gear;
  pivot: Group; // 中心に置き、u・v・w に合わせる
  body: Mesh; // pivot のローカルの z まわりに回す
}

interface ShaftEntry {
  shaft: Shaft;
  span: readonly [number, number];
  object: Mesh;
  proxy: Mesh; // 見えない太めの当たり判定（object の子）
}

interface MotorEntry {
  motor: Motor;
  object: Mesh;
}

export interface SceneSync {
  readonly root: Group;
  sync(scene: Scene, layout: Layout): void;
  update(motion: MotionState, layout: Layout): void;
  // 選択とマウスを乗せた部品を光らせる（S1-16）
  setHighlight(highlight: Highlight): void;
  gearCount(): number;
}

// シーンとレイアウトから Three.js のオブジェクトを同期する。
// 部品の参照が変わったものだけ作り直し、位置と向きはレイアウトから毎回置き直す
export function createSceneSync(cache: GeometryCache = createGeometryCache()): SceneSync {
  const root = new Group();
  const gearMaterials = materialSet(
    new MeshStandardMaterial({ color: 0xa0a4aa, metalness: 0.3, roughness: 0.5 }),
  );
  const shaftMaterials = materialSet(
    new MeshStandardMaterial({ color: 0x7a7f87, metalness: 0.4, roughness: 0.4 }),
  );
  const motorMaterials = materialSet(
    new MeshStandardMaterial({ color: 0x5c6068, metalness: 0.1, roughness: 0.7 }),
  );
  const motorGeometry = new BoxGeometry(MOTOR_BOX, MOTOR_BOX, MOTOR_BOX);
  // 当たり判定だけの形（描かないがレイキャストには当たる）
  const pickProxyMaterial = new MeshBasicMaterial({ visible: false });
  let highlight: Highlight = { selected: null, hovered: null };

  const gears = new Map<GearId, GearEntry>();
  const shafts = new Map<ShaftId, ShaftEntry>();
  const motors = new Map<MotorId, MotorEntry>();
  let lastScene: Scene | undefined;
  let lastLayout: Layout | undefined;

  function removeGear(id: GearId, entry: GearEntry): void {
    root.remove(entry.pivot);
    cache.release(entry.gear.kind, entry.gear.size, entry.gear.teeth);
    gears.delete(id);
  }

  function removeShaft(id: ShaftId, entry: ShaftEntry): void {
    root.remove(entry.object);
    entry.object.geometry.dispose();
    entry.proxy.geometry.dispose();
    shafts.delete(id);
  }

  function removeMotor(id: MotorId, entry: MotorEntry): void {
    root.remove(entry.object);
    motors.delete(id);
  }

  function syncGears(scene: Scene, layout: Layout): void {
    for (const [id, entry] of gears) {
      const gear = scene.gears[id];
      if (gear !== entry.gear || layout.gears[id] === undefined) removeGear(id, entry);
    }
    for (const gear of Object.values(scene.gears)) {
      const placed = layout.gears[gear.id];
      if (placed === undefined) continue; // 木から外れた歯車は描かない
      let entry = gears.get(gear.id);
      if (entry === undefined) {
        const body = new Mesh(cache.acquire(gear.kind, gear.size, gear.teeth), gearMaterials.none);
        const pivot = new Group();
        pivot.add(body);
        setPickTarget(pivot, 'gear', gear.id);
        root.add(pivot);
        entry = { gear, pivot, body };
        gears.set(gear.id, entry);
      }
      placeOnAxis(entry.pivot, placed.center, placed.axis);
    }
  }

  function syncShafts(scene: Scene, layout: Layout): void {
    for (const [id, entry] of shafts) {
      const placed = layout.shafts[id];
      if (
        scene.shafts[id] !== entry.shaft ||
        placed === undefined ||
        placed.span[0] !== entry.span[0] ||
        placed.span[1] !== entry.span[1]
      ) {
        removeShaft(id, entry);
      }
    }
    for (const shaft of Object.values(scene.shafts)) {
      const placed = layout.shafts[shaft.id];
      if (placed === undefined) continue;
      let entry = shafts.get(shaft.id);
      if (entry === undefined) {
        const length = Math.max(placed.span[1] - placed.span[0], 1e-3);
        const geometry = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, length, 16);
        geometry.rotateX(Math.PI / 2); // 円柱の向きをローカルの z（= 軸 w）にする
        const object = new Mesh(geometry, shaftMaterials.none);
        const proxyGeometry = new CylinderGeometry(SHAFT_PICK_RADIUS, SHAFT_PICK_RADIUS, length, 8);
        proxyGeometry.rotateX(Math.PI / 2);
        const proxy = new Mesh(proxyGeometry, pickProxyMaterial);
        object.add(proxy);
        setPickTarget(object, 'shaft', shaft.id);
        root.add(object);
        entry = { shaft, span: placed.span, object, proxy };
        shafts.set(shaft.id, entry);
      }
      const mid = (placed.span[0] + placed.span[1]) / 2;
      placeOnAxis(
        entry.object,
        add(placed.origin, scale(axisVector(placed.axis), mid)),
        placed.axis,
      );
    }
  }

  function syncMotors(scene: Scene, layout: Layout): void {
    for (const [id, entry] of motors) {
      const motor = scene.motors[id];
      if (motor !== entry.motor || layout.shafts[entry.motor.shaftId] === undefined) {
        removeMotor(id, entry);
      }
    }
    for (const motor of Object.values(scene.motors)) {
      const placed = layout.shafts[motor.shaftId];
      if (placed === undefined) continue;
      let entry = motors.get(motor.id);
      if (entry === undefined) {
        const object = new Mesh(motorGeometry, motorMaterials.none);
        setPickTarget(object, 'motor', motor.id);
        root.add(object);
        entry = { motor, object };
        motors.set(motor.id, entry);
      }
      // シャフトの負側の端のさらに外に置く（仮。S1-24 で整える）
      const along = placed.span[0] - MOTOR_GAP - MOTOR_BOX / 2;
      placeOnAxis(
        entry.object,
        add(placed.origin, scale(axisVector(placed.axis), along)),
        placed.axis,
      );
    }
  }

  function levelOf(id: string): HighlightLevel {
    if (id === highlight.selected) return 'selected';
    if (id === highlight.hovered) return 'hovered';
    return 'none';
  }

  // 作り直した部品にも効くように、sync と setHighlight のたびに全部品の材質を選び直す
  function applyHighlight(): void {
    for (const [id, entry] of gears) entry.body.material = gearMaterials[levelOf(id)];
    for (const [id, entry] of shafts) entry.object.material = shaftMaterials[levelOf(id)];
    // モーターはシャフトとして選ばれるので、シャフトと同じに光らせる
    for (const entry of motors.values()) {
      entry.object.material = motorMaterials[levelOf(entry.motor.shaftId)];
    }
  }

  return {
    root,
    sync(scene, layout) {
      if (scene === lastScene && layout === lastLayout) return;
      syncGears(scene, layout);
      syncShafts(scene, layout);
      syncMotors(scene, layout);
      lastScene = scene;
      lastLayout = layout;
      applyHighlight();
    },
    setHighlight(next) {
      if (next.selected === highlight.selected && next.hovered === highlight.hovered) return;
      highlight = { selected: next.selected, hovered: next.hovered };
      applyHighlight();
    },
    update(motion, layout) {
      for (const [id, entry] of gears) {
        const placed = layout.gears[id];
        if (placed === undefined) continue;
        entry.body.rotation.z = placed.basePhase + (motion.angles[entry.gear.shaftId] ?? 0);
      }
    },
    gearCount: () => gears.size,
  };
}
