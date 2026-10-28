import {
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector2,
} from 'three';
import { GEAR_SIZES, INTERNAL_WEB_GAP, SHAFT_END_MARGIN } from '../core/constants';
import { sectionWidth } from '../core/geometry/dimensions';
import { internalRimRadius, internalTipRadius } from '../core/geometry/internal';
import type { MotionState } from '../core/kinematics/types';
import type { Vec3 } from '../core/math/vec3';
import type { Axis, GearShape, RackId, ShaftId, SizeKey } from '../core/scene/types';
import { placeOnAxis } from './frame';
import { type GeometryCache, gearBodyScaleZ } from './gear-geometry';
import { setPickTarget } from './picking';
import { buildRackGeometry, placeRack } from './rack';

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
  readonly shape: GearShape; // 種類と形を変える属性（S2-01。形状データのキーに使う）
  readonly size: SizeKey;
  readonly teeth: number;
  readonly center: Vec3; // 仮の歯車の中心（ワールド座標）
  readonly axis: Axis;
  readonly phase: number; // followShaftId の回転角が 0 のときの歯車の回転のずれ（basePhase と同じ意味）
  // 回転を合わせるシャフトと比: 歯車の回転角 = phase + followRatio × そのシャフトの回転角。
  // 外周は親のシャフトに −(親の歯数 / 子の歯数)、同じ軸は親のシャフトに 1
  readonly followShaftId: ShaftId;
  readonly followRatio: number;
  // ラックの変位 s（mm）に合わせて回す（S3-04 のラックに載せるピニオン）: 回転角 = phase + followRatio × s。
  // あれば followShaftId より優先する
  readonly followRackId?: RackId;
  // ラックの候補（S3-04）。本体を仮のラック（size・teeth のラック）にする。center は基準位置、axis は動く向き。止めたまま見せる
  readonly rack?: {
    readonly normal: Axis;
    readonly normalSign: 1 | -1;
    readonly grooveOffset: number;
  };
  readonly withShaft: boolean; // 仮のシャフトも描く（外周の候補）
  // 遊星歯車機構の候補（S3-03）。本体はリング（歯を省いた輪。ウェブは描かず、太陽の上のクリックを奪わない）で、
  // 遊星を選べない仮の歯車として添える
  readonly planets?: {
    readonly teeth: number;
    readonly items: ReadonlyArray<{ readonly center: Vec3; readonly phase: number }>;
  };
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
  extras: Group | null; // 選べない添えもの（遊星歯車機構のリングの輪と遊星。S3-03）
  proxy: Mesh | null; // 見えない当たり判定（遊星歯車機構。S3-03）
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
  // 当たり判定だけの形（描かないがレイキャストには当たる。外向きの面だけ）
  const pickProxyMaterial = new MeshBasicMaterial({ visible: false });
  let entries: Entry[] = [];
  let current: readonly CandidateSpec[] = [];

  function clear(): void {
    for (const entry of entries) {
      root.remove(entry.group);
      if (entry.spec.rack !== undefined) {
        entry.body.geometry.dispose();
      } else if (entry.spec.planets === undefined) {
        cache.release(entry.spec.shape, entry.spec.size, entry.spec.teeth);
      } else {
        entry.body.geometry.dispose();
      }
      entry.shaft?.geometry.dispose();
      entry.proxy?.geometry.dispose();
      if (entry.extras !== null) {
        root.remove(entry.extras);
        for (const _ of entry.spec.planets?.items ?? []) {
          cache.release({ kind: 'spur' }, entry.spec.size, entry.spec.planets?.teeth ?? 0);
        }
      }
    }
    entries = [];
  }

  // 遊星歯車機構の候補（S3-03）: リングを歯を省いた輪（内側 R − m、外側 R + 3.25m、歯幅）と、ウェブの側へ伸びる
  // つなぎの筒（R + 2.25m 〜 R + 3.25m、INTERNAL_WEB_GAP）で描く。ウェブの円板は描かない（太陽の下に入って、
  // 太陽のクリックを奪うため）。輪は外周の候補と同じ面で重なるので、描くだけで選べなくし、押す所は筒と輪の外側の壁
  // （外向きの面だけの見えない円筒。pickProxyGeometry）にする
  function ringGeometry(spec: CandidateSpec): LatheGeometry {
    const inner = internalTipRadius(spec.size, spec.teeth);
    const outer = internalRimRadius(spec.size, spec.teeth);
    const tube = outer - GEAR_SIZES[spec.size].module;
    const half = GEAR_SIZES[spec.size].faceWidth / 2;
    const bottom = -half - INTERNAL_WEB_GAP;
    const geometry = new LatheGeometry(
      [
        new Vector2(inner, -half),
        new Vector2(tube, -half),
        new Vector2(tube, bottom),
        new Vector2(outer, bottom),
        new Vector2(outer, half),
        new Vector2(inner, half),
        new Vector2(inner, -half),
      ],
      64,
    );
    // 回転の軸（ローカルの y）をローカルの z（= 軸 w）にする。webSide −1 なので筒は −z の側
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }

  // 遊星歯車機構の候補の押す所: 輪と筒の外側の壁（外向きの面だけ。内側から当たらない）
  function pickProxyGeometry(spec: CandidateSpec): CylinderGeometry {
    const outer = internalRimRadius(spec.size, spec.teeth);
    const half = GEAR_SIZES[spec.size].faceWidth / 2;
    const length = 2 * half + INTERNAL_WEB_GAP;
    const geometry = new CylinderGeometry(outer, outer, length, 48, 1, true);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, half - length / 2);
    return geometry;
  }

  function build(spec: CandidateSpec, index: number): Entry {
    const group = new Group();
    if (spec.rack !== undefined) {
      // ラックの候補（S3-04）
      const body = new Mesh(buildRackGeometry(spec.size, spec.teeth), normal);
      body.renderOrder = CANDIDATE_RENDER_ORDER;
      group.add(body);
      const at: Vec3 = [
        spec.center[0] + (spec.axis === 'x' ? spec.rack.grooveOffset : 0),
        spec.center[1] + (spec.axis === 'y' ? spec.rack.grooveOffset : 0),
        spec.center[2] + (spec.axis === 'z' ? spec.rack.grooveOffset : 0),
      ];
      placeRack(group, at, spec.axis, spec.rack.normal, spec.rack.normalSign);
      setPickTarget(group, 'candidate', candidatePickId(index));
      root.add(group);
      return { spec, group, body, shaft: null, proxy: null, extras: null };
    }
    const body = new Mesh(
      spec.planets === undefined
        ? cache.acquire(spec.shape, spec.size, spec.teeth)
        : ringGeometry(spec),
      normal,
    );
    body.renderOrder = CANDIDATE_RENDER_ORDER;
    if (spec.planets === undefined) body.scale.z = gearBodyScaleZ(spec.shape);
    body.rotation.z = spec.phase;
    let extras: Group | null = null;
    let proxy: Mesh | null = null;
    if (spec.planets === undefined) {
      group.add(body);
    } else {
      extras = new Group();
      const ring = new Group();
      ring.add(body);
      placeOnAxis(ring, spec.center, spec.axis);
      extras.add(ring);
      proxy = new Mesh(pickProxyGeometry(spec), pickProxyMaterial);
      group.add(proxy);
      for (const item of spec.planets.items) {
        const planet = new Mesh(
          cache.acquire({ kind: 'spur' }, spec.size, spec.planets.teeth),
          normal,
        );
        planet.renderOrder = CANDIDATE_RENDER_ORDER;
        const pivot = new Group();
        pivot.add(planet);
        planet.rotation.z = item.phase;
        placeOnAxis(pivot, item.center, spec.axis);
        extras.add(pivot);
      }
      root.add(extras);
    }
    let shaft: Mesh | null = null;
    if (spec.withShaft) {
      // mesh のシャフトの子は offset 0 なので、シャフトの区間は歯車の中心について対称
      const length =
        sectionWidth({ kind: spec.shape.kind, size: spec.size }) + 2 * SHAFT_END_MARGIN;
      const geometry = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, length, 12);
      geometry.rotateX(Math.PI / 2); // 円柱の向きをローカルの z（= 軸 w）にする
      shaft = new Mesh(geometry, normal);
      shaft.renderOrder = CANDIDATE_RENDER_ORDER;
      group.add(shaft);
    }
    placeOnAxis(group, spec.center, spec.axis);
    setPickTarget(group, 'candidate', candidatePickId(index));
    root.add(group);
    return { spec, group, body, shaft, proxy, extras };
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
        if (spec.rack !== undefined) continue;
        const angle =
          spec.followRackId !== undefined
            ? (motion.rackPositions[spec.followRackId] ?? 0)
            : (motion.angles[spec.followShaftId] ?? 0);
        body.rotation.z = spec.phase + spec.followRatio * angle;
      }
    },
  };
}
