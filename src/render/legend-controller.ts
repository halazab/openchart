/**
 * chart-renderer — LegendController.
 *
 * Updates legends by writing DOM textContent DIRECTLY — no React state, no
 * re-renders on market ticks. Subscribes to the chart's crosshair to show
 * hovered values, falling back to the latest bar otherwise.
 */

import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';

import type { BarStore } from '../data/bar-store';
import type { ChartType, Timeframe } from '../core/types';
import type { SymbolInfo } from '../provider-sdk/types';
import { formatPrice, formatVolume } from '../core/math';
import type { LwcChartAdapter } from './lwc-adapter';
import type { IndicatorEngine } from '../indicators/engine';
import { getDefinition } from '../indicators/builtin';
import { CHART_THEME } from './theme';
import type { MouseEventParams } from 'lightweight-charts';

interface LegendRefs {
  root: HTMLDivElement;
  titleRow: HTMLDivElement;
  ohlcRow: HTMLDivElement;
  oVal: HTMLSpanElement;
  hVal: HTMLSpanElement;
  lVal: HTMLSpanElement;
  cVal: HTMLSpanElement;
  chgVal: HTMLSpanElement;
  volumeValue: HTMLSpanElement;
}

const PANE_LEGEND_CLASS = 'openchart-pane-legend';

export class LegendController {
  private adapter: LwcChartAdapter;
  private store: BarStore;
  private root: HTMLDivElement;
  private refs: LegendRefs | null = null;
  private symbolInfo: SymbolInfo | null = null;
  private chartType: ChartType = 'candles';
  private timeframe: Timeframe = '1m';
  private indicatorEngine: () => IndicatorEngine | null;
  private chips = new Map<string, HTMLDivElement>();
  private showOhlc = true;
  private onCrosshair: (param: MouseEventParams<Time>) => void = () => undefined;

  constructor(
    adapter: LwcChartAdapter,
    store: BarStore,
    indicatorEngineGetter: () => IndicatorEngine | null,
  ) {
    this.adapter = adapter;
    this.store = store;
    this.indicatorEngine = indicatorEngineGetter;
    this.root = document.createElement('div');
    this.root.className = 'openchart-legend';
    this.root.style.cssText = [
      'position:absolute',
      'top:6px',
      'left:8px',
      'z-index:30',
      'pointer-events:none',
      'display:flex',
      'flex-direction:column',
      'gap:3px',
      'font:12px/1.4 ui-sans-serif, system-ui, sans-serif',
    ].join(';');
    adapter.containerElement().appendChild(this.root);

    this.onCrosshair = (param: MouseEventParams<Time>) => {
      if (!param || param.time === undefined || typeof param.time !== 'number') {
        this.renderValues(null);
        return;
      }
      this.renderValues({ time: param.time as number });
    };
    this.adapter.chart.subscribeCrosshairMove(this.onCrosshair);
  }

  setSymbolInfo(info: SymbolInfo | null): void {
    this.symbolInfo = info;
    this.rebuildTitle();
  }

  setDisplay(chartType: ChartType, timeframe: Timeframe): void {
    this.chartType = chartType;
    this.timeframe = timeframe;
    this.rebuildTitle();
  }

  setShowOhlc(show: boolean): void {
    this.showOhlc = show;
    if (this.refs) {
      this.refs.ohlcRow.style.display = show ? 'flex' : 'none';
    }
  }

  private rebuildTitle(): void {
    if (!this.refs) this.ensureRefs();
    if (!this.refs) return;
    const ticker = this.symbolInfo?.ticker ?? '—';
    const exchange = this.symbolInfo?.exchange ?? '';
    const tf = this.timeframe.toUpperCase();
    const typeLabel =
      this.chartType === 'heikin-ashi'
        ? 'H.Ashi'
        : this.chartType.charAt(0).toUpperCase() + this.chartType.slice(1);
    this.refs.titleRow.innerHTML = '';
    const parts = [
      `${ticker}`,
      `· ${tf}`,
      `· ${typeLabel}`,
      exchange ? `· ${exchange}` : '',
    ];
    const span = document.createElement('span');
    span.textContent = parts.filter(Boolean).join(' ');
    span.style.color = '#e6e9ef';
    span.style.fontWeight = '600';
    span.style.letterSpacing = '0.02em';
    this.refs.titleRow.appendChild(span);
  }

  private ensureRefs(): void {
    if (this.refs) return;
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const ohlcRow = document.createElement('div');
    ohlcRow.style.cssText =
      'display:flex;gap:8px;align-items:center;color:#8b93a3;font-size:11.5px;';
    const make = (label: string) => {
      const wrap = document.createElement('span');
      const l = document.createElement('span');
      l.textContent = `${label} `;
      l.style.color = '#8b93a3';
      const v = document.createElement('span');
      v.style.color = '#d1d5db';
      wrap.appendChild(l);
      wrap.appendChild(v);
      ohlcRow.appendChild(wrap);
      return v;
    };
    const oVal = make('O');
    const hVal = make('H');
    const lVal = make('L');
    const cVal = make('C');
    const chgVal = make('Chg');
    const volumeValue = make('Vol');
    this.root.appendChild(titleRow);
    this.root.appendChild(ohlcRow);
    this.refs = { root: this.root, titleRow, ohlcRow, oVal, hVal, lVal, cVal, chgVal, volumeValue };
  }

