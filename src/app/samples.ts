import type { MessageKey } from '../core/i18n';
import type { Scene } from '../core/scene/types';

// 作品一覧から開ける見本（S5-05）。保存した作品とは別に、作品一覧のダイアログの「見本」に並ぶ。
// 開くと replaceScene で読み込む（Undo で開く前のシーンに戻せる）。保存した作品ではないので、今の作品はなしにする

export interface Sample {
  readonly id: string;
  readonly nameKey: MessageKey; // 見本の名前
  readonly descriptionKey: MessageKey; // ひとことの説明
  readonly scene: Scene;
}

// ラック往復（S5-05）。e2e/fixtures/rack-reciprocation.json と同じもの。
// 同じ軸 shaft_s に欠け歯車 A（gear_a、39 歯のうち 8 歯）と B（gear_b、13 歯のうち 8 歯）。A はラックを直接、
// B は中間歯車（gear_idler、13 歯）を介して逆向きに送る（A ＝ B ＋ 2 × 中間）。ラックの厚さ 14 mm で A と中間歯車の両方にかかる
export const rackReciprocationScene: Scene = {
  shafts: {
    shaft_s: {
      id: 'shaft_s',
      placement: {
        kind: 'root',
        origin: [0, 40, 0],
        axis: 'z',
      },
      span: [-4, 16],
    },
    shaft_idler: {
      id: 'shaft_idler',
      placement: {
        kind: 'mesh',
        parentGearId: 'gear_b',
        childGearId: 'gear_idler',
        angle: 4.71238898038469,
      },
      span: [-4, 8],
    },
  },
  gears: {
    gear_a: {
      id: 'gear_a',
      kind: 'spur',
      shaftId: 'shaft_s',
      size: 'S',
      teeth: 39,
      offset: 0,
      toothCount: 8,
      toothStart: 5,
    },
    gear_b: {
      id: 'gear_b',
      kind: 'spur',
      shaftId: 'shaft_s',
      size: 'S',
      teeth: 13,
      offset: 8,
      toothCount: 8,
      toothStart: 6,
    },
    gear_idler: {
      id: 'gear_idler',
      kind: 'spur',
      shaftId: 'shaft_idler',
      size: 'S',
      teeth: 13,
      offset: 0,
    },
  },
  motors: {
    motor_s: {
      id: 'motor_s',
      shaftId: 'shaft_s',
      size: 'S',
      rpm: 60,
      direction: 1,
      on: true,
    },
  },
  anchors: {},
  carriers: {},
  racks: {
    rack_r: {
      id: 'rack_r',
      size: 'S',
      teeth: 30,
      placement: {
        kind: 'pinion',
        gearId: 'gear_a',
        axisStep: 1,
        normalSign: 1,
      },
      width: 14,
    },
  },
};

export const SAMPLES: readonly Sample[] = [
  {
    id: 'rackReciprocation',
    nameKey: 'samples.rackReciprocation',
    descriptionKey: 'samples.rackReciprocation.description',
    scene: rackReciprocationScene,
  },
];
