// パレットのアイコン（S4-08）。24×24 の SVG の文字列で、線は currentColor（ボタンの文字の色に従う）。
// 種類の表は Record にして、パレットの種類を足したときの書き忘れを型で検出する
import type { PaletteKind } from '../core/layout/candidates';
import type { SizeKey } from '../core/scene/types';

const r2 = (v: number): number => Math.round(v * 100) / 100;

function polar(cx: number, cy: number, r: number, a: number): string {
  return `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;
}

// 外歯車の輪郭（歯先の円 ro、歯底の円 ri、歯数 n）。歯は台形
function gearPath(cx: number, cy: number, ro: number, ri: number, n: number): string {
  const p = (2 * Math.PI) / n;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * p - Math.PI / 2;
    pts.push(
      polar(cx, cy, ri, a - 0.3 * p),
      polar(cx, cy, ro, a - 0.13 * p),
      polar(cx, cy, ro, a + 0.13 * p),
      polar(cx, cy, ri, a + 0.3 * p),
    );
  }
  return `M${pts.join('L')}Z`;
}

const circle = (cx: number, cy: number, r: number): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const path = (d: string): string => `<path d="${d}"/>`;

function svg(body: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
    `focusable="false">${body}</svg>`
  );
}

// 正面から見た平歯車（軸の穴つき）。大きさのアイコンにも使う
function spurBody(ro: number): string {
  const depth = Math.max(1.3, ro * 0.24);
  const teeth = Math.max(6, Math.round(ro));
  return path(gearPath(12, 12, ro, ro - depth, teeth)) + circle(12, 12, r2(ro * 0.28));
}

// 横から見た、歯すじが斜めの歯車（はすば・ねじ歯車）。x0〜x1・y0〜y1 の箱に斜めの線
function helicalSide(x0: number, y0: number, x1: number, y1: number, step: number): string {
  const slant = (y1 - y0) * 0.4;
  let d = `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
  for (let x = x0 + step; x < x1 + slant - 0.5; x += step) {
    // 上の端の x から下の端の x - slant へ。箱の中に収める
    const top = Math.min(x, x1);
    const yTop = x > x1 ? y0 + ((x - x1) / slant) * (y1 - y0) : y0;
    const bottom = x - slant;
    const xb = Math.max(bottom, x0);
    const yb = bottom < x0 ? y1 - ((x0 - bottom) / slant) * (y1 - y0) : y1;
    d += `M${r2(top)} ${r2(yTop)}L${r2(xb)} ${r2(yb)}`;
  }
  return path(d);
}

// 横向きのウォーム（ねじ山の山と谷の輪郭、斜めのねじ山、軸）
function wormSide(x0: number, x1: number, cy: number, half: number): string {
  const pitch = 3;
  const tooth = 1.3;
  const top = teethEdge(x0, x1, cy - half + tooth, cy - half, pitch, 0);
  const bottom = teethEdge(x0, x1, cy + half - tooth, cy + half, pitch, pitch / 2);
  let threads = `M${x0} ${cy - half + tooth}V${cy + half - tooth}M${x1} ${cy - half + tooth}V${cy + half - tooth}`;
  for (let x = x0 + pitch / 2; x + pitch / 2 < x1; x += pitch) {
    threads += `M${r2(x)} ${cy - half + 0.2}L${r2(x + pitch / 2)} ${cy + half - 0.2}`;
  }
  return path(`${top}${bottom}`) + path(threads);
}

// 歯の並んだ辺（ラック・ウォームの山）。yRoot が歯底、yTip が歯先。offset だけ歯をずらす
function teethEdge(
  x0: number,
  x1: number,
  yRoot: number,
  yTip: number,
  pitch: number,
  offset: number,
): string {
  let d = `M${x0} ${yRoot}`;
  for (let x = x0 + offset - pitch; x < x1; x += pitch) {
    const xs = [x + 0.2 * pitch, x + 0.4 * pitch, x + 0.6 * pitch, x + 0.8 * pitch];
    const ys = [yRoot, yTip, yTip, yRoot];
    for (let i = 0; i < 4; i++) {
      const xi = xs[i] ?? x;
      if (xi > x0 && xi < x1) d += `L${r2(xi)} ${ys[i]}`;
    }
  }
  return `${d}L${x1} ${yRoot}`;
}