  /**
   * Value refresh: prefers crosshair-hovered bar, else the last bar.
   * Called from crosshair subscription and realtime updates.
   */
  renderValues(crosshair: { time?: number | string } | null = null): void {
    if (!this.refs) this.ensureRefs();
    if (!this.refs) return;
    const n = this.store.length;
    if (n === 0) return;

    let index = n - 1;
    if (crosshair && typeof crosshair.time === 'number') {
      const found = this.store.indexOfTime(crosshair.time);
      if (found >= 0) index = found;
    }

    const precision = this.symbolInfo?.pricePrecision ?? 2;
    const open = this.store.open()[index];
    const high = this.store.high()[index];
    const low = this.store.low()[index];
    const close = this.store.close()[index];
    const volume = this.store.volume()[index];
    const prevClose = index > 0 ? this.store.close()[index - 1] : open;
    const change = close - prevClose;
    const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    const color = change >= 0 ? CHART_THEME.up : CHART_THEME.down;
    const fmt = (v: number) => formatPrice(v, precision);

    const refs = this.refs;
    refs.ohlcRow.style.display = this.showOhlc ? 'flex' : 'none';
    refs.oVal.textContent = fmt(open);
    refs.hVal.textContent = fmt(high);
    refs.lVal.textContent = fmt(low);
    refs.cVal.textContent = fmt(close);
    refs.chgVal.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    refs.chgVal.style.color = color;
    refs.volumeValue.textContent = formatVolume(volume);
    this.updateChipValues(index, precision);
  }

  /** Rebuild indicator chips (indicator add/remove, pane changes, symbol change). */
  rebuildIndicatorChips(): void {
    for (const [, chip] of this.chips) chip.remove();
    this.chips.clear();
    const engine = this.indicatorEngine();
    if (!engine) return;
    const adapter = this.adapter;
    for (const instance of engine.listInstances()) {
      if (instance.isOverlay) continue; // volume profile has no series legend
      const def = getDefinition(instance.definitionId);
      if (!def) continue;
      const paneIndex = instance.handle?.paneIndex ?? 0;
      const chip = document.createElement('div');
      chip.className = PANE_LEGEND_CLASS;
      chip.style.cssText = [
        'position:relative',
        'display:flex',
        'gap:6px',
        'align-items:center',
        'pointer-events:auto',
        'font:11px/1.4 ui-sans-serif, system-ui, sans-serif',
        'color:#8b93a3',
      ].join(';');
      const label = document.createElement('span');
      const paramText = def.params
        .map((p) => instance.params[p.key])
        .filter((v) => v !== undefined)
        .join(' ');
      label.textContent = `${def.shortName} ${paramText}`.trim();
      label.style.color = '#d1d5db';
      chip.appendChild(label);

      const values = document.createElement('span');
      values.className = 'values';
      chip.appendChild(values);

      if (paneIndex === 0) {
        // Main-pane overlays stack inside the legend flow (no collision).
        this.root.appendChild(chip);
      } else {
        const paneEl = adapter.paneElement(paneIndex);
        if (!paneEl) continue;
        chip.style.position = 'absolute';
        chip.style.top = '4px';
        chip.style.left = '8px';
        chip.style.zIndex = '25';
        if (paneEl.style.position !== 'relative') {
          paneEl.style.position = 'relative';
        }
        paneEl.appendChild(chip);
      }
      this.chips.set(instance.id, chip);
    }
    this.renderValues(null);
  }

  private updateChipValues(index: number, precision: number): void {
    const engine = this.indicatorEngine();
    if (!engine) return;
    for (const instance of engine.listInstances()) {
      const chip = this.chips.get(instance.id);
      if (!chip) continue;
      const def = getDefinition(instance.definitionId);
      if (!def) continue;
      const valuesEl = chip.querySelector('.values') as HTMLSpanElement | null;
      if (!valuesEl) continue;
      const parts: string[] = [];
      for (const plot of def.plots) {
        // Prefer cached full arrays; tail updates keep them fresh enough for
        // display, and hover precision is non-critical.
        const arr = instance.lastPlots.get(plot.id);
        if (!arr) continue;
        const v = arr[Math.min(index, arr.length - 1)];
        if (Number.isNaN(v)) continue;
        const text =
          def.formatValue?.(v, instance.params) ?? v.toFixed(Math.min(precision + 2, 6));
        parts.push(text);
      }
      valuesEl.innerHTML = '';
      valuesEl.textContent = parts.join('  ');
      valuesEl.style.color = '#8b93a3';
    }
  }

  dispose(): void {
    this.adapter.chart.unsubscribeCrosshairMove(this.onCrosshair);
    this.root.remove();
    for (const [, chip] of this.chips) chip.remove();
    this.chips.clear();
  }

  // Convenience for engine wiring.
  chart(): IChartApi {
    return this.adapter.chart;
  }

  mainSeries(): ISeriesApi<SeriesType, Time> | null {
    return this.adapter.getMainSeries();
  }
}
