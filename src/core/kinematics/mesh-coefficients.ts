import type { Mesh } from '../layout/types';
import { assertNever } from '../scene/gear-shape';
import type { Gear, Scene } from '../scene/types';

// かみ合い 1 組の拘束 c_a·ω_a + c_b·ω_b = 0 の係数（design.md §6。S2-02）。
// ω は各シャフトの軸の正の向きまわりの角速度。種類ごとの係数:
// - 外歯車同士（平歯車・ハスバ歯車）: z_a, z_b
// - かさ歯車: apex_a·z_a, apex_b·z_b（ピッチ点での周速の一致から導いた式。頂点の向きで回る向きが決まる）
// 後続（S2-03 のウォーム、S2-04 のねじ歯車、S3-02 の内歯車など）は、ここに種類を足す
export function meshCoefficients(mesh: Mesh, scene: Scene): { a: number; b: number } {
  const a = scene.gears[mesh.a];
  const b = scene.gears[mesh.b];
  if (a === undefined || b === undefined) {
    throw new Error(`かみ合いの歯車がシーンに無い: ${mesh.a}, ${mesh.b}`);
  }
  switch (mesh.kind) {
    case 'spur':
    case 'helical':
      return { a: a.teeth, b: b.teeth };
    case 'bevel':
      return { a: apexOf(a) * a.teeth, b: apexOf(b) * b.teeth };
    default:
      return assertNever(mesh.kind);
  }
}

function apexOf(gear: Gear): 1 | -1 {
  if (gear.kind !== 'bevel')
    throw new Error(`かさ歯車のかみ合いの歯車がかさ歯車でない: ${gear.id}`);
  return gear.apex;
}
