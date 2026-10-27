// 一時停止中の表示（S1-22、要件 §7.2）。描画領域の上部中央に出す。ポインターは下の canvas に通す
import { bindText, h } from './dom';
import './pause-indicator.css';

export interface PauseIndicator {
  setPaused(paused: boolean): void;
  dispose(): void;
}

// host は描画領域（position が static でない要素）
export function createPauseIndicator(host: HTMLElement): PauseIndicator {
  const el = h('div', 'gs-pause-indicator', 'pause-indicator');
  el.setAttribute('role', 'status');
  el.hidden = true;
  const unbind = bindText(el, 'sim.paused');
  host.append(el);
  return {
    setPaused(paused) {
      el.hidden = !paused;
    },
    dispose() {
      unbind();
      el.remove();
    },
  };
}
