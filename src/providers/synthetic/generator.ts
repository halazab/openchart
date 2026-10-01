/**
 * synthetic provider — deterministic market generator.
 *
 * Produces realistic bars with:
 *  - seeded GBM price paths (per-symbol volatility + vol clustering)
 *  - intraday U-shaped volume profile coupled to |return|
 *  - equity session model: PRE (08:00–13:30 UTC), REGULAR (13:30–20:00 UTC),
 *    POST (20:00–00:00 UTC), Mon–Fri, weekends skipped
 *  - continuous (24/7) session model for crypto symbols
 *
 * The 1-minute base series is generated ONCE per symbol and cached;
 * timeframe series are aggregated from it and cached as well, so pagination
 * pages are always consistent (binary-searched, never regenerated).
 */

import type { Bar } from '../../provider-sdk/types';
import type { Timeframe } from '../../core/types';
import { TIMEFRAME_SECONDS } from '../../core/types';
import { clamp, gaussian, mulberry32, timeUpperBound } from '../../core/math';
import type { SyntheticSpec } from './symbols';

// Equity session boundaries (UTC seconds-of-day).
export const PRE_OPEN_SEC = 8 * 3600;
export const REGULAR_OPEN_SEC = 13.5 * 3600;
export const REGULAR_CLOSE_SEC = 20 * 3600;

interface SeriesEntry {
  bars: Bar[];
  times: Float64Array;
}

const baseCache = new Map<string, SeriesEntry>();
const tfCache = new Map<string, SeriesEntry>();

function round(v: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
}

function isWeekendUtc(timeSec: number): boolean {
  const day = new Date(timeSec * 1000).getUTCDay();
  return day === 0 || day === 6;
}

/** Generate the base 1-minute series for a symbol (cached, deterministic). */
export function getBaseSeries(spec: SyntheticSpec): SeriesEntry {
  const cached = baseCache.get(spec.symbol);
  if (cached) return cached;

  const rand = mulberry32(Math.floor(spec.basePrice * 9973) ^ 0x9e3779b9);
  const perMinVol = spec.annVol / Math.sqrt(525600);

  const maxMinutes = 440000; // ~10.5 months of continuous minutes
  const nowSec = Math.floor(Date.now() / 1000);
  let t0 = Math.floor((nowSec - maxMinutes * 60) / 60) * 60;

  const bars: Bar[] = [];
  let price = spec.basePrice * (0.8 + rand() * 0.12);
  let volState = perMinVol;

  while (t0 < nowSec) {
    const secOfDay = t0 % 86400;
    const weekend = isWeekendUtc(t0);

    if (spec.sessionModel === 'equity') {
      const inPre = !weekend && secOfDay >= PRE_OPEN_SEC && secOfDay < REGULAR_OPEN_SEC;
      const inReg =
        !weekend && secOfDay >= REGULAR_OPEN_SEC && secOfDay < REGULAR_CLOSE_SEC;
      const inPost =
        !weekend && (secOfDay >= REGULAR_CLOSE_SEC || secOfDay < PRE_OPEN_SEC) &&
        !(secOfDay < PRE_OPEN_SEC && secOfDay >= 0 && secOfDay < 6 * 3600 ? false : secOfDay >= REGULAR_CLOSE_SEC);

      const isPost = !weekend && secOfDay >= REGULAR_CLOSE_SEC;
      const isPre = inPre;

      if (!inPre && !inReg && !isPost) {
        t0 += 60;
        continue;
      }

      const sessionStart = secOfDay === REGULAR_OPEN_SEC;
      const frac = clamp((secOfDay - PRE_OPEN_SEC) / (REGULAR_CLOSE_SEC - PRE_OPEN_SEC), 0, 1);
      const ushape = 1.45 - 1.1 * Math.sin(Math.PI * clamp(frac, 0.02, 0.98)) ** 0.9;
      volState = clamp(
        volState * 0.996 + perMinVol * 0.004 * (0.5 + rand()),
        perMinVol * 0.5,
        perMinVol * 3,
      );
      const sigma = perMinVol * ushape * (inReg ? 1 : 0.55) * (volState / perMinVol);

      const ret = gaussian(rand) * sigma;
      const open = price;
      const close = open * (1 + ret);
      const spread =
        Math.abs(gaussian(rand)) * sigma * 0.6 + Math.abs(ret) * 0.4 + 1e-9;
      const high = Math.max(open, close) * (1 + spread);
      const low = Math.min(open, close) * (1 - spread);
      const baseVol = 900 + rand() * 1600;
      const volume = Math.round(
        baseVol *
          ushape *
          (inReg ? 1 : 0.28) *
          (1 + (Math.abs(ret) / Math.max(sigma, 1e-9)) * 0.35),
      );

      bars.push({
        time: t0,
        open: round(open, spec.pricePrecision),
        high: round(high, spec.pricePrecision),
        low: round(low, spec.pricePrecision),
        close: round(close, spec.pricePrecision),
        volume,
        sessionStart,
        extended: inReg ? undefined : true,
      });
      price = close;
      void isPre;
      void inPost;
    } else {
      // Continuous 24/7 market.
      volState = clamp(
        volState * 0.996 + perMinVol * 0.004 * (0.5 + rand()),
        perMinVol * 0.5,
        perMinVol * 2.5,
      );
      const ret = gaussian(rand) * volState;
      const open = price;
      const close = open * (1 + ret);
      const spread =
        Math.abs(gaussian(rand)) * volState * 0.6 + Math.abs(ret) * 0.4 + 1e-9;
      const high = Math.max(open, close) * (1 + spread);
      const low = Math.min(open, close) * (1 - spread);
      const volume = Math.round(
        (40 + rand() * 120) * (1 + (Math.abs(ret) / Math.max(volState, 1e-9)) * 0.4),
      );
      const dayKey = Math.floor(t0 / 86400);
      const newDay = bars.length === 0 || Math.floor(bars[bars.length - 1].time / 86400) !== dayKey;
      bars.push({
        time: t0,
        open: round(open, spec.pricePrecision),
        high: round(high, spec.pricePrecision),
        low: round(low, spec.pricePrecision),
        close: round(close, spec.pricePrecision),
        volume,
        sessionStart: newDay,
      });
      price = close;
    }

    t0 += 60;
  }

  const times = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) times[i] = bars[i].time;
  const entry: SeriesEntry = { bars, times };
  baseCache.set(spec.symbol, entry);
  return entry;
}

