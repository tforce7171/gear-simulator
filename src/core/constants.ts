export const PRESSURE_ANGLE = (20 * Math.PI) / 180;
export const HELIX_ANGLE = (20 * Math.PI) / 180; // ハスバ歯車のねじれ角（固定。S2-01）

// faceWidth は厚さ（width）を省いた歯車・ラックの厚さの初期値（S4-05 から歯車ごとに変えられる）
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
export const MAX_SAVE_FILE_BYTES = 5 * 1024 * 1024; // 読み込める JSON ファイルの上限（5 MB。S1-28）
export const THUMBNAIL_SIZE = 256;
export const AXIAL_SNAP = 4; // mm。シャフト上の位置の吸着の単位（全サイズ共通）
// mm。歯車・ラックの厚さ（width）の範囲（S4-05）。AXIAL_SNAP 刻み
export const GEAR_WIDTH_RANGE = { min: 4, max: 32 } as const;
export const MESH_PHASE_EPS = 1e-6; // rad。位相を歯のピッチを法として比べるしきい値（contact の判定には使わない）
export const COLLISION_EPS = 1e-6; // mm。干渉の判定で、触れているだけを干渉としないための重なりの深さのしきい値
export const SHAFT_END_MARGIN = 4; // mm。シャフトを歯車の端から伸ばす長さ
export const EMPTY_SHAFT_HALF_LENGTH = 10; // mm。歯車の無いシャフトの長さの半分
export const PERIMETER_CANDIDATE_COUNT = 8; // 外周の候補の方向の数（45° 刻み。S1-10）
export const HISTORY_LIMIT = 100; // Undo の履歴に残すシーンの数の上限（S1-11）
export const DEFAULT_TEETH = { S: 30, M: 20, L: 16 } as const; // 新しく置く・生やす歯車の歯数（S1-17）
export const GRID_SNAP = 5; // mm。起点のシャフトの床上の位置と高さの吸着の単位（S1-17）
export const BEVEL_APEX_CLEARANCE = 2; // mm。かさ歯車が載るシャフトの頂点側の端を、頂点のこの距離だけ手前で切る（S2-02）
// ウォームギア（S2-03）。ウォームは 1 条・右ねじ（固定）。ピッチ円直径 = WORM_DIAMETER_FACTOR·m（進み角 atan(1/10)）、
// 歯のある部分の長さ = WORM_LENGTH_PITCHES·π·m（軸方向ピッチ π·m の 5 つ分）
export const WORM_THREADS = 1;
export const WORM_DIAMETER_FACTOR = 10;
export const WORM_LENGTH_PITCHES = 5;
// ねじ歯車（S2-04）のねじれ角。向きは右（固定）。同じねじれ角・同じ向きの 2 枚が、軸の角度 90°（45° + 45°）でかみ合う
export const CROSSED_HELIX_ANGLE = Math.PI / 4;
// 内歯車（S3-02）。歯数は INTERNAL_MIN_TEETH 〜 大きさの最大、かみ合う外歯車との歯数差は INTERNAL_MIN_TOOTH_DIFF 以上。
// ウェブ（カップの底の円板）はリングの片側の面から INTERNAL_WEB_GAP 離れた位置にあり、軸方向に INTERNAL_WEB_THICKNESS を占める
// （円板とボス。AXIAL_SNAP の倍数にして、同じ軸に並べたときも 4 mm の格子に乗せる）。
// INTERNAL_WEB_GAP は SHAFT_END_MARGIN より大きくする（内側の歯車のシャフトの端がウェブに当たらないように）
export const INTERNAL_MIN_TEETH = 24;
export const INTERNAL_MIN_TOOTH_DIFF = 12;
export const INTERNAL_WEB_GAP = 8;
export const INTERNAL_WEB_THICKNESS = 4;

// 遊星歯車（S3-03）
export const PLANET_COUNT_RANGE = { min: 1, max: 6 } as const; // 1 つのキャリアの遊星の数
export const DEFAULT_PLANET_COUNT = 3; // 候補から作る遊星の数
export const PLANET_MIN_TEETH = 12; // 候補から作る遊星の歯数の最小
// キャリアの板の厚み（大きさごと。AXIAL_SNAP の倍数）
export const CARRIER_THICKNESS = { S: 4, M: 4, L: 8 } as const;
// 太陽歯車の歯幅の正側の面から、キャリアの板の負側の面までの隙間（AXIAL_SNAP の倍数）。遊星のシャフトの端の余白
// SHAFT_END_MARGIN と同じにし、遊星のシャフトがちょうど板に届き、遊星・太陽の歯車が板に当たらないようにする
export const CARRIER_GAP = 4;
// キャリアの腕の半径 = 公転半径 + この余白（遊星のシャフトの太さの分）
export const CARRIER_RADIUS_MARGIN = 4;

// ラック＆ピニオン（S3-04）。ラックの長さ L = 歯数 × π·m。断面は歯幅 × (歯先から背まで 4.25m)
// （歯先はピッチ線から m、歯底はピッチ線から 1.25m、背は歯底から 2m）
export const RACK_TEETH = { min: 10, max: 60 } as const; // ラックの歯数の範囲
export const RACK_DEFAULT_TEETH = 30; // 候補から作るラックの歯数
export const RACK_ADDENDUM = 1; // 歯先の高さ（m の倍数）
export const RACK_DEDENDUM = 1.25; // 歯底の深さ（m の倍数）
export const RACK_BACK = 2; // 歯底から背までの厚み（m の倍数）
// 端の余白 = RACK_END_MARGIN_PITCHES·π·m（1 ピッチ）。ピニオンの接点がラックの端からこの距離に来たら端とする
export const RACK_END_MARGIN_PITCHES = 1;
// ラックの変位 s が端にいるとみなす許容（mm）
export const RACK_END_EPS = 1e-6;
