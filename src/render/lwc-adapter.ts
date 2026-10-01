/**
 * chart-renderer — Lightweight Charts adapter.
 *
 * Owns the LWC chart instance: main series (per chart type), volume
 * histogram, indicator series lifecycle, price-scale modes, pane
 * management, and the coordinate space handed to the drawing engine.
 *
 * Everything vendor-specific lives HERE. Upstream modules only see the
 * small imperative API below.
 */

import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import type { Bar } from '../provider-sdk/types';
import type { ChartType, ScaleMode } from '../core/types';
import { BarStore } from '../data/bar-store';
import { CHART_THEME } from './theme';
import {
  LwcCoordinateSpace,
  type CoordinateSpace,
  type StoreView,
} from './coordinate-space';
import type {
  IndicatorDefinition,
} from '../indicators/plugin-api';
import type {
  IndicatorPoint,
  IndicatorRenderHandle,
  IndicatorRenderHost,
} from '../indicators/engine';

export interface AdapterPoint {
  time: number;
  value: number;
  color?: string;
}

type MainSeries = ISeriesApi<SeriesType, Time>;

export interface ChartCallbacks {
  onVisibleRangeChange?: (range: LogicalRange | null) => void;
  onCrosshairMove?: (param: CrosshairParam | null) => void;
}

export interface CrosshairParam {
  time: number | null;
  logical: number | null;
  price: number | null;
  x: number | null;
  y: number | null;
}

export class LwcChartAdapter implements IndicatorRenderHost {
  readonly chart: IChartApi;
  private container: HTMLElement;
  private store: BarStore;
  private mainSeries: MainSeries | null = null;
  private volumeSeries: ISeriesApi<'Histogram', Time> | null = null;
  private volumeVisible = true;
  private chartType: ChartType = 'candles';
  private indicatorHandles = new Map<string, IndicatorRenderHandle>();
  private indicatorMeta = new Map<IndicatorRenderHandle, IndicatorDefinition>();
  private priceLines = new Map<IndicatorRenderHandle, IPriceLine[]>();
  private callbacks: ChartCallbacks;
  private coordSpace: LwcCoordinateSpace;
  private currentSymbolMeta: { pricePrecision: number; minMove: number } | null = null;

