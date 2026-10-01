/**
 * indicator-engine — built-in pane indicators (own chart pane).
 * Pure typed-array math: worker-safe.
 */

import {
  ema,
  wilderSmooth,
  type IndicatorDefinition,
  type IndicatorInput,
} from '../plugin-api';

// ---------------------------------------------------------------------------
// RSI (Wilder)
// ---------------------------------------------------------------------------

export const rsiDefinition: IndicatorDefinition = {
  id: 'rsi',
  name: 'Relative Strength Index',
  shortName: 'RSI',
  target: 'pane',
  paneStretch: 0.7,
  params: [{ key: 'period', label: 'Length', default: 14, min: 2, max: 500, step: 1 }],
  plots: [
    {
      id: 'value',
      type: 'line',
      color: '#9575cd',
      lineWidth: 2,
      guides: [
        { value: 70, color: '#4a4f5a' },
        { value: 50, color: '#31363f' },
        { value: 30, color: '#4a4f5a' },
      ],
    },
  ],
  compute: (input, params) => {
    const { close, length } = input;
    const period = Math.max(2, Math.round(params.period));
    const out = new Float64Array(length).fill(NaN);
    if (length <= period) return { plots: { value: out } };
    const gains = new Float64Array(length);
    const losses = new Float64Array(length);
    for (let i = 1; i < length; i++) {
      const change = close[i] - close[i - 1];
      gains[i] = change > 0 ? change : 0;
      losses[i] = change < 0 ? -change : 0;
    }
    // Wilder smoothing from index `period`.
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    const rsiFrom = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
    out[period] = rsiFrom(avgGain, avgLoss);
    for (let i = period + 1; i < length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      out[i] = rsiFrom(avgGain, avgLoss);
    }
    return { plots: { value: out } };
  },
  formatValue: (v) => v.toFixed(2),
};

// ---------------------------------------------------------------------------
// MACD (12, 26, 9)
// ---------------------------------------------------------------------------

export const macdDefinition: IndicatorDefinition = {
  id: 'macd',
  name: 'MACD',
  shortName: 'MACD',
  target: 'pane',
  paneStretch: 0.9,
  params: [
    { key: 'fast', label: 'Fast', default: 12, min: 1, max: 200, step: 1 },
    { key: 'slow', label: 'Slow', default: 26, min: 1, max: 400, step: 1 },
    { key: 'signal', label: 'Signal', default: 9, min: 1, max: 200, step: 1 },
  ],
  plots: [
    {
      id: 'histogram',
      type: 'histogram',
      color: '#26a69a',
      colorByValue: { positive: '#26a69a', negative: '#ef5350' },
    },
    { id: 'macd', type: 'line', color: '#2962ff', lineWidth: 2 },
    { id: 'signal', type: 'line', color: '#ff6d00', lineWidth: 2 },
  ],
  compute: (input, params) => {
    const { close, length } = input;
    const fast = Math.max(1, Math.round(params.fast));
    const slow = Math.max(fast + 1, Math.round(params.slow));
    const signalLen = Math.max(1, Math.round(params.signal));
    const macdLine = new Float64Array(length).fill(NaN);
    const signalLine = new Float64Array(length).fill(NaN);
    const histogram = new Float64Array(length).fill(NaN);
    const emaFast = ema(close, fast);
    const emaSlow = ema(close, slow);
    // MACD line where both EMAs defined.
    const macdRaw = new Float64Array(length).fill(NaN);
    for (let i = 0; i < length; i++) {
      if (!Number.isNaN(emaFast[i]) && !Number.isNaN(emaSlow[i])) {
        macdRaw[i] = emaFast[i] - emaSlow[i];
      }
    }
    // Signal = EMA(macd) over defined values. Build a compact series.
    const defined: number[] = [];
    const defIdx: number[] = [];
    for (let i = 0; i < length; i++) {
      if (!Number.isNaN(macdRaw[i])) {
        defined.push(macdRaw[i]);
        defIdx.push(i);
      }
    }
    if (defined.length > 0) {
      const defArr = new Float64Array(defined);
      const sig = ema(defArr, signalLen);
      for (let i = 0; i < defIdx.length; i++) {
        const idx = defIdx[i];
        macdLine[idx] = macdRaw[idx];
        if (!Number.isNaN(sig[i])) {
          signalLine[idx] = sig[i];
          histogram[idx] = macdRaw[idx] - sig[i];
        }
      }
    }
    return { plots: { histogram, macd: macdLine, signal: signalLine } };
  },
  formatValue: (v) => v.toFixed(4),
};

// ---------------------------------------------------------------------------
// ATR (Wilder)
// ---------------------------------------------------------------------------

export const atrDefinition: IndicatorDefinition = {
  id: 'atr',
  name: 'Average True Range',
  shortName: 'ATR',
  target: 'pane',
  paneStretch: 0.6,
  params: [{ key: 'period', label: 'Length', default: 14, min: 2, max: 500, step: 1 }],
  plots: [{ id: 'value', type: 'line', color: '#e06c75', lineWidth: 2 }],
  compute: (input, params) => {
    const { high, low, close, length } = input;
    const period = Math.max(2, Math.round(params.period));
    const out = new Float64Array(length).fill(NaN);
    if (length < 2) return { plots: { value: out } };
    const tr = new Float64Array(length);
    tr[0] = high[0] - low[0];
    for (let i = 1; i < length; i++) {
      const hl = high[i] - low[i];
      const hc = Math.abs(high[i] - close[i - 1]);
      const lc = Math.abs(low[i] - close[i - 1]);
      tr[i] = Math.max(hl, hc, lc);
    }
    if (length >= period) {
      wilderSmooth(tr, period, out, 1);
    }
    return { plots: { value: out } };
  },
  formatValue: (v) => v.toFixed(4),
};
