// ロックと干渉の表示（S1-22、要件 §5・§6）。three に依存しない純粋関数だけを置く

import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Scene } from '../core/scene/types';

// ロック中の部品の震え（軸まわりの回転のゆれ）の振幅（rad）。描画だけに加え、運動の状態は変えない
export const LOCK_SHAKE_AMPLITUDE = 0.01;
// 赤い光の脈打つ速さ（Hz）
export const LOCK_GLOW_HZ = 2;
// 震えの 2 つの周波数（Hz）。比を整数比から外して、規則的な往復に見えないようにする
const SHAKE_HZ_A = 23;
const SHAKE_HZ_B = 37.3;

// seed ごとに位相をずらした小さなゆれ。|値| ≤ LOCK_SHAKE_AMPLITUDE
export function lockShakeAngle(timeSec: number, seed: number): number {
  const phaseA = seed * 2.399963; // 黄金角ずつずらす
  const phaseB = seed * 1.618034;
  const wave =
    0.6 * Math.sin(2 * Math.PI * SHAKE_HZ_A * timeSec + phaseA) +
    0.4 * Math.sin(2 * Math.PI * SHAKE_HZ_B * timeSec + phaseB);
  return LOCK_SHAKE_AMPLITUDE * wave;
}

// 赤い光の強さ。0〜1 を LOCK_GLOW_HZ で往復する
export function lockGlowIntensity(timeSec: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * LOCK_GLOW_HZ * timeSec);
}

// 部品の ID から震えの seed を決める（同じ ID なら毎回同じ）
export function shakeSeedOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (hash >>> 0) % 1000;
}

export interface WarningParts {
  readonly locked: ReadonlySet<string>;
  readonly interfering: ReadonlySet<string>;
}

export const NO_WARNINGS: WarningParts = { locked: new Set(), interfering: new Set() };

// ロック中・干渉中として表示する部品の ID。ロックは歯車・シャフト・ラック（S3-04）と、そのシャフトに付いたモーター。
// 干渉は組に含まれる部品（歯車・シャフト）。ロックを優先し、interfering からはロック中を除く
export function warningParts(
  scene: Scene,
  layout: Layout,
  motion: MotionState,
): { locked: Set<string>; interfering: Set<string> } {
  const locked = new Set<string>();
  const lockedShafts = new Set<string>();
  for (const lock of motion.locks) {
    for (const id of lock.gearIds) locked.add(id);
    for (const id of lock.rackIds ?? []) locked.add(id); // ラック（S3-04）
    for (const id of lock.shaftIds) {
      locked.add(id);
      lockedShafts.add(id);
    }
  }
  for (const motor of Object.values(scene.motors)) {
    if (lockedShafts.has(motor.shaftId)) locked.add(motor.id);
  }
  const interfering = new Set<string>();
  for (const pair of layout.interferences) {
    for (const id of pair) {
      if (!locked.has(id)) interfering.add(id);
    }
  }
  return { locked, interfering };
}
