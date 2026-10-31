import { Box3, type Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SizeKey } from '../core/scene/types';
import {
  buildMotorModel,
  createMotorGeometries,
  MOTOR_GAP,
  MOTOR_PARTS,
  motorDiameter,
  motorLength,
} from './motor';

// S4-07: モーターの形

const SIZES: readonly SizeKey[] = ['S', 'M', 'L'];
const EXPECTED_DIAMETER: Readonly<Record<SizeKey, number>> = { S: 6, M: 8, L: 11 };

function boxOf(object: Object3D): { size: Vector3; min: Vector3; max: Vector3 } {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  return { size: box.getSize(new Vector3()), min: box.min, max: box.max };
}

describe('モーターの形（S4-07）', () => {
  const geometries = createMotorGeometries();

  for (const size of SIZES) {
    it(`${size}: 外形の直径が ${EXPECTED_DIAMETER[size]} mm、長さがその約 1.3 倍`, () => {
      const d = EXPECTED_DIAMETER[size];
      expect(motorDiameter(size)).toBe(d);
      expect(motorLength(size)).toBeCloseTo(1.3 * d, 9);
      const model = buildMotorModel(geometries, size, 1.5);
      const { size: extent, min, max } = boxOf(model.housing);
      // 直径: 軸に垂直な向きの外形の大きいほう（両脇は平らに削っている）
      expect(Math.max(extent.x, extent.y)).toBeCloseTo(d, 6);
      // 両脇を削っているので、片方は直径より細い
      expect(Math.min(extent.x, extent.y)).toBeLessThan(d);
      // 長さ: 軸受け・端子を含めても約 1.3 倍（±15%）
      expect(extent.z / d).toBeGreaterThan(1.3 * 0.95);
      expect(extent.z / d).toBeLessThan(1.3 * 1.15);
      // 本体（缶と端の蓋）は原点を中心に 1.3·d
      const body = model.meshes.filter((m) => m.part === 'body' || m.part === 'endCap');
      const bodyBox = new Box3();
      for (const { mesh } of body) bodyBox.expandByObject(mesh);
      expect(bodyBox.min.z).toBeCloseTo(-0.65 * d, 6);
      expect(bodyBox.max.z).toBeGreaterThanOrEqual(0.65 * d - 1e-6);
      // 軸受けはシャフトとのすき間より短く出る
      expect(max.z - 0.65 * d).toBeLessThan(MOTOR_GAP);
      expect(min.z).toBeLessThan(-0.65 * d); // 端子は端の蓋から後ろに出る
    });
  }

  it('すべての部分（本体・端の蓋・端子・継手・線）のメッシュがあり、影を落とす', () => {
    const model = buildMotorModel(geometries, 'M', 1.5);
    expect(new Set(model.meshes.map((m) => m.part))).toEqual(new Set(MOTOR_PARTS));
    for (const { mesh } of model.meshes) expect(mesh.castShadow).toBe(true);
    // 端子は 2 本
    expect(model.meshes.filter((m) => m.part === 'terminal')).toHaveLength(2);
  });

  it('継手はシャフト側（+z）の、本体とシャフトの端の間にあり、シャフトより太い', () => {
    const shaftRadius = 1.5;
    const model = buildMotorModel(geometries, 'M', shaftRadius);
    const { min, max, size } = boxOf(model.spin);
    const front = motorLength('M') / 2;
    expect(min.z).toBeGreaterThanOrEqual(front - 1e-6);
    // シャフトの端（本体の前の面 + MOTOR_GAP）を越えて、シャフトに被さる
    expect(max.z).toBeGreaterThan(front + MOTOR_GAP);
    expect(size.x / 2).toBeGreaterThan(shaftRadius);
  });

  it('継手を回すと線の位置が軸まわりに回る（回転が見える）', () => {
    const model = buildMotorModel(geometries, 'M', 1.5);
    const mark = model.meshes.find((m) => m.part === 'mark')?.mesh;
    if (mark === undefined) throw new Error('線が無い');
    const at = (): Vector3 => {
      model.group.updateMatrixWorld(true);
      return new Box3().setFromObject(mark).getCenter(new Vector3());
    };
    const before = at();
    model.spin.rotation.z = Math.PI / 2;
    const after = at();
    expect(before.y).toBeGreaterThan(0);
    expect(Math.abs(before.x)).toBeLessThan(1e-6);
    expect(after.x).toBeLessThan(0); // +y が +z まわりに 90° 回ると −x
    expect(Math.abs(after.y)).toBeLessThan(1e-6);
  });
});