/**
 * Aggregate 1-minute bars into `timeframe` buckets. Buckets align to each
 * contiguous session group (equity pre/regular/post of one trading day form
 * one group; overnight gaps start a new group). Crypto buckets align to the
 * clock (epoch-aligned).
 */
export function aggregateBars(bars: Bar[], timeframe: Timeframe, sessionModel: string): Bar[] {
  if (timeframe === '1m') return bars.slice();
  const bucketSec = TIMEFRAME_SECONDS[timeframe];
  const gapThreshold = sessionModel === 'equity' ? 30 * 60 : bucketSec;

  const out: Bar[] = [];
  let cur: Bar | null = null;
  let groupAnchor = 0;
  let allExtended = true;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const prevTime = i > 0 ? bars[i - 1].time : Number.NEGATIVE_INFINITY;
    const newGroup = b.time - prevTime > gapThreshold || (sessionModel === 'equity' && b.sessionStart === true && b.extended !== true && (cur === null || !cur.sessionStart));
    if (newGroup) {
      groupAnchor = b.time;
      if (cur) {
        if (allExtended) cur.extended = true;
        else delete cur.extended;
        out.push(cur);
        cur = null;
      }
    }
    const bucketStart =
      groupAnchor + Math.floor((b.time - groupAnchor) / bucketSec) * bucketSec;

    if (!cur || bucketStart !== cur.time) {
      if (cur) {
        if (allExtended) cur.extended = true;
        else delete cur.extended;
        out.push(cur);
      }
      cur = { ...b, time: bucketStart };
      cur.sessionStart = b.sessionStart === true && b.extended !== true ? true : undefined;
      allExtended = b.extended === true;
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      if (b.sessionStart === true && b.extended !== true) cur.sessionStart = true;
      allExtended = allExtended && b.extended === true;
    }
  }
  if (cur) {
    if (allExtended) cur.extended = true;
    else delete cur.extended;
    out.push(cur);
  }
  return out;
}

/** Cached aggregated series for (symbol, timeframe). */
export function getAggregatedSeries(spec: SyntheticSpec, timeframe: Timeframe): SeriesEntry {
  if (timeframe === '1m') return getBaseSeries(spec);
  const key = `${spec.symbol}|${timeframe}`;
  const cached = tfCache.get(key);
  if (cached) return cached;
  const base = getBaseSeries(spec);
  const bars = aggregateBars(base.bars, timeframe, spec.sessionModel);
  const times = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) times[i] = bars[i].time;
  const entry: SeriesEntry = { bars, times };
  tfCache.set(key, entry);
  return entry;
}

/**
 * Fetch up to `limit` aggregated bars strictly before `end` (exclusive).
 * `end` omitted → page from the most recent bar. Returns ascending.
 */
export function fetchSyntheticBars(
  spec: SyntheticSpec,
  timeframe: Timeframe,
  end: number | undefined,
  limit: number,
): { bars: Bar[]; hasMore: boolean } {
  const series = getAggregatedSeries(spec, timeframe);
  const idx =
    end === undefined
      ? series.bars.length
      : timeUpperBound(series.times, series.times.length, end - 1);
  const from = Math.max(0, idx - limit);
  return {
    bars: series.bars.slice(from, idx),
    hasMore: from > 0,
  };
}

/** Latest price + current-day stats for the quote/watchlist layer. */
export function syntheticQuote(spec: SyntheticSpec): {
  last: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
} {
  const base = getBaseSeries(spec);
  const bars = base.bars;
  const last = bars[bars.length - 1];
  const dayKey = Math.floor(last.time / 86400);
  let dayOpen = last.open;
  let dayHigh = last.high;
  let dayLow = last.low;
  let volume = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    if (Math.floor(b.time / 86400) !== dayKey) break;
    dayOpen = b.open;
    dayHigh = Math.max(dayHigh, b.high);
    dayLow = Math.min(dayLow, b.low);
    volume += b.volume;
  }
  return { last: last.close, dayOpen, dayHigh, dayLow, volume };
}

/** Generate a realtime tick around `lastPrice` (used by the live simulator). */
export function nextTickPrice(lastPrice: number, perTickVol: number, rand: () => number): number {
  return lastPrice * (1 + gaussian(rand) * perTickVol);
}
