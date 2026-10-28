import { gearEnvelope } from '../geometry/dimensions';
import { rackSectionCircle } from '../geometry/rack';
import { axisVector } from '../math/axis';
import { add, scale, type Vec3 } from '../math/vec3';
import type { Axis, Scene } from '../scene/types';
import type { Layout } from './types';

// 部品の範囲（軸に平行な外接箱。S1-13 のカメラの全体表示と寄るに使う）

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

const AXIS_INDEX: Readonly<Record<Axis, number>> = { x: 0, y: 1, z: 2 };

class Accumulator {
  private min: [number, number, number] = [Infinity, Infinity, Infinity];
  private max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  private empty = true;

  addPoint(p: Vec3): void {
    for (let i = 0; i < 3; i++) {
      const value = p[i] as number;
      if (value < (this.min[i] as number)) this.min[i] = value;
      if (value > (this.max[i] as number)) this.max[i] = value;
    }
    this.empty = false;
  }

  // 中心 center、軸 axis、半径 radius、軸方向の半分の幅 halfWidth の円柱
  addCylinder(center: Vec3, axis: Axis, radius: number, halfWidth: number): void {
    const along = AXIS_INDEX[axis];
    const lo: [number, number, number] = [center[0], center[1], center[2]];
    const hi: [number, number, number] = [center[0], center[1], center[2]];
    for (let i = 0; i < 3; i++) {
      const extent = i === along ? halfWidth : radius;
      lo[i] = (lo[i] as number) - extent;
      hi[i] = (hi[i] as number) + extent;
    }
    this.addPoint(lo);
    this.addPoint(hi);
  }

  result(): Aabb | null {
    if (this.empty) return null;
    return { min: [...this.min], max: [...this.max] };
  }
}

// ids を省略すると全部品。歯車は円柱（ピッチ円でなく歯先円の半径 × 歯幅）で近似する。
// 全部品のときは歯車と、歯車の載っていないシャフト（線分）を含める（歯車の載ったシャフトの伸びた分は含めない）。
// ids では、歯車はその円柱、シャフトはその線分、モーターは載っているシャフトの線分、ラックは s = 0 の本体（S3-04）。
// Layout に無い（根からたどれない）部品とシーンに無い ID は無視する。何も無ければ null
export function boundsOf(scene: Scene, layout: Layout, ids?: readonly string[]): Aabb | null {
  const acc = new Accumulator();

  const addGear = (id: string): void => {
    const gear = scene.gears[id];
    const placed = layout.gears[id];
    if (gear === undefined || placed === undefined) return;
    const { radius, halfWidth } = gearEnvelope(gear);
    acc.addCylinder(placed.center, placed.axis, radius, halfWidth);
  };
  const addShaft = (id: string): void => {
    const shaft = layout.shafts[id];
    if (shaft === undefined) return;
    const dir = axisVector(shaft.axis);
    acc.addPoint(add(shaft.origin, scale(dir, shaft.span[0])));
    acc.addPoint(add(shaft.origin, scale(dir, shaft.span[1])));
  };

  // ラック（S3-04）は s = 0 の本体（基準位置を中心に長さ L、断面の外接円）
  const addRack = (id: string): void => {
    const rack = scene.racks[id];
    const placed = layout.racks[id];
    if (rack === undefined || placed === undefined) return;
    const { radius } = rackSectionCircle(rack.size);
    acc.addCylinder(placed.origin, placed.direction, radius, placed.length / 2);
  };

  if (ids === undefined) {
    for (const id of Object.keys(scene.racks)) addRack(id);
    const shaftsWithGears = new Set<string>();
    for (const gear of Object.values(scene.gears)) {
      shaftsWithGears.add(gear.shaftId);
      addGear(gear.id);
    }
    for (const id of Object.keys(scene.shafts)) {
      if (!shaftsWithGears.has(id)) addShaft(id);
    }
    return acc.result();
  }

  for (const id of ids) {
    if (scene.gears[id] !== undefined) addGear(id);
    else if (scene.shafts[id] !== undefined) addShaft(id);
    else if (scene.racks[id] !== undefined) addRack(id);
    else {
      const motor = scene.motors[id];
      if (motor !== undefined) addShaft(motor.shaftId);
    }
  }
  return acc.result();
}
