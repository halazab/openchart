/**
 * indicator-engine — Volume Profile (custom overlay indicator).
 *
 * Unlike series indicators, the profile is rendered by a dedicated overlay
 * layer (horizontal histogram anchored to the price axis). The computation
 * buckets volume by price over the VISIBLE range, finds the Point-of-Control
 * and expands the value area (default 70%) around it.
 */

import type { IndicatorDefinition, VolumeProfileResult } from '../plugin-api';

export interface VolumeProfileParams extends Record<string, number> {
  rows: number;
  valueAreaPercent: number;
}

/**
 * Compute the profile over bars in [start, end).
 * `priceLow`/`priceHigh` bound the bucketing domain (visible min/max).
 */
export function computeVolumeProfile(
  input: {
    high: Float64Array;
    low: Float64Array;
    close: Float64Array;
    open: Float64Array;
    volume: Float64Array;
  },
  start: number,
  end: number,
  priceLow: number,
  priceHigh: number,
  rows: number,
  valueAreaPercent: number,
): VolumeProfileResult {
  const rowCount = Math.max(10, Math.min(200, Math.round(rows)));
  const empty: VolumeProfileResult = {
    prices: new Float64Array(0),
    volumes: new Float64Array(0),
    buyVolumes: new Float64Array(0),
    pocIndex: -1,
    valueAreaHigh: 0,
    valueAreaLow: 0,
    rangeLow: priceLow,
    rangeHigh: priceHigh,
  };
  if (!(priceHigh > priceLow) || end <= start) return empty;

  const volumes = new Float64Array(rowCount);
  const buyVolumes = new Float64Array(rowCount);
  const prices = new Float64Array(rowCount);
  const step = (priceHigh - priceLow) / rowCount;
  for (let i = 0; i < rowCount; i++) prices[i] = priceLow + step * (i + 0.5);

  let maxVolume = 0;
  let pocIndex = -1;
  for (let i = start; i < end; i++) {
    const hi = input.high[i];
    const lo = input.low[i];
    const vol = input.volume[i];
    if (vol <= 0 || hi < priceLow || lo > priceHigh) continue;
    // Distribute bar volume across the buckets it spans.
    let b0 = Math.floor((lo - priceLow) / step);
    let b1 = Math.floor((hi - priceLow) / step);
    b0 = Math.max(0, Math.min(rowCount - 1, b0));
    b1 = Math.max(0, Math.min(rowCount - 1, b1));
    const span = b1 - b0 + 1;
    const per = vol / span;
    const isBuy = input.close[i] >= input.open[i];
    for (let b = b0; b <= b1; b++) {
      volumes[b] += per;
      if (isBuy) buyVolumes[b] += per;
      if (volumes[b] > maxVolume) {
        maxVolume = volumes[b];
        pocIndex = b;
      }
    }
  }
  if (pocIndex < 0) return empty;

  // Expand value area around POC (greedy two-pointer, standard algorithm).
  const totalVolume = volumes.reduce((a, b) => a + b, 0);
  const target = totalVolume * (valueAreaPercent / 100);
  let lo = pocIndex;
  let hi = pocIndex;
  let acc = volumes[pocIndex];
  while (acc < target && (lo > 0 || hi < rowCount - 1)) {
    const nextLo = lo > 0 ? volumes[lo - 1] : -1;
    const nextHi = hi < rowCount - 1 ? volumes[hi + 1] : -1;
    if (nextHi >= nextLo) {
      hi++;
      acc += Math.max(0, nextHi);
    } else {
      lo--;
      acc += Math.max(0, nextLo);
    }
  }

  return {
    prices,
    volumes,
    buyVolumes,
    pocIndex,
    valueAreaHigh: prices[hi],
    valueAreaLow: prices[lo],
    rangeLow: priceLow,
    rangeHigh: priceHigh,
  };
}

export const volumeProfileDefinition: IndicatorDefinition = {
  id: 'volume-profile',
  name: 'Volume Profile (Visible Range)',
  shortName: 'VP',
  target: 'main',
  overlay: 'volume-profile',
  params: [
    { key: 'rows', label: 'Rows', default: 72, min: 10, max: 200, step: 1 },
    { key: 'valueAreaPercent', label: 'Value Area %', default: 70, min: 10, max: 99, step: 1 },
  ],
  plots: [], // rendered by the overlay layer, not series
  compute: () => ({ plots: {} }),
};
