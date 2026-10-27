import { PANNER } from '../core/audio-model';
import type { Vec3 } from '../core/math/vec3';

// 音源を 3D に置く PannerNode と、カメラに合わせる AudioListener（S1-26）。長さは mm のまま渡す

// 位置を追いかける時定数（秒）。値を飛ばすとプツッと鳴るため
const POSITION_SMOOTHING = 0.02;

export interface Panner {
  readonly node: PannerNode;
  setPosition(position: Vec3): void;
  dispose(): void;
}

export function createPanner(
  ctx: BaseAudioContext,
  destination: AudioNode,
  position: Vec3,
): Panner {
  const node = ctx.createPanner();
  node.panningModel = PANNER.panningModel;
  node.distanceModel = PANNER.distanceModel;
  node.refDistance = PANNER.refDistance;
  node.rolloffFactor = PANNER.rolloffFactor;
  node.maxDistance = PANNER.maxDistance;
  node.positionX.value = position[0];
  node.positionY.value = position[1];
  node.positionZ.value = position[2];
  node.connect(destination);
  return {
    node,
    setPosition(p) {
      const now = ctx.currentTime;
      node.positionX.setTargetAtTime(p[0], now, POSITION_SMOOTHING);
      node.positionY.setTargetAtTime(p[1], now, POSITION_SMOOTHING);
      node.positionZ.setTargetAtTime(p[2], now, POSITION_SMOOTHING);
    },
    dispose() {
      node.disconnect();
    },
  };
}

export interface ListenerPose {
  readonly position: Vec3;
  readonly forward: Vec3; // カメラの前方向（単位ベクトル）
  readonly up: Vec3; // カメラの上方向（単位ベクトル）
}

// AudioListener をカメラに合わせる（毎フレーム）。AudioParam の無い古い実装では setPosition・setOrientation
export function applyListener(ctx: BaseAudioContext, pose: ListenerPose): void {
  const l = ctx.listener;
  const now = ctx.currentTime;
  const [px, py, pz] = pose.position;
  const [fx, fy, fz] = pose.forward;
  const [ux, uy, uz] = pose.up;
  if ('positionX' in l && l.positionX !== undefined) {
    l.positionX.setTargetAtTime(px, now, POSITION_SMOOTHING);
    l.positionY.setTargetAtTime(py, now, POSITION_SMOOTHING);
    l.positionZ.setTargetAtTime(pz, now, POSITION_SMOOTHING);
    l.forwardX.setTargetAtTime(fx, now, POSITION_SMOOTHING);
    l.forwardY.setTargetAtTime(fy, now, POSITION_SMOOTHING);
    l.forwardZ.setTargetAtTime(fz, now, POSITION_SMOOTHING);
    l.upX.setTargetAtTime(ux, now, POSITION_SMOOTHING);
    l.upY.setTargetAtTime(uy, now, POSITION_SMOOTHING);
    l.upZ.setTargetAtTime(uz, now, POSITION_SMOOTHING);
    return;
  }
  l.setPosition(px, py, pz);
  l.setOrientation(fx, fy, fz, ux, uy, uz);
}