// ラックの歯（上向き）。x0〜x1 に台形の歯を並べる
function rackTeeth(x0: number, x1: number, yTip: number, yRoot: number): string {
  return teethEdge(x0, x1, yRoot, yTip, 4, 0);
}

// 内歯車: 外の円と、内側に向いた歯
function internalBody(): string {
  return circle(12, 12, 10.5) + path(gearPath(12, 12, 7.6, 5.4, 10));
}

// 遊星歯車機構: 内歯車の輪、太陽歯車、3 つの遊星歯車
function planetaryBody(): string {
  let body = circle(12, 12, 10.75) + path(gearPath(12, 12, 9.4, 8.2, 16));
  body += path(gearPath(12, 12, 2.8, 1.9, 6));
  for (const deg of [-90, 30, 150]) {
    const a = (deg * Math.PI) / 180;
    const cx = r2(12 + 5.4 * Math.cos(a));
    const cy = r2(12 + 5.4 * Math.sin(a));
    body += circle(cx, cy, 2.3);
  }
  return body;
}

// かさ歯車: 横から見た円すい台と、頂点へ向かう歯すじ、軸
function bevelBody(): string {
  let d = 'M3.5 19H20.5L15.5 7.5H8.5Z';
  for (const x of [7, 10, 14, 17]) {
    // 円すいの頂点（12, 0.4）へ向かう線を、上の面（y = 7.5）で止める
    const xt = 12 + ((x - 12) * (7.5 - 0.4)) / (19 - 0.4);
    d += `M${x} 19L${r2(xt)} 7.5`;
  }
  d += 'M12 7.5V2.5';
  return path(d);
}

// ウォームホイール: 歯数の多い歯車と、下にかみ合うウォーム
function wormWheelBody(): string {
  return path(gearPath(12, 9, 8, 6.4, 14)) + circle(12, 9, 2) + wormSide(4.5, 19.5, 20.5, 2.5);
}

// ねじ歯車: 軸が直交する 2 つのはすば歯車（上は縦の軸、下は横の軸）
function crossedHelicalBody(): string {
  return (
    path('M12 1.5V4M12 12.5V13.5') +
    helicalSide(8.5, 4, 15.5, 12.5, 2.8) +
    helicalSide(3, 15, 21, 21.5, 3.6) +
    path('M1 18.25H3M21 18.25H23')
  );
}

export const PALETTE_KIND_ICONS: Readonly<Record<PaletteKind, string>> = {
  spur: svg(spurBody(10)),
  helical: svg(helicalSide(3.5, 5, 20.5, 19, 3.6) + path('M1 12H3.5M20.5 12H23')),
  bevel: svg(bevelBody()),
  worm: svg(path('M1 12H3.5M20.5 12H23') + wormSide(3.5, 20.5, 12, 5)),
  wormWheel: svg(wormWheelBody()),
  crossedHelical: svg(crossedHelicalBody()),
  internal: svg(internalBody()),
  rack: svg(path(`${rackTeeth(2, 22, 9.5, 13.5)}V19.5H2Z`)),
  planetary: svg(planetaryBody()),
};

// 大きさ S/M/L: 同じ平歯車を小・中・大で描く
export const SIZE_ICONS: Readonly<Record<SizeKey, string>> = {
  S: svg(spurBody(4.8)),
  M: svg(spurBody(7.4)),
  L: svg(spurBody(10.5)),
};

// 起点のシャフト: 床に立つ縦のシャフトに、歯車が 1 枚載った形
export const ROOT_SHAFT_ICON: string = svg(
  path('M12 2V21.5M5 21.5H19') +
    '<ellipse cx="12" cy="10" rx="9" ry="3"/>' +
    path('M3 10V12.2C3 13.9 7 15.2 12 15.2S21 13.9 21 12.2V10'),
);

// アイコンの要素（span の中に SVG）。className は .gs-palette__button-icon など
export function createIcon(markup: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = markup;
  return span;
}
