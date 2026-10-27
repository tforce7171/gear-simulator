export const PRESSURE_ANGLE = (20 * Math.PI) / 180;

export const GEAR_SIZES = {
  S: { module: 1, faceWidth: 4, minTeeth: 12, maxTeeth: 80 },
  M: { module: 2, faceWidth: 8, minTeeth: 12, maxTeeth: 60 },
  L: { module: 3, faceWidth: 12, minTeeth: 12, maxTeeth: 40 },
} as const;

export const MOTOR_SIZES = {
  S: { stallTorque: 1, defaultRpm: 60 },
  M: { stallTorque: 3, defaultRpm: 30 },
  L: { stallTorque: 10, defaultRpm: 15 },
} as const;
export const MOTOR_RPM_RANGE = { min: 1, max: 120 } as const;

export const LOCK_OMEGA_EPS = 1e-6; // rad/s
export const MESH_DISTANCE_EPS = 1e-3; // mm。偶然のかみ合いの判定に使う
export const MAX_AUDIO_VOICES = 16;
export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const THUMBNAIL_SIZE = 256;
export const AXIAL_SNAP = 4; // mm。シャフト上の位置の吸着の単位（全サイズ共通）
export const MESH_PHASE_EPS = 1e-6; // rad。位相を歯のピッチを法として比べるしきい値（contact の判定には使わない）
export const COLLISION_EPS = 1e-6; // mm。干渉の判定で、触れているだけを干渉としないための重なりの深さのしきい値
export const SHAFT_END_MARGIN = 4; // mm。シャフトを歯車の端から伸ばす長さ
export const EMPTY_SHAFT_HALF_LENGTH = 10; // mm。歯車の無いシャフトの長さの半分
export const PERIMETER_CANDIDATE_COUNT = 8; // 外周の候補の方向の数（45° 刻み。S1-10）
export const HISTORY_LIMIT = 100; // Undo の履歴に残すシーンの数の上限（S1-11）
export const DEFAULT_TEETH = { S: 30, M: 20, L: 16 } as const; // 新しく置く・生やす歯車の歯数（S1-17）
export const GRID_SNAP = 5; // mm。起点のシャフトの床上の位置と高さの吸着の単位（S1-17）
