/**
 * indicator-engine — built-in overlay indicators (render over price).
 * Pure typed-array math: worker-safe, allocation-conscious.
 */

import {
  ema,
  nanPlots,
  type IndicatorDefinition,
  type IndicatorInput,
} from '../plugin-api';

// ---------------------------------------------------------------------------
// SMA
// ---------------------------------------------------------------------------

function computeSma(input: IndicatorInput, params: Record<string, number>): { values: Record<string, Float64Array> } {
  const { close, length } = input;
  const period = Math.max(1, Math.round(params.period));
  const out = new Float64Array(length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += close[i];
    if (i >= period) sum -= close[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return { values: { value: out } };
}

export const smaDefinition: IndicatorDefinition = {
  id: 'sma',
  name: 'Moving Average (Simple)',
  shortName: 'SMA',
  target: 'main',
  params: [{ key: 'period', label: 'Length', default: 20, min: 1, max: 1000, step: 1 }],
  plots: [{ id: 'value', type: 'line', color: '#e3b341', lineWidth: 2 }],
  compute: (input, params) => ({ plots: computeSma(input, params).values }),
  formatValue: (v) => v.toFixed(2),
};

// ---------------------------------------------------------------------------
// EMA
// ---------------------------------------------------------------------------

export const emaDefinition: IndicatorDefinition = {
  id: 'ema',
  name: 'Moving Average (Exponential)',
  shortName: 'EMA',
  target: 'main',
  params: [{ key: 'period', label: 'Length', default: 50, min: 1, max: 1000, step: 1 }],
  plots: [{ id: 'value', type: 'line', color: '#4fb3a9', lineWidth: 2 }],
  compute: (input, params) => {
    const period = Math.max(1, Math.round(params.period));
    return { plots: { value: ema(input.close, period) } };
  },
  formatValue: (v) => v.toFixed(2),
};

// ---------------------------------------------------------------------------
// VWAP — session-anchored (resets on session-start flag; daily for continuous)
// ---------------------------------------------------------------------------

export const vwapDefinition: IndicatorDefinition = {
  id: 'vwap',
  name: 'Volume Weighted Average Price',
  shortName: 'VWAP',
  target: 'main',
  params: [],
  plots: [{ id: 'value', type: 'line', color: '#c678dd', lineWidth: 2 }],
  compute: (input) => {
    const { high, low, close, volume, flags, length } = input;
    const out = new Float64Array(length).fill(NaN);
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < length; i++) {
      const sessionStart = (flags[i] & 1) !== 0;
      if (sessionStart || cumV === 0) {
        cumPV = 0;
        cumV = 0;
      }
      const typical = (high[i] + low[i] + close[i]) / 3;
      const v = volume[i];
      cumPV += typical * v;
      cumV += v;
      if (cumV > 0) out[i] = cumPV / cumV;
    }
    return { plots: { value: out } };
  },
  formatValue: (v) => v.toFixed(2),
};

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export const bollingerDefinition: IndicatorDefinition = {
  id: 'bollinger',
  name: 'Bollinger Bands',
  shortName: 'BB',
  target: 'main',
  params: [
    { key: 'period', label: 'Length', default: 20, min: 2, max: 500, step: 1 },
    { key: 'mult', label: 'StdDev', default: 2, min: 0.1, max: 10, step: 0.1 },
  ],
  plots: [
    { id: 'upper', type: 'line', color: '#7e8ea8', lineWidth: 1 },
    { id: 'basis', type: 'line', color: '#d29922', lineWidth: 1 },
    { id: 'lower', type: 'line', color: '#7e8ea8', lineWidth: 1 },
  ],
  bandFill: { upper: 'upper', lower: 'lower', color: 'rgba(126, 142, 168, 0.08)' },
  compute: (input, params) => {
    const { close, length } = input;
    const period = Math.max(2, Math.round(params.period));
    const mult = params.mult;
    const upper = new Float64Array(length).fill(NaN);
    const basis = new Float64Array(length).fill(NaN);
    const lower = new Float64Array(length).fill(NaN);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < length; i++) {
      sum += close[i];
      sumSq += close[i] * close[i];
      if (i >= period) {
        const drop = close[i - period];
        sum -= drop;
        sumSq -= drop * drop;
      }
      if (i >= period - 1) {
        const mean = sum / period;
        // Population variance over the rolling window.
        const variance = Math.max(0, sumSq / period - mean * mean);
        const sd = Math.sqrt(variance);
        basis[i] = mean;
        upper[i] = mean + mult * sd;
        lower[i] = mean - mult * sd;
      }
    }
    return { plots: { upper, basis, lower } };
  },
  formatValue: (v) => v.toFixed(2),
};

void nanPlots;
