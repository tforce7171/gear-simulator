import { skewSign } from '../geometry/skew';
import { resolveLayout } from '../layout/resolve';
import type { Mesh, RackMesh } from '../layout/types';
import { axisVector } from '../math/axis';
import { cross, dot, scale } from '../math/vec3';
import { assertNever } from '../scene/gear-shape';
import type { Axis, Gear, Scene, ShaftId } from '../scene/types';

// かみ合い 1 組の拘束 c_a·ω_a + c_b·ω_b = 0 の係数（design.md §6。S2-02）。
// ω は各シャフトの軸の正の向きまわりの角速度。種類ごとの係数:
// - 外歯車同士（平歯車・ハスバ歯車）: z_a, z_b
// - かさ歯車: apex_a·z_a, apex_b·z_b（ピッチ点での周速の一致から導いた式。頂点の向きで回る向きが決まる）
// - ねじれた位置の組（S2-03 のウォームとホイール。S2-04 のねじ歯車も同じ式）: s·z_a, z_b。
//   s = (e_a × u_ab)·e_b（e は各シャフトの軸の単位ベクトル、u_ab は a の中心から b の中心への単位ベクトル。
//   a と b を入れ替えても変わらない）。ウォームの z は条数（1）。中心は resolveLayout(scene) から取る
// - 内歯車と外歯車（S3-02）: 外歯車 z_ext、内歯車 −z_int（同じ向きに回る）
// 遊星のシャフトの歯車がかかわるかみ合い（S3-03）は、この係数で相対の ω の拘束を書く（meshTerms）
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

// かみ合い 1 組の拘束の項（シャフトとその ω の係数）。c_a·ω_a + c_b·ω_b = 0 に、遊星のシャフトの歯車がかかわるかみ合い
// （mesh.carrierShaftId がある。S3-03）では、両方の ω からキャリアの ω_c を引いた相対値で書く（ウィリスの式）:
// c_a·(ω_a − ω_c) + c_b·(ω_b − ω_c) = 0。同じシャフトの項は足し合わせずに並べる（行を作る側で足す）
export function meshTerms(
  mesh: Mesh,
  scene: Scene,
): Array<{ readonly shaftId: ShaftId; readonly coef: number }> {
  const a = scene.gears[mesh.a];
  const b = scene.gears[mesh.b];
  if (a === undefined || b === undefined) {
    throw new Error(`かみ合いの歯車がシーンに無い: ${mesh.a}, ${mesh.b}`);
  }
  const { a: coefA, b: coefB } = meshCoefficients(mesh, scene);
  const terms = [
    { shaftId: a.shaftId, coef: coefA },
    { shaftId: b.shaftId, coef: coefB },
  ];
  if (mesh.carrierShaftId !== undefined) {
    if (scene.shafts[mesh.carrierShaftId] === undefined) {
      throw new Error(`かみ合いのキャリアのシャフトがシーンに無い: ${mesh.carrierShaftId}`);
    }
    terms.push({ shaftId: mesh.carrierShaftId, coef: -(coefA + coefB) });
  }
  return terms;
}

// ラックとピニオンのかみ合い（S3-04）の拘束 v − k·r·ω = 0 の項。v はラックの速度（direction の正の向き）、ω はピニオンの
// シャフトの角速度、k = (e × u)·d（e はピニオンの軸、u はピニオンの中心から接点への単位ベクトル −normalSign·normal、
// d は direction の単位ベクトル）。項のシャフトの ID の欄にはラックの ID を入れる（拘束行列の列はシャフトとラック）
export function rackMeshTerms(
  mesh: RackMesh,
  scene: Scene,
): Array<{ readonly shaftId: ShaftId; readonly coef: number }> {
  const gear = scene.gears[mesh.gear];
  if (gear === undefined || scene.racks[mesh.rack] === undefined) {
    throw new Error(`ラックのかみ合いの部品がシーンに無い: ${mesh.gear}, ${mesh.rack}`);
  }
  const layout = resolveLayout(scene);
  const g = layout.gears[mesh.gear];
  const r = layout.racks[mesh.rack];
  if (g === undefined || r === undefined) {
    throw new Error(`ラックのかみ合いの部品がレイアウトに無い: ${mesh.gear}, ${mesh.rack}`);
  }
  const k = rackSign(g.axis, r);
  return [
    { shaftId: mesh.rack, coef: 1 },
    { shaftId: gear.shaftId, coef: -k * g.pitchRadius },
  ];
}

// k = (e × u)·d（±1）。e はピニオンの軸、u = −normalSign·normal、d は direction
export function rackSign(
  pinionAxis: Axis,
  rack: { readonly direction: Axis; readonly normal: Axis; readonly normalSign: 1 | -1 },
): number {
  const u = scale(axisVector(rack.normal), -rack.normalSign);
  return Math.round(dot(cross(axisVector(pinionAxis), u), axisVector(rack.direction)));
}
