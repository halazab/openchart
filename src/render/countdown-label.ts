/**
 * chart-renderer — bar-close countdown label.
 *
 * A TradingView-style "time until current bar closes" chip rendered just
 * below the last-price label on the right edge. Purely imperative: a
 * 500 ms interval updates text + position; never touches React.
 */

export interface CountdownHost {
  /** Open time (UTC seconds) of the current last bar, or null. */
  getLastBarOpen(): number | null;
  /** Close price of the last bar, or null. */
  getLastClose(): number | null;
  /** Bar interval in seconds. */
  getTimeframeSeconds(): number;
  /** True while bar replay is active (countdown hidden). */
  isReplayActive(): boolean;
  /** price → y px relative to the main pane, or null. */
  priceToY(price: number): number | null;
  /** Main pane offset (y) inside the container, or null. */
  mainPaneOffsetY(): number | null;
}

function formatRemaining(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

export class CountdownLabel {
  private el: HTMLDivElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private container: HTMLElement;
  private host: CountdownHost;

  constructor(container: HTMLElement, host: CountdownHost) {
    this.container = container;
    this.host = host;
    this.el = document.createElement('div');
    this.el.setAttribute('aria-label', 'Bar close countdown');
    Object.assign(this.el.style, {
      position: 'absolute',
      right: '5px',
      transform: 'translateY(-50%)',
      zIndex: '30',
      pointerEvents: 'none',
      display: 'none',
      padding: '1px 5px',
      borderRadius: '3px',
      background: '#1c212b',
      border: '1px solid #2a3140',
      color: '#a7b0bf',
      font: '10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
      fontVariantNumeric: 'tabular-nums',
    } as CSSStyleDeclaration);
    container.appendChild(this.el);
    this.timer = setInterval(() => this.update(), 500);
  }

  update(): void {
    if (this.host.isReplayActive()) {
      this.hide();
      return;
    }
    const open = this.host.getLastBarOpen();
    const close = this.host.getLastClose();
    const tf = this.host.getTimeframeSeconds();
    if (open === null || close === null || tf <= 0) {
      this.hide();
      return;
    }
    const now = Date.now() / 1000;
    const remaining = open + tf - now;
    // Hide when the bar is stale (market closed / feed paused) or already rolled.
    if (remaining <= 0 || remaining > tf * 1.5) {
      this.hide();
      return;
    }
    const y = this.host.priceToY(close);
    const paneTop = this.host.mainPaneOffsetY();
    if (y === null || paneTop === null) {
      this.hide();
      return;
    }
    this.el.textContent = formatRemaining(remaining);
    this.el.style.display = 'block';
    this.el.style.top = `${paneTop + y + 14}px`;
  }

  private hide(): void {
    this.el.style.display = 'none';
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.el.remove();
  }
}
