/**
 * indicator-engine — plugin API.
 *
 * An indicator is a PURE function over typed-array market columns. It never
 * touches the DOM, the chart library, or React. The engine binds its output
 * to renderer series (or custom overlay layers).
 *
 * Community plugins only need to produce an `IndicatorDefinition` and
 * register it — see docs/indicator-plugins.md.
 */

/** Column-oriented market input passed to every compute call. */
export interface IndicatorInput {
  times: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  /** Bit flags per bar: 1 = session start, 2 = extended hours. */
  flags: Uint8Array;
  length: number;
}

/** Plot values aligned 1:1 with input bars. NaN = not yet defined (gap). */
export interface IndicatorOutput {
  plots: Record<string, Float64Array>;
}

export interface IndicatorParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface PlotSpec {
  id: string;
  type: 'line' | 'histogram';
  color: string;
  lineWidth?: number;
  /** Dashed guides (e.g. RSI 30/70) rendered as price lines. */
  guides?: Array<{ value: number; color: string }>;
  /** Histogram coloring by sign/value (MACD style). */
  colorByValue?: { positive: string; negative: string; neutral?: string };
}

/** Rendering target: over the price series, or in its own pane. */
export type IndicatorTarget = 'main' | 'pane';

/**
 * Custom overlay kinds handled by dedicated renderer layers instead of
 * series. 'volume-profile' is the first built-in; the extension point is
 * generic so plugins can ship their own layers later.
 */
export type IndicatorOverlayKind = 'volume-profile';

export interface VolumeProfileResult {
  /** Bucket center prices, ascending. */
  prices: Float64Array;
  volumes: Float64Array;
  buyVolumes: Float64Array;
  /** Index of the Point-of-Control bucket. */
  pocIndex: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  /** Visible price range used for the computation. */
  rangeLow: number;
  rangeHigh: number;
}

export interface IndicatorDefinition {
  id: string;
  name: string;
  /** Legend / axis label. */
  shortName: string;
  target: IndicatorTarget;
  params: IndicatorParam[];
  plots: PlotSpec[];
  /** Fill the area between two line plots (Bollinger-style). */
  bandFill?: { upper: string; lower: string; color: string };
  /**
   * Pure computation over the bar columns. Must return one Float64Array per
   * plot id (NaN for undefined values). Must not mutate its inputs.
   */
  compute(input: IndicatorInput, params: Record<string, number>): IndicatorOutput;
  /** Optional custom overlay behavior (bypasses series rendering). */
  overlay?: IndicatorOverlayKind;
  /** Relative height of the pane when target === 'pane'. */
  paneStretch?: number;
  /** Optional value formatter for legends. */
  formatValue?: (value: number, params: Record<string, number>) => string;
}

/** Helper: build an all-NaN output buffer set. */
export function nanPlots(plotIds: string[], length: number): Record<string, Float64Array> {
  const out: Record<string, Float64Array> = {};
  for (const id of plotIds) {
    const buf = new Float64Array(length);
    buf.fill(NaN);
    out[id] = buf;
  }
  return out;
}

/** Wilder smoothing helper shared by RSI/ATR. */
export function wilderSmooth(src: Float64Array, length: number, out: Float64Array, start: number): void {
  let sum = 0;
  for (let i = start; i < src.length && i < start + length; i++) {
    sum += src[i];
    if (i === start + length - 1) out[i] = sum / length;
  }
  if (start + length - 1 < src.length) {
    for (let i = start + length; i < src.length; i++) {
      out[i] = (out[i - 1] * (length - 1) + src[i]) / length;
    }
  }
}

/** Exponential moving average over a Float64Array. NaN inputs are skipped. */
export function ema(src: Float64Array, length: number): Float64Array {
  const out = new Float64Array(src.length).fill(NaN);
  if (src.length < length) return out;
  const k = 2 / (length + 1);
  let sum = 0;
  let i = 0;
  for (; i < length; i++) sum += src[i];
  out[length - 1] = sum / length;
  for (; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
  return out;
}
