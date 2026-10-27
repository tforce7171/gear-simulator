// window.__gearSim（開発用・テスト用ビルドのみ。design.md §10）

export interface GearSimDebug {
  /** 最初のフレームを描いたら true */
  isReady(): boolean;
}

declare global {
  interface Window {
    __gearSim?: GearSimDebug;
  }
}

/** production では何もしない */
export function installGearSim(api: GearSimDebug): void {
  if (import.meta.env.MODE === 'production') return;
  window.__gearSim = api;
}