  constructor(container: HTMLElement, store: BarStore, callbacks: ChartCallbacks = {}) {
    this.container = container;
    this.store = store;
    this.callbacks = callbacks;

    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: CHART_THEME.background },
        textColor: CHART_THEME.mutedText,
        fontSize: 11,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        attributionLogo: false,
        panes: {
          separatorColor: CHART_THEME.border,
          separatorHoverColor: '#2a3140',
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: CHART_THEME.grid },
        horzLines: { color: CHART_THEME.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CHART_THEME.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a3140',
        },
        horzLine: {
          color: CHART_THEME.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a3140',
        },
      },
      rightPriceScale: {
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.12, bottom: 0.18 },
      },
      leftPriceScale: {
        visible: false,
        borderColor: CHART_THEME.border,
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
        minBarSpacing: 0.08,
      },
      localization: { locale: 'en-US' },
    });

    this.coordSpace = new LwcCoordinateSpace(
      this.chart,
      () => this.mainSeries,
      () => this.store,
    );

    this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      this.callbacks.onVisibleRangeChange?.(range);
    });
    this.chart.subscribeCrosshairMove((param) => {
      if (!param.point || param.time === undefined) {
        this.callbacks.onCrosshairMove?.(null);
        return;
      }
      const price = this.mainSeries ? this.mainSeries.coordinateToPrice(param.point.y) : null;
      this.callbacks.onCrosshairMove?.({
        time: typeof param.time === 'number' ? (param.time as number) : null,
        logical: param.logical ?? null,
        price: price ?? null,
        x: param.point?.x ?? null,
        y: param.point?.y ?? null,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Main series + volume
  // -------------------------------------------------------------------------

  setChartType(type: ChartType): void {
    if (this.mainSeries) {
      this.chart.removeSeries(this.mainSeries);
      this.mainSeries = null;
    }
    this.chartType = type;
    const meta = this.currentSymbolMeta;
    const priceFormat = {
      type: 'price' as const,
      precision: meta?.pricePrecision ?? 2,
      minMove: meta?.minMove ?? 0.01,
    };
    switch (type) {
      case 'candles':
      case 'heikin-ashi': {
        this.mainSeries = this.chart.addSeries(
          CandlestickSeries,
          {
            upColor: CHART_THEME.up,
            downColor: CHART_THEME.down,
            borderUpColor: CHART_THEME.up,
            borderDownColor: CHART_THEME.down,
            wickUpColor: CHART_THEME.up,
            wickDownColor: CHART_THEME.down,
            priceFormat,
          },
          0,
        );
        break;
      }
      case 'bars': {
        this.mainSeries = this.chart.addSeries(
          BarSeries,
          {
            upColor: CHART_THEME.up,
            downColor: CHART_THEME.down,
            thinBars: false,
            priceFormat,
          },
          0,
        );
        break;
      }
      case 'line': {
        this.mainSeries = this.chart.addSeries(
          LineSeries,
          { color: CHART_THEME.line, lineWidth: 2, priceFormat },
          0,
        );
        break;
      }
      case 'area': {
        this.mainSeries = this.chart.addSeries(
          AreaSeries,
          {
            lineColor: CHART_THEME.line,
            topColor: CHART_THEME.areaTop,
            bottomColor: CHART_THEME.areaBottom,
            lineWidth: 2,
            priceFormat,
          },
          0,
        );
        break;
      }
    }
    this.rebuildVolume();
    this.applyFullData();
  }

  setSymbolMeta(meta: { pricePrecision: number; minMove: number }): void {
    this.currentSymbolMeta = meta;
    if (this.mainSeries) {
      this.mainSeries.applyOptions({
        priceFormat: { type: 'price', precision: meta.pricePrecision, minMove: meta.minMove },
      });
    }
  }

  private rebuildVolume(): void {
    if (this.volumeSeries) {
      this.chart.removeSeries(this.volumeSeries);
      this.volumeSeries = null;
    }
    if (!this.volumeVisible) return;
    this.volumeSeries = this.chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: '', // overlay scale — no axis, pane 0
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      0,
    );
    this.volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
  }

  setVolumeVisible(visible: boolean): void {
    this.volumeVisible = visible;
    this.rebuildVolume();
    this.applyFullData();
  }

  /** Full replace of main + volume data from the store. */
  applyFullData(): void {
    if (!this.mainSeries) return;
    const n = this.store.length;
    const ha = this.chartType === 'heikin-ashi';
    const times = this.store.times();
    if (this.chartType === 'candles' || this.chartType === 'bars' || ha) {
      const open = ha ? this.store.haOpen() : this.store.open();
      const high = ha ? this.store.haHigh() : this.store.high();
      const low = ha ? this.store.haLow() : this.store.low();
      const close = ha ? this.store.haClose() : this.store.close();
      const data: Array<Record<string, number>> = new Array(n);
      for (let i = 0; i < n; i++) {
        data[i] = {
          time: times[i] as UTCTimestamp,
          open: open[i],
          high: high[i],
          low: low[i],
          close: close[i],
        };
      }
      (this.mainSeries as ISeriesApi<'Candlestick' | 'Bar', Time>).setData(data as never);
    } else {
      const close = this.store.close();
      const data: Array<{ time: UTCTimestamp; value: number }> = new Array(n);
      for (let i = 0; i < n; i++) {
        data[i] = { time: times[i] as UTCTimestamp, value: close[i] };
      }
      (this.mainSeries as ISeriesApi<'Line' | 'Area', Time>).setData(data);
    }

    if (this.volumeSeries) {
      const open = this.store.open();
      const close = this.store.close();
      const volume = this.store.volume();
      const vdata: Array<{ time: UTCTimestamp; value: number; color: string }> = new Array(n);
      for (let i = 0; i < n; i++) {
        vdata[i] = {
          time: times[i] as UTCTimestamp,
          value: volume[i],
          color: close[i] >= open[i] ? CHART_THEME.upVolume : CHART_THEME.downVolume,
        };
      }
      this.volumeSeries.setData(vdata);
    }
  }

  /** Realtime path — update/append the last bar only (O(1)). */
  updateLastBar(bar: Bar): void {
    if (!this.mainSeries) return;
    const ha = this.chartType === 'heikin-ashi';
    const idx = this.store.length - 1;
    const time = bar.time as UTCTimestamp;
    if (this.chartType === 'candles' || this.chartType === 'bars' || ha) {
      const point = {
        time,
        open: ha ? this.store.haOpen()[idx] : bar.open,
        high: ha ? this.store.haHigh()[idx] : bar.high,
        low: ha ? this.store.haLow()[idx] : bar.low,
        close: ha ? this.store.haClose()[idx] : bar.close,
      };
      (this.mainSeries as ISeriesApi<'Candlestick' | 'Bar', Time>).update(point as never);
    } else {
      (this.mainSeries as ISeriesApi<'Line' | 'Area', Time>).update({ time, value: bar.close });
    }
    if (this.volumeSeries) {
      this.volumeSeries.update({
        time,
        value: bar.volume,
        color: bar.close >= bar.open ? CHART_THEME.upVolume : CHART_THEME.downVolume,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scales & display
  // -------------------------------------------------------------------------

  setScaleMode(mode: ScaleMode): void {
    const lwcMode =
      mode === 'logarithmic'
        ? PriceScaleMode.Logarithmic
        : mode === 'percentage'
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;
    this.chart.priceScale('right').applyOptions({ mode: lwcMode });
    this.chart.priceScale('left').applyOptions({ mode: lwcMode });
  }

  setLeftScale(visible: boolean): void {
    this.chart.priceScale('left').applyOptions({ visible });
  }

  setGridVisible(visible: boolean): void {
    this.chart.applyOptions({
      grid: {
        vertLines: { visible, color: CHART_THEME.grid },
        horzLines: { visible, color: CHART_THEME.grid },
      },
    });
  }

  setCrosshairMode(magnet: boolean): void {
    this.chart.applyOptions({
      crosshair: { mode: magnet ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal },
    });
  }

  setVisibleLogicalRange(range: { from: number; to: number }): void {
    this.chart.timeScale().setVisibleLogicalRange(range);
  }

  getVisibleLogicalRange(): LogicalRange | null {
    return this.chart.timeScale().getVisibleLogicalRange();
  }

  resetTimeScale(): void {
    this.chart.timeScale().resetTimeScale();
  }

  getVisibleRange(): { start: number; end: number } {
    const logical = this.chart.timeScale().getVisibleLogicalRange();
    if (!logical) return { start: 0, end: this.store.length };
    return {
      start: Math.max(0, logical.from),
      end: Math.min(this.store.length, Math.max(0, logical.to)),
    };
  }

  paneCount(): number {
    return this.chart.panes().length;
  }

  paneElement(index: number): HTMLElement | null {
    const pane = this.chart.panes()[index];
    return pane ? pane.getHTMLElement() : null;
  }

  setPaneStretch(index: number, factor: number): void {
    const pane = this.chart.panes()[index];
    if (pane) pane.setStretchFactor(factor);
  }

  // -------------------------------------------------------------------------
  // IndicatorRenderHost implementation
  // -------------------------------------------------------------------------

  createIndicatorSeries(def: IndicatorDefinition, instanceId: string): IndicatorRenderHandle {
    const handle: IndicatorRenderHandle = { instanceId, paneIndex: 0, plots: new Map() };
    let paneIndex = 0;
    if (def.target === 'pane') {
      paneIndex = this.chart.panes().length;
      handle.paneIndex = paneIndex;
    }
    for (const plot of def.plots) {
      let series: ISeriesApi<SeriesType, Time>;
      if (plot.type === 'histogram') {
        series = this.chart.addSeries(
          HistogramSeries,
          {
            color: plot.color,
            priceLineVisible: false,
            lastValueVisible: false,
            base: 0,
          },
          paneIndex,
        );
      } else {
        series = this.chart.addSeries(
          LineSeries,
          {
            color: plot.color,
            lineWidth: (plot.lineWidth ?? 1) as 1 | 2 | 3 | 4,
            lineStyle: LineStyle.Solid,
            priceLineVisible: plot.id === 'value',
            lastValueVisible: plot.id === 'value',
            crosshairMarkerVisible: false,
          },
          paneIndex,
        );
      }
      handle.plots.set(plot.id, series);
      if (plot.guides) {
        const lines: IPriceLine[] = [];
        for (const guide of plot.guides) {
          lines.push(
            series.createPriceLine({
              price: guide.value,
              color: guide.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
            }),
          );
        }
        this.priceLines.set(handle, lines);
      }
    }
    if (def.target === 'pane') {
      const pane = this.chart.panes()[paneIndex];
      if (pane) pane.setStretchFactor(def.paneStretch ?? 1);
    }
    this.indicatorHandles.set(instanceId, handle);
    this.indicatorMeta.set(handle, def);
    return handle;
  }

  removeIndicatorSeries(handle: IndicatorRenderHandle): void {
    const priceLines = this.priceLines.get(handle);
    this.priceLines.delete(handle);
    for (const [, series] of handle.plots) {
      const s = series as ISeriesApi<SeriesType, Time>;
      if (priceLines) {
        for (const line of priceLines) {
          try {
            s.removePriceLine(line);
          } catch {
            /* series may already be detached */
          }
        }
      }
      this.chart.removeSeries(s);
    }
    handle.plots.clear();
    this.indicatorHandles.delete(handle.instanceId);
    this.indicatorMeta.delete(handle);
    this.cleanupEmptyPanes();
  }

  private cleanupEmptyPanes(): void {
    let removed = true;
    while (removed) {
      removed = false;
      const panes = this.chart.panes();
      for (let i = panes.length - 1; i >= 1; i--) {
        if (panes[i].getSeries().length === 0) {
          this.chart.removePane(i);
          removed = true;
          break;
        }
      }
    }
    // Panes shift after removal — remap handle pane indices.
    const panes = this.chart.panes();
    for (const [, handle] of this.indicatorHandles) {
      for (const [, series] of handle.plots) {
        for (let i = 0; i < panes.length; i++) {
          if (panes[i].getSeries().includes(series as never)) {
            handle.paneIndex = i;
            break;
          }
        }
      }
    }
  }

  setPlotData(handle: IndicatorRenderHandle, plotId: string, data: IndicatorPoint[]): void {
    const series = handle.plots.get(plotId) as ISeriesApi<SeriesType, Time> | undefined;
    if (!series) return;
    const def = this.indicatorMeta.get(handle);
    const plot = def?.plots.find((p) => p.id === plotId);
    const isHistogram = plot?.type === 'histogram';
    const mapped = data.map((d) =>
      isHistogram
        ? { time: d.time as UTCTimestamp, value: d.value, color: d.color ?? plot?.color }
        : { time: d.time as UTCTimestamp, value: d.value },
    );
    (series as ISeriesApi<'Line' | 'Histogram', Time>).setData(mapped as never);
  }

  updatePlotLast(handle: IndicatorRenderHandle, plotId: string, point: IndicatorPoint): void {
    const series = handle.plots.get(plotId) as ISeriesApi<SeriesType, Time> | undefined;
    if (!series) return;
    const def = this.indicatorMeta.get(handle);
    const plot = def?.plots.find((p) => p.id === plotId);
    const isHistogram = plot?.type === 'histogram';
    const mapped = isHistogram
      ? { time: point.time as UTCTimestamp, value: point.value, color: point.color ?? plot?.color }
      : { time: point.time as UTCTimestamp, value: point.value };
    (series as ISeriesApi<'Line' | 'Histogram', Time>).update(mapped as never);
  }

  setPlotVisible(handle: IndicatorRenderHandle, visible: boolean): void {
    for (const [, series] of handle.plots) {
      (series as ISeriesApi<SeriesType, Time>).applyOptions({ visible });
    }
  }

  indicatorDefinitions(): Array<{ handle: IndicatorRenderHandle; def: IndicatorDefinition }> {
    const out: Array<{ handle: IndicatorRenderHandle; def: IndicatorDefinition }> = [];
    for (const [handle, def] of this.indicatorMeta) out.push({ handle, def });
    return out;
  }

  // -------------------------------------------------------------------------
  // Coordinate space + lifecycle
  // -------------------------------------------------------------------------

  coordinateSpace(): CoordinateSpace {
    return this.coordSpace;
  }

  /** Column view handed to overlay layers (sessions, profile, band fill). */
  get view(): StoreView {
    return this.coordSpace.storeView;
  }

  getMainSeries(): MainSeries | null {
    return this.mainSeries;
  }

  getVolumeSeries(): ISeriesApi<'Histogram', Time> | null {
    return this.volumeSeries;
  }

  getChartType(): ChartType {
    return this.chartType;
  }

  containerElement(): HTMLElement {
    return this.container;
  }

  destroy(): void {
    this.chart.remove();
  }
}
