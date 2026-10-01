/**
 * chart-renderer — CoordinateSpace.
 *
 * THE seam between the drawing engine and the chart library. The drawing
 * engine only ever sees this interface — it never imports Lightweight
 * Charts. Swapping the renderer (e.g. for a custom WebGL engine) means
 * reimplementing this class, nothing else.
 *
 * X mapping uses fractional LOGICAL indexes (bar index space) so anchors
 * interpolate between bars and extrapolate beyond the dataset edges.
 * Y mapping uses the main series' price scale.
 */

import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';

import type { BarStore } from '../data/bar-store';

/** Read-only view over the bar columns (for overlay layers & drawings). */
export interface StoreView {
  length(): number;
  timeAt(index: number): number;
  fractionalIndexForTime(time: number): number;
  timeForFractionalIndex(index: number): number;
  indexOfTime(time: number): number;
  openAt(i: number): number;
  highAt(i: number): number;
  lowAt(i: number): number;
  closeAt(i: number): number;
  volumeAt(i: number): number;
  flagAt(i: number): number;
}

export interface CoordinateSpace {
  /** Time (UTC seconds) → x px in the chart container; null if chart not ready. */
  timeToX(time: number): number | null;
  /** x px → time (UTC seconds); extrapolates past dataset edges. */
  xToTime(x: number): number | null;
  /** Price → y px within the main pane; null if chart not ready. */
  priceToY(price: number): number | null;
  /** y px (main-pane-local) → price. */
  yToPrice(y: number): number | null;
  /** Main pane pixel rect (relative to the overlay canvas). */
  mainPaneRect(): { x: number; y: number; width: number; height: number } | null;
}

export class LwcCoordinateSpace implements CoordinateSpace {
  private chart: IChartApi;
  private seriesRef: () => ISeriesApi<SeriesType, Time> | null;
  private storeRef: () => BarStore;

  constructor(
    chart: IChartApi,
    seriesRef: () => ISeriesApi<SeriesType, Time> | null,
    storeRef: () => BarStore,
  ) {
    this.chart = chart;
    this.seriesRef = seriesRef;
    this.storeRef = storeRef;
  }

  get storeView(): StoreView {
    const store = this.storeRef();
    return {
      length: () => store.length,
      timeAt: (i) => store.timeAt(i),
      fractionalIndexForTime: (t) => store.fractionalIndexForTime(t),
      timeForFractionalIndex: (i) => store.timeForFractionalIndex(i),
      indexOfTime: (t) => store.indexOfTime(t),
      openAt: (i) => store.open()[i],
      highAt: (i) => store.high()[i],
      lowAt: (i) => store.low()[i],
      closeAt: (i) => store.close()[i],
      volumeAt: (i) => store.volume()[i],
      flagAt: (i) => store.flags()[i],
    };
  }

  timeToX(time: number): number | null {
    const store = this.storeRef();
    if (store.length === 0) return null;
    const idx = store.fractionalIndexForTime(time);
    const x = this.chart.timeScale().logicalToCoordinate(idx as never);
    return x === null ? null : x;
  }

  xToTime(x: number): number | null {
    const store = this.storeRef();
    if (store.length === 0) return null;
    const logical = this.chart.timeScale().coordinateToLogical(x);
    if (logical === null) return null;
    return store.timeForFractionalIndex(logical);
  }

  priceToY(price: number): number | null {
    const series = this.seriesRef();
    if (!series) return null;
    return series.priceToCoordinate(price);
  }

  yToPrice(y: number): number | null {
    const series = this.seriesRef();
    if (!series) return null;
    return series.coordinateToPrice(y);
  }

  mainPaneRect(): { x: number; y: number; width: number; height: number } | null {
    const panes = this.chart.panes();
    if (panes.length === 0) return null;
    const pane = panes[0];
    const el = pane.getHTMLElement();
    const container = el?.parentElement;
    if (!el || !container) return null;
    const paneRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      x: paneRect.left - containerRect.left,
      y: paneRect.top - containerRect.top,
      width: paneRect.width,
      height: paneRect.height,
    };
  }
}
