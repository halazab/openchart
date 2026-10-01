/**
 * backtest — built-in strategies.
 *
 * A strategy maps bar columns to boolean signal arrays evaluated on bar
 * CLOSE. The backtest executor fills at the NEXT bar's open (realistic
 * market order semantics) and applies protective exits intrabar.
 *
 * Community strategies implement the same `StrategyDef` contract — see
 * docs/indicator-plugins.md for the sibling indicator plugin story.
 */

import type { BacktestBarInput } from './types';

/** Signals indexed by bar; `true` means "act on this bar's close". */
export interface SignalSet {
  enterLong: Uint8Array;
  exitLong: Uint8Array;
  enterShort: Uint8Array;
  exitShort: Uint8Array;
}

export interface StrategyParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  params: StrategyParam[];
  compute(input: BacktestBarInput, params: Record<string, number>): SignalSet;
}

// ---------------------------------------------------------------------------
// Indicator math (self-contained — tiny, allocation-light)
// ---------------------------------------------------------------------------

function ema(values: Float64Array, length: number, period: number): Float64Array {
  const out = new Float64Array(length);
  if (length === 0) return out;
  const k = 2 / (period + 1);
  out[0] = values[0];
  for (let i = 1; i < length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function sma(values: Float64Array, length: number, period: number): Float64Array {
  const out = new Float64Array(length);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out[i] = i >= period - 1 ? sum / period : NaN;
  }
  return out;
}

function rsi(close: Float64Array, length: number, period: number): Float64Array {
  const out = new Float64Array(length).fill(50);
  if (length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = close[i] - close[i - 1];
    avgGain += Math.max(d, 0) / period;
    avgLoss += Math.max(-d, 0) / period;
  }
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < length; i++) {
    const d = close[i] - close[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function stdev(values: Float64Array, length: number, period: number, means: Float64Array): Float64Array {
  const out = new Float64Array(length).fill(NaN);
  for (let i = period - 1; i < length; i++) {
    const m = means[i];
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - m;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Strategy definitions
// ---------------------------------------------------------------------------

const emaCross: StrategyDef = {
  id: 'ema-cross',
  name: 'EMA Cross',
  description: 'Long when the fast EMA crosses above the slow EMA; exits (and reverses in Long & Short mode) on the opposite cross.',
  params: [
    { key: 'fast', label: 'Fast EMA', min: 2, max: 100, step: 1, default: 12 },
    { key: 'slow', label: 'Slow EMA', min: 3, max: 400, step: 1, default: 26 },
  ],
  compute(input, params) {
    const { close, length } = input;
    const fast = ema(close, length, Math.round(params.fast));
    const slow = ema(close, length, Math.round(params.slow));
    const sig: SignalSet = {
      enterLong: new Uint8Array(length),
      exitLong: new Uint8Array(length),
      enterShort: new Uint8Array(length),
      exitShort: new Uint8Array(length),
    };
    for (let i = 1; i < length; i++) {
      const up = fast[i] > slow[i] && fast[i - 1] <= slow[i - 1];
      const down = fast[i] < slow[i] && fast[i - 1] >= slow[i - 1];
      if (up) {
        sig.enterLong[i] = 1;
        sig.exitShort[i] = 1;
      }
      if (down) {
        sig.exitLong[i] = 1;
        sig.enterShort[i] = 1;
      }
    }
    return sig;
  },
};

const rsiReversion: StrategyDef = {
  id: 'rsi-reversion',
  name: 'RSI Reversion',
  description: 'Mean-reversion: buy oversold dips, exit at the midline; reverse for overbought peaks in Long & Short mode.',
  params: [
    { key: 'period', label: 'RSI period', min: 2, max: 100, step: 1, default: 14 },
    { key: 'oversold', label: 'Oversold', min: 5, max: 49, step: 1, default: 30 },
    { key: 'overbought', label: 'Overbought', min: 51, max: 95, step: 1, default: 70 },
    { key: 'exitLevel', label: 'Exit level', min: 50, max: 90, step: 1, default: 50 },
  ],
  compute(input, params) {
    const { close, length } = input;
    const r = rsi(close, length, Math.round(params.period));
    const os = params.oversold;
    const ob = params.overbought;
    const mid = params.exitLevel;
    const sig: SignalSet = {
      enterLong: new Uint8Array(length),
      exitLong: new Uint8Array(length),
      enterShort: new Uint8Array(length),
      exitShort: new Uint8Array(length),
    };
    for (let i = 1; i < length; i++) {
      if (r[i - 1] >= os && r[i] < os) sig.enterLong[i] = 1;
      if (r[i - 1] < mid && r[i] >= mid) sig.exitLong[i] = 1;
      if (r[i - 1] <= ob && r[i] > ob) sig.enterShort[i] = 1;
      if (r[i - 1] > mid && r[i] <= mid) sig.exitShort[i] = 1;
    }
    return sig;
  },
};

const macdCross: StrategyDef = {
  id: 'macd-cross',
  name: 'MACD Cross',
  description: 'Momentum: long when the MACD line crosses above its signal line; exits (and reverses) on the cross below.',
  params: [
    { key: 'fast', label: 'Fast EMA', min: 2, max: 100, step: 1, default: 12 },
    { key: 'slow', label: 'Slow EMA', min: 3, max: 200, step: 1, default: 26 },
    { key: 'signal', label: 'Signal EMA', min: 2, max: 100, step: 1, default: 9 },
  ],
  compute(input, params) {
    const { close, length } = input;
    const fast = ema(close, length, Math.round(params.fast));
    const slow = ema(close, length, Math.round(params.slow));
    const macd = new Float64Array(length);
    for (let i = 0; i < length; i++) macd[i] = fast[i] - slow[i];
    const signal = ema(macd, length, Math.round(params.signal));
    const sig: SignalSet = {
      enterLong: new Uint8Array(length),
      exitLong: new Uint8Array(length),
      enterShort: new Uint8Array(length),
      exitShort: new Uint8Array(length),
    };
    for (let i = 1; i < length; i++) {
      const up = macd[i] > signal[i] && macd[i - 1] <= signal[i - 1];
      const down = macd[i] < signal[i] && macd[i - 1] >= signal[i - 1];
      if (up) {
        sig.enterLong[i] = 1;
        sig.exitShort[i] = 1;
      }
      if (down) {
        sig.exitLong[i] = 1;
        sig.enterShort[i] = 1;
      }
    }
    return sig;
  },
};

const bbReversion: StrategyDef = {
  id: 'bb-reversion',
  name: 'Bollinger Reversion',
  description: 'Buy closes below the lower band, exit back at the middle band; mirror short above the upper band in Long & Short mode.',
  params: [
    { key: 'period', label: 'BB period', min: 4, max: 200, step: 1, default: 20 },
    { key: 'mult', label: 'Std-dev ×', min: 0.5, max: 5, step: 0.1, default: 2 },
  ],
  compute(input, params) {
    const { close, length } = input;
    const period = Math.round(params.period);
    const mid = sma(close, length, period);
    const sd = stdev(close, length, period, mid);
    const lower = new Float64Array(length);
    const upper = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      lower[i] = mid[i] - params.mult * sd[i];
      upper[i] = mid[i] + params.mult * sd[i];
    }
    const sig: SignalSet = {
      enterLong: new Uint8Array(length),
      exitLong: new Uint8Array(length),
      enterShort: new Uint8Array(length),
      exitShort: new Uint8Array(length),
    };
    for (let i = 1; i < length; i++) {
      if (Number.isNaN(lower[i]) || Number.isNaN(lower[i - 1])) continue;
      if (close[i] < lower[i] && close[i - 1] >= lower[i - 1]) sig.enterLong[i] = 1;
      if (close[i] >= mid[i] && close[i - 1] < mid[i - 1]) sig.exitLong[i] = 1;
      if (close[i] > upper[i] && close[i - 1] <= upper[i - 1]) sig.enterShort[i] = 1;
      if (close[i] <= mid[i] && close[i - 1] > mid[i - 1]) sig.exitShort[i] = 1;
    }
    return sig;
  },
};

const REGISTRY = new Map<string, StrategyDef>(
  [emaCross, rsiReversion, macdCross, bbReversion].map((s) => [s.id, s]),
);

export function listStrategies(): StrategyDef[] {
  return [...REGISTRY.values()];
}

export function getStrategy(id: string): StrategyDef | undefined {
  return REGISTRY.get(id);
}

export function defaultParams(def: StrategyDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}
