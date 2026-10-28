// 性能の計測（S1-31）。`pnpm perf [--count <n>] [--seconds <n>] [--headless]`
//
// vite build --mode e2e → vite preview --mode e2e を起動し、Playwright の Chromium を画面ありで、実際の GPU で
// （SwiftShader を使わず）開く。垂直同期と fps の上限を外し、generatePerfScene(count) を読み込んで、眺めるモードで
// カメラを回しながら 4 つの条件のフレームの間隔を測る。結果は表で標準出力に、同じ内容を
// perf-results/<YYYYMMDD-HHmmss>.json に書く。目標（平均 60fps 以上かつ p95 ≤ 16.7ms）に届いたかを条件ごとに
// 表示するが、終了コードは結果によらない（判定のためのテストではない）。自動テスト（pnpm verify）には入れない。

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import type { Quality } from '../src/core/theme';
import { generatePerfScene } from '../src/debug/perf-scene';

const PORT = 4175;
const URL = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 1280, height: 800 };
const WARMUP_MS = 3000;
const TARGET_FPS = 60;
const TARGET_P95_MS = 16.7;
const RESULTS_DIR = 'perf-results';

interface Options {
  count: number;
  seconds: number;
  headless: boolean;
}

interface Condition {
  name: string;
  quality: Quality;
  infoOverlay: boolean;
  muted: boolean;
}

// 測る条件（タスク資料の順）。テーマはどれも真鍮
const CONDITIONS: readonly Condition[] = [
  { name: 'high / info off / sound', quality: 'high', infoOverlay: false, muted: false },
  { name: 'low / info off / sound', quality: 'low', infoOverlay: false, muted: false },
  { name: 'high / info on / sound', quality: 'high', infoOverlay: true, muted: false },
  { name: 'high / info off / muted', quality: 'high', infoOverlay: false, muted: true },
];

interface Result {
  condition: string;
  frames: number; // rAF の回数
  rendered: number; // 実際に描いた回数（renderer.info.render.frame の増え方）
  avgFps: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  calls: number;
  triangles: number;
  redrawCheckAvgMs: number; // 描き直しの判定（全オブジェクトの行列の比較）の 1 回あたりの時間
  verdict: 'OK' | 'BELOW TARGET';
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { count: 200, seconds: 10, headless: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): number => {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${arg} には正の数を渡す`);
      return value;
    };
    if (arg === '--count') options.count = Math.round(next());
    else if (arg === '--seconds') options.seconds = next();
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--') continue;
    else throw new Error(`知らない引数: ${arg}`);
  }
  return options;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? Number.NaN;
}

function timestamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 起動を待つ
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} が ${timeoutMs}ms 以内に起動しなかった`);
}

function startPreview(): ChildProcess {
  return spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--mode', 'e2e', '--port', String(PORT), '--strictPort'],
    {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    },
  );
}

function stopPreview(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill();
  } catch {
    // 止まっている
  }
}

// 実機の devicePixelRatio（Playwright は既定で 1 にそろえるので、窓の大きさを固定しない状態で読む）
async function realDevicePixelRatio(browser: Browser): Promise<number> {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await context.close();
  return dpr;
}

// ページの中で ms ミリ秒の間、requestAnimationFrame の間隔（ms）を記録する式。tsx（esbuild）は関数に名前を
// 付ける補助（__name）を差し込み、page.evaluate に関数を渡すとページの中で未定義になるので、文字列で渡す
function recordFrameIntervals(ms: number): string {
  return `new Promise((resolve) => {
    const out = [];
    let last = -1;
    let start = -1;
    function tick(now) {
      if (start < 0) start = now;
      else out.push(now - last);
      last = now;
      if (now - start < ${ms}) requestAnimationFrame(tick);
      else resolve(out);
    }
    requestAnimationFrame(tick);
  })`;
}

