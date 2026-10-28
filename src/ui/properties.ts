// プロパティパネルの中身（S1-20、要件 §3.2・§3.3・§5）。選んでいる歯車・シャフトの設定と、そのシャフトの
// モーターの欄を組み立てる。選択・シーン（Undo を含む）・言語が変わるたびに作り直す。
// 歯車は種類の名前と、種類ごとの表示（ハスバのねじれの向き、かさ歯車の注記と向きの反転、ウォームの条数。S2-05）を出す。
// 固定具（S3-01）は「固定する」のチェック（addAnchor・removeAnchor。歯車ならそのシャフトを固定する）。
// 設定の変更はすべて編集コマンド（setGearTeeth・flipBevelApex・addMotor・updateMotor・removeMotor）で行い、
// 1 回の確定を 1 回のコマンド（Undo 1 回）にする。値が変わらない確定ではコマンドを出さない
import { onLanguageChange, t } from '../app/i18n';
import type { AppAction, AppState } from '../app/store';
import { MOTOR_RPM_RANGE } from '../core/constants';
import type { Command } from '../core/edit/commands';
import { teethRange } from '../core/geometry/dimensions';
import type { MessageKey, MessageParams } from '../core/i18n';
import type { Layout } from '../core/layout/types';
import { anchorOfShaft, planetShaftsOf } from '../core/scene/scene';
import type { Axis, Gear, Motor, Scene, ShaftId, SizeKey } from '../core/scene/types';
import { h } from './dom';
import { parseClampedInt } from './number-input';
import './properties.css';

export const PROPERTY_SIZES: readonly SizeKey[] = ['S', 'M', 'L'];

export interface PropertiesDeps {
  // UiShell.properties.setContent
  readonly setContent: (content: HTMLElement | null) => void;
  readonly getState: () => Pick<AppState, 'scene' | 'selection'>;
  readonly getLayout: (scene: Scene) => Layout;
  readonly dispatch: (action: AppAction) => void;
}

export interface Properties {
  // ストアが変わったら呼ぶ。選択・シーンが前回と同じなら何もしない
  refresh(): void;
  dispose(): void;
}

const AXIS_KEYS: Readonly<Record<Axis, MessageKey>> = {
  x: 'properties.axis.x',
  y: 'properties.axis.y',
  z: 'properties.axis.z',
};

export function motorOnShaft(scene: Scene, shaftId: ShaftId): Motor | undefined {
  return Object.values(scene.motors).find((m) => m.shaftId === shaftId);
}

function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  key: MessageKey,
  params?: MessageParams,
  testId?: string,
): HTMLElementTagNameMap[K] {
  const el = h(tag, className, testId);
  el.textContent = t(key, params);
  return el;
}

function button(className: string, testId: string, label: string, tooltip?: string) {
  const el = h('button', `gs-prop__button ${className}`, testId);
  el.type = 'button';
  el.textContent = label;
  if (tooltip !== undefined) {
    el.title = tooltip;
    el.setAttribute('aria-label', tooltip);
  }
  return el;
}

// 項目名と値の 1 行
function row(labelKey: MessageKey, ...value: HTMLElement[]): HTMLElement {
  const el = h('div', 'gs-prop__row');
  el.append(text('span', 'gs-prop__label', labelKey), ...value);
  return el;
}

