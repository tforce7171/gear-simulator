import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GEAR_SIZES, SHAFT_END_MARGIN } from '../core/constants';
import type { MotionState } from '../core/kinematics/types';
import type { Vec3 } from '../core/math/vec3';
import type { Axis, ShaftId, SizeKey } from '../core/scene/types';
import { placeOnAxis } from './frame';
import type { GeometryCache } from './gear-geometry';
import { setPickTarget } from './picking';

// 生やす候補の仮の歯車の表示（S1-18）。形状データは本物の歯車と同じ共有のもの（GeometryCache）を使い、
// 材質だけ半透明の水色にする。外周の候補には仮のシャフトも付ける。
// Renderer.pickRoot に足し、setPickTarget(object, 'candidate', '<index>') の印を付ける

const CANDIDATE_COLOR = 0x8fd8ff;
const CANDIDATE_OPACITY = 0.3;
const CANDIDATE_HOVER_OPACITY = 0.7;
const CANDIDATE_HOVER_EMISSIVE = 0x2a8fd0;
const SHAFT_RADIUS = 1.5; // render/sync.ts の本物のシャフトと同じ
// 半透明の部品は不透明な部品の後に描く。ハンドル（10〜）より先
const CANDIDATE_RENDER_ORDER = 5;

// 1 つの候補の見た目
export interface CandidateSpec {
  readonly size: SizeKey;
  readonly teeth: number;
  readonly center: Vec3; // 仮の歯車の中心（ワールド座標）
  readonly axis: Axis;
  readonly phase: number; // followShaftId の回転角が 0 のときの歯車の回転のずれ（basePhase と同じ意味）
  // 回転を合わせるシャフトと比: 歯車の回転角 = phase + followRatio × そのシャフトの回転角。
  // 外周は親のシャフトに −(親の歯数 / 子の歯数)、同じ軸は親のシャフトに 1
  readonly followShaftId: ShaftId;
  readonly followRatio: number;
  readonly withShaft: boolean; // 仮のシャフトも描く（外周の候補）
}

// 候補のピッキングの ID（一覧の中の番号）
export function candidatePickId(index: number): string {
  return String(index);
}

export interface CandidateView {
  readonly root: Group;
  // 出す候補と、マウスを乗せた候補の番号。同じ一覧（参照）なら作り直さず、濃さだけ変える
  set(candidates: readonly CandidateSpec[], hovered: number | null): void;
  // 毎フレーム、親のシャフトの回転に合わせて回す
  update(motion: MotionState): void;
}

interface Entry {
  spec: CandidateSpec;
  group: Group;
  body: Mesh;
  shaft: Mesh | null;
}

function material(opacity: number, emissive: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: CANDIDATE_COLOR,
    emissive,
    metalness: 0.1,
    roughness: 0.6,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

export function createCandidateView(cache: GeometryCache): CandidateView {
  const root = new Group();
  const normal = material(CANDIDATE_OPACITY, 0x000000);
  const hover = material(CANDIDATE_HOVER_OPACITY, CANDIDATE_HOVER_EMISSIVE);
  let entries: Entry[] = [];
  let current: readonly CandidateSpec[] = [];

  function clear(): void {
    for (const entry of entries) {
      root.remove(entry.group);
      cache.release('spur', entry.spec.size, entry.spec.teeth);
      entry.shaft?.geometry.dispose();
    }
    entries = [];
  }

  function build(spec: CandidateSpec, index: number): Entry {
    const group = new Group();
    const body = new Mesh(cache.acquire('spur', spec.size, spec.teeth), normal);
    body.renderOrder = CANDIDATE_RENDER_ORDER;
    body.rotation.z = spec.phase;
    group.add(body);
    let shaft: Mesh | null = null;
    if (spec.withShaft) {
      // mesh のシャフトの子は offset 0 なので、シャフトの区間は歯車の中心について対称
      const length = GEAR_SIZES[spec.size].faceWidth + 2 * SHAFT_END_MARGIN;
      const geometry = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, length, 12);
      geometry.rotateX(Math.PI / 2); // 円柱の向きをローカルの z（= 軸 w）にする
      shaft = new Mesh(geometry, normal);
      shaft.renderOrder = CANDIDATE_RENDER_ORDER;
      group.add(shaft);
    }
    placeOnAxis(group, spec.center, spec.axis);
    setPickTarget(group, 'candidate', candidatePickId(index));
    root.add(group);
    return { spec, group, body, shaft };
  }

  return {
    root,
    set(candidates, hovered) {
      if (candidates !== current) {
        clear();
        current = candidates;
        entries = candidates.map(build);
      }
      entries.forEach((entry, i) => {
        const m = i === hovered ? hover : normal;
        entry.body.material = m;
        if (entry.shaft !== null) entry.shaft.material = m;
      });
    },
    update(motion) {
      for (const { spec, body } of entries) {
        const angle = motion.angles[spec.followShaftId] ?? 0;
        body.rotation.z = spec.phase + spec.followRatio * angle;
      }
    },
  };
}
