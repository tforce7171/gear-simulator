import { skewSign } from '../geometry/skew';
import { resolveLayout } from '../layout/resolve';
import type { Mesh } from '../layout/types';
import { assertNever } from '../scene/gear-shape';
import type { Gear, Scene } from '../scene/types';

// かみ合い 1 組の拘束 c_a·ω_a + c_b·ω_b = 0 の係数（design.md §6。S2-02）。
// ω は各シャフトの軸の正の向きまわりの角速度。種類ごとの係数:
// - 外歯車同士（平歯車・ハスバ歯車）: z_a, z_b
// - かさ歯車: apex_a·z_a, apex_b·z_b（ピッチ点での周速の一致から導いた式。頂点の向きで回る向きが決まる）
// - ねじれた位置の組（S2-03 のウォームとホイール。S2-04 のねじ歯車も同じ式）: s·z_a, z_b。
//   s = (e_a × u_ab)·e_b（e は各シャフトの軸の単位ベクトル、u_ab は a の中心から b の中心への単位ベクトル。
//   a と b を入れ替えても変わらない）。ウォームの z は条数（1）。中心は resolveLayout(scene) から取る
// - 内歯車と外歯車（S3-02）: 外歯車 z_ext、内歯車 −z_int（同じ向きに回る）
// 後続は、ここに種類を足す
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
    case 'worm':
    case 'crossedHelical':
      return { a: skewSignOf(mesh, scene) * a.teeth, b: b.teeth };
    case 'internal':
      // 内歯車と外歯車（S3-02）: z_ext·ω_ext − z_int·ω_int = 0（内側でかみ合うので同じ向きに回る）
      return { a: internalSign(a) * a.teeth, b: internalSign(b) * b.teeth };
    default:
      return assertNever(mesh.kind);
  }
}

// 内歯車の係数の符号。内歯車は −1、外歯車は 1
function internalSign(gear: Gear): 1 | -1 {
  return gear.kind === 'internal' ? -1 : 1;
}

function apexOf(gear: Gear): 1 | -1 {
  if (gear.kind !== 'bevel')
    throw new Error(`かさ歯車のかみ合いの歯車がかさ歯車でない: ${gear.id}`);
  return gear.apex;
}

// ねじれた位置の組の s = (e_a × u_ab)·e_b（±1）。レイアウトに無い組は例外
function skewSignOf(mesh: Mesh, scene: Scene): number {
  const layout = resolveLayout(scene);
  const la = layout.gears[mesh.a];
  const lb = layout.gears[mesh.b];
  if (la === undefined || lb === undefined) {
    throw new Error(`かみ合いの歯車がレイアウトに無い: ${mesh.a}, ${mesh.b}`);
  }
  const s = skewSign(la.axis, la.center, lb.axis, lb.center);
  return Math.sign(Math.round(s));
}