export function createProperties(deps: PropertiesDeps): Properties {
  let shown: { scene: Scene; selection: string | null } | null = null;
  // 作り直している間は、取り除いた入力欄の blur で確定しない
  let building = false;

  const command = (c: Command): void => {
    deps.dispatch({ type: 'command', command: c });
  };

  // 数値の入力欄: Enter かフォーカスが外れたときに確定する（Enter はフォーカスを外して確定する）。
  // 小数は四捨五入、範囲外は端に丸め、数でなければ元の値に戻す
  function numberField(
    testId: string,
    value: number,
    min: number,
    max: number,
    labelKey: MessageKey,
    commit: (next: number) => void,
  ): HTMLInputElement {
    const input = h('input', 'gs-prop__number', testId);
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.value = String(value);
    input.setAttribute('aria-label', t(labelKey));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = String(value);
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      if (building) return;
      const next = parseClampedInt(input.value, min, max);
      input.value = String(value);
      if (next === null || next === value) return;
      commit(next);
    });
    return input;
  }

  function gearSection(scene: Scene, gear: Gear): HTMLElement {
    const section = h('section', 'gs-prop__section');
    section.append(text('h3', 'gs-prop__heading', 'properties.gear', undefined, 'prop-heading'));
    const kind = text('span', 'gs-prop__value', `gearKind.${gear.kind}`, undefined, 'prop-kind');
    kind.dataset.kind = gear.kind;
    section.append(
      row('properties.kind', kind),
      row(
        'properties.size',
        text('span', 'gs-prop__value', `properties.size.${gear.size}`, undefined, 'prop-size'),
      ),
    );
    // 種類ごとの表示（S2-05）
    if (gear.kind === 'helical') {
      // ねじれの向きは表示だけ（外周の子は親の逆、同じ軸は右ねじれで決まる）
      const hand = text(
        'span',
        'gs-prop__value',
        `properties.hand.${gear.hand}`,
        undefined,
        'prop-hand',
      );
      hand.dataset.hand = gear.hand;
      section.append(row('properties.hand', hand));
    }
    if (gear.kind === 'worm') {
      // ウォームは 1 条で、歯数（条数）は変えられない（setGearTeeth は notAllowed。S2-03）
      section.append(
        row(
          'properties.threads',
          text('span', 'gs-prop__value', 'properties.worm.threads', undefined, 'prop-worm-threads'),
        ),
        text('span', 'gs-prop__hint', 'properties.worm.note'),
      );
      return section;
    }
    // 歯数の範囲は種類で決まる（内歯車は INTERNAL_MIN_TEETH から。S3-02）
    const { min, max } = teethRange(gear.kind, gear.size);
    const setTeeth = (teeth: number): void =>
      command({ type: 'setGearTeeth', gearId: gear.id, teeth });
    const dec = button('gs-prop__step', 'prop-teeth-dec', '−', t('properties.teeth.dec'));
    dec.disabled = gear.teeth <= min;
    dec.addEventListener('click', () => setTeeth(Math.max(min, gear.teeth - 1)));
    const inc = button('gs-prop__step', 'prop-teeth-inc', '+', t('properties.teeth.inc'));
    inc.disabled = gear.teeth >= max;
    inc.addEventListener('click', () => setTeeth(Math.min(max, gear.teeth + 1)));
    const input = numberField('prop-teeth', gear.teeth, min, max, 'properties.teeth', setTeeth);
    const stepper = h('div', 'gs-prop__stepper');
    stepper.append(dec, input, inc);
    const range = text('span', 'gs-prop__hint', 'properties.teeth.range', { min, max });
    section.append(row('properties.teeth', stepper), range);
    if (gear.kind === 'bevel') {
      // 歯数は木の親子のかさ歯車がまとめて変わる（setGearTeeth。S2-02）。向きの反転は flipBevelApex で、
      // bevel のシャフトの子（apex は −side で決まる）は notAllowed なのでボタンを無効にする
      section.append(
        text('p', 'gs-prop__hint', 'properties.bevel.note', undefined, 'prop-bevel-note'),
      );
      const placement = scene.shafts[gear.shaftId]?.placement;
      const fixed = placement?.kind === 'bevel' && placement.childGearId === gear.id;
      const flip = button(
        'gs-prop__toggle',
        'prop-bevel-flip',
        t('properties.bevel.flip'),
        t(fixed ? 'properties.bevel.flip.disabled' : 'properties.bevel.flip.tooltip'),
      );
      flip.dataset.apex = String(gear.apex);
      flip.disabled = fixed;
      flip.addEventListener('click', () => command({ type: 'flipBevelApex', gearId: gear.id }));
      section.append(flip);
    }
    return section;
  }

  function shaftSection(scene: Scene, shaftId: ShaftId): HTMLElement {
    const section = h('section', 'gs-prop__section');
    section.append(text('h3', 'gs-prop__heading', 'properties.shaft', undefined, 'prop-heading'));
    const axis = deps.getLayout(scene).shafts[shaftId]?.axis;
    if (axis !== undefined) {
      section.append(
        row(
          'properties.axis',
          text('span', 'gs-prop__value', AXIS_KEYS[axis], undefined, 'prop-shaft-axis'),
        ),
        text('span', 'gs-prop__hint', 'properties.axis.hint'),
      );
    }
    return section;
  }

  // 大きさの選択（小・中・大）。押すと onPick
  function sizeGroup(
    prefix: string,
    current: SizeKey | null,
    tooltip: (size: SizeKey) => string | undefined,
    onPick: (size: SizeKey) => void,
  ): HTMLElement {
    const group = h('div', 'gs-prop__sizes');
    if (current !== null) group.setAttribute('role', 'radiogroup');
    for (const size of PROPERTY_SIZES) {
      const b = button('gs-prop__size', `${prefix}-${size}`, t(`properties.size.${size}`));
      const tip = tooltip(size);
      if (tip !== undefined) {
        b.title = tip;
        b.setAttribute('aria-label', tip);
      }
      if (current !== null) {
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(size === current));
        b.classList.toggle('is-selected', size === current);
      }
      b.addEventListener('click', () => onPick(size));
      group.append(b);
    }
    return group;
  }

  function motorSection(scene: Scene, shaftId: ShaftId): HTMLElement {
    const section = h('section', 'gs-prop__section', 'prop-motor');
    section.append(
      text('h3', 'gs-prop__heading', 'properties.motor', undefined, 'prop-motor-heading'),
    );
    const motor = motorOnShaft(scene, shaftId);
    if (motor === undefined) {
      section.append(
        text('p', 'gs-prop__hint', 'properties.motor.none'),
        row(
          'properties.motor.add',
          sizeGroup(
            'prop-motor-add',
            null,
            (size) => t(`properties.motor.add.${size}`),
            (size) => command({ type: 'addMotor', shaftId, size }),
          ),
        ),
      );
      return section;
    }
    const update = (patch: Extract<Command, { type: 'updateMotor' }>['patch']): void =>
      command({ type: 'updateMotor', motorId: motor.id, patch });

    const size = sizeGroup(
      'prop-motor-size',
      motor.size,
      () => undefined,
      (next) => {
        if (next !== motor.size) update({ size: next });
      },
    );

    // rpm: スライダーは離したとき（change）に確定し、動かしている間（input）は数値の表示だけ変える
    const { min, max } = MOTOR_RPM_RANGE;
    const setRpm = (rpm: number): void => update({ rpm });
    const rpmInput = numberField(
      'prop-motor-rpm',
      motor.rpm,
      min,
      max,
      'properties.motor.rpm',
      setRpm,
    );
    const slider = h('input', 'gs-prop__slider', 'prop-motor-rpm-slider');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = '1';
    slider.value = String(motor.rpm);
    slider.setAttribute('aria-label', t('properties.motor.rpm'));
    slider.addEventListener('input', () => {
      rpmInput.value = slider.value;
    });
    slider.addEventListener('change', () => {
      const next = parseClampedInt(slider.value, min, max);
      if (next === null || next === motor.rpm) {
        rpmInput.value = String(motor.rpm);
        return;
      }
      setRpm(next);
    });
    const rpm = h('div', 'gs-prop__rpm');
    rpm.append(slider, rpmInput);

    const direction = button(
      'gs-prop__toggle',
      'prop-motor-direction',
      t(
        motor.direction === 1
          ? 'properties.motor.direction.forward'
          : 'properties.motor.direction.reverse',
      ),
    );
    direction.dataset.direction = String(motor.direction);
    direction.addEventListener('click', () =>
      update({ direction: motor.direction === 1 ? -1 : 1 }),
    );

    const power = button(
      'gs-prop__toggle',
      'prop-motor-on',
      t(motor.on ? 'properties.motor.on' : 'properties.motor.off'),
    );
    power.setAttribute('aria-pressed', String(motor.on));
    power.classList.toggle('is-on', motor.on);
    power.addEventListener('click', () => update({ on: !motor.on }));

    const remove = button('gs-prop__remove', 'prop-motor-remove', t('properties.motor.remove'));
    remove.addEventListener('click', () => command({ type: 'removeMotor', motorId: motor.id }));

    section.append(
      row('properties.motor.size', size),
      row('properties.motor.rpm'),
      rpm,
      row('properties.motor.direction', direction),
      row('properties.motor.power', power),
      remove,
    );
    return section;
  }

  // 固定具（S3-01）: 「固定する」のチェック。歯車を選んでいるときは、そのシャフトを固定する旨を出す
  function anchorSection(scene: Scene, shaftId: ShaftId, forGear: boolean): HTMLElement {
    const section = h('section', 'gs-prop__section', 'prop-anchor');
    section.append(text('h3', 'gs-prop__heading', 'properties.anchor'));
    const anchor = anchorOfShaft(scene, shaftId);
    const label = h('label', 'gs-prop__check');
    const check = h('input', 'gs-prop__checkbox', 'prop-anchor-check');
    check.type = 'checkbox';
    check.checked = anchor !== null;
    check.addEventListener('change', () => {
      if (check.checked) command({ type: 'addAnchor', shaftId });
      else if (anchor !== null) command({ type: 'removeAnchor', anchorId: anchor.id });
    });
    label.append(check, text('span', 'gs-prop__check-label', 'properties.anchor.check'));
    section.append(label);
    if (forGear) {
      section.append(
        text('p', 'gs-prop__hint', 'properties.anchor.gearNote', undefined, 'prop-anchor-note'),
      );
    }
    return section;
  }

  // キャリア（S3-03）: 遊星の数の表示と、固定（キャリアのシャフトを固定する）
  function carrierSection(scene: Scene, carrierId: string): HTMLElement {
    const section = h('section', 'gs-prop__section');
    section.append(text('h3', 'gs-prop__heading', 'properties.carrier', undefined, 'prop-heading'));
    const count = planetShaftsOf(scene, carrierId).length;
    section.append(
      row(
        'properties.carrier.planets',
        text('span', 'gs-prop__value', 'properties.carrier.planetCount', { count }, 'prop-planets'),
      ),
    );
    return section;
  }

  // 遊星のシャフト（S3-03）は公転するので、モーターと固定具の欄を出さない
  const isPlanetShaft = (scene: Scene, shaftId: string): boolean =>
    scene.shafts[shaftId]?.placement.kind === 'planet';

  function build(scene: Scene, selection: string | null): HTMLElement | null {
    if (selection === null) return null;
    const content = h('div', 'gs-prop', 'prop-content');
    const gear = scene.gears[selection];
    if (gear !== undefined) {
      content.append(gearSection(scene, gear));
      if (!isPlanetShaft(scene, gear.shaftId)) {
        content.append(motorSection(scene, gear.shaftId), anchorSection(scene, gear.shaftId, true));
      }
      return content;
    }
    if (scene.shafts[selection] !== undefined) {
      content.append(shaftSection(scene, selection));
      if (!isPlanetShaft(scene, selection)) {
        content.append(motorSection(scene, selection), anchorSection(scene, selection, false));
      }
      return content;
    }
    const carrier = scene.carriers[selection];
    if (carrier !== undefined) {
      content.append(
        carrierSection(scene, carrier.id),
        motorSection(scene, carrier.shaftId),
        anchorSection(scene, carrier.shaftId, false),
      );
      return content;
    }
    return null;
  }

  let current: HTMLElement | null = null;

  function render(): void {
    const { scene, selection } = deps.getState();
    shown = { scene, selection };
    // フォーカスのあった要素（ボタンなど）は、作り直した後の同じ要素に戻す
    const active = document.activeElement;
    const focusedId =
      current !== null && active instanceof HTMLElement && current.contains(active)
        ? active.dataset.testid
        : undefined;
    building = true;
    try {
      current = build(scene, selection);
      deps.setContent(current);
    } finally {
      building = false;
    }
    if (focusedId !== undefined && current !== null) {
      const next = current.querySelector<HTMLElement>(`[data-testid="${focusedId}"]`);
      if (next !== null && !(next instanceof HTMLButtonElement && next.disabled)) next.focus();
    }
  }

  const offLanguage = onLanguageChange(render);
  render();

  return {
    refresh() {
      const { scene, selection } = deps.getState();
      if (shown !== null && shown.scene === scene && shown.selection === selection) return;
      render();
    },
    dispose() {
      offLanguage();
      deps.setContent(null);
    },
  };
}