async function measure(page: Page, condition: Condition, seconds: number): Promise<Result> {
  await page.evaluate(
    (c) => window.__gearSim?.updateSettings({ theme: 'brass', quality: c.quality, muted: c.muted }),
    condition,
  );
  const overlay = await page.evaluate(() => window.__gearSim?.getView().infoOverlay);
  if (overlay !== condition.infoOverlay) await page.getByTestId('toolbar-info').click();

  // キャンバスをクリックして音を始める（部品を選んだら外す）→ Home → 眺めるモード → ウォームアップ
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  await page.mouse.click(box.x + 8, box.y + 8);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Home');
  await page.evaluate(() => window.__gearSim?.setWatchMode(true));
  await page.waitForTimeout(WARMUP_MS);

  const before = await page.evaluate(() => window.__gearSim?.getRenderStats());
  const intervals = (await page.evaluate(recordFrameIntervals(seconds * 1000))) as number[];
  const after = await page.evaluate(() => window.__gearSim?.getRenderStats());
  await page.evaluate(() => window.__gearSim?.setWatchMode(false));
  if (before === undefined || after === undefined) throw new Error('__gearSim が無い');

  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((s, v) => s + v, 0);
  const avgFps = total > 0 ? (intervals.length * 1000) / total : 0;
  const p95Ms = percentile(sorted, 95);
  const checks = after.redrawChecks - before.redrawChecks;
  return {
    condition: condition.name,
    frames: intervals.length,
    rendered: after.frame - before.frame,
    avgFps,
    medianMs: percentile(sorted, 50),
    p95Ms,
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1] ?? Number.NaN,
    calls: after.calls,
    triangles: after.triangles,
    redrawCheckAvgMs:
      checks > 0 ? (after.redrawCheckMs - before.redrawCheckMs) / checks : Number.NaN,
    verdict: avgFps >= TARGET_FPS && p95Ms <= TARGET_P95_MS ? 'OK' : 'BELOW TARGET',
  };
}

function printTable(results: readonly Result[]): void {
  const rows = results.map((r) => ({
    condition: r.condition,
    'avg fps': r.avgFps.toFixed(1),
    'median ms': r.medianMs.toFixed(2),
    'p95 ms': r.p95Ms.toFixed(2),
    'p99 ms': r.p99Ms.toFixed(2),
    'max ms': r.maxMs.toFixed(2),
    'rendered/rAF': `${r.rendered}/${r.frames}`,
    calls: r.calls,
    triangles: r.triangles,
    'redraw check ms': r.redrawCheckAvgMs.toFixed(3),
    verdict: r.verdict,
  }));
  console.table(rows);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`build: vite build --mode e2e`);
  const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e'], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('vite build に失敗した');

  const preview = startPreview();
  const cleanup = () => stopPreview(preview);
  process.on('exit', cleanup);
  let browser: Browser | null = null;
  try {
    await waitForServer(URL, 30_000);
    browser = await chromium.launch({
      headless: options.headless,
      // 実際の GPU で描く（SwiftShader を使わない）。垂直同期と fps の上限を外し、60fps を超えた余裕も見る
      args: ['--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
    });
    const deviceScaleFactor = await realDevicePixelRatio(browser);
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.warn(`pageerror: ${e.message}`));
    await page.goto(URL);
    await page.waitForFunction(() => window.__gearSim?.isReady() === true, null, {
      timeout: 60_000,
    });
    const scene = generatePerfScene(options.count);
    await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
    const environment = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        gpu: gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
        hardwareConcurrency: navigator.hardwareConcurrency,
      };
    });
    console.log(
      `gears: ${Object.keys(scene.gears).length}, seconds: ${options.seconds}, headless: ${options.headless}`,
    );
    console.log(
      `browser: ${browser.version()}, gpu: ${environment.gpu}, dpr: ${environment.devicePixelRatio}`,
    );
    if (options.headless) console.log('（--headless の数値は参考にならない。動くかの確かめ用）');

    const results: Result[] = [];
    for (const condition of CONDITIONS) {
      console.log(`measuring: ${condition.name}`);
      results.push(await measure(page, condition, options.seconds));
    }
    printTable(results);

    const now = new Date();
    await mkdir(RESULTS_DIR, { recursive: true });
    const file = join(RESULTS_DIR, `${timestamp(now)}.json`);
    await writeFile(
      file,
      `${JSON.stringify(
        {
          date: now.toISOString(),
          options,
          target: { fps: TARGET_FPS, p95Ms: TARGET_P95_MS },
          environment: {
            ...environment,
            browserVersion: browser.version(),
            platform: process.platform,
          },
          results,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`written: ${file}`);
  } finally {
    await browser?.close();
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
