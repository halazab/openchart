/**
 * provider-sdk — BatchingIngestor.
 *
 * High-frequency feeds can push hundreds of events per second. Pushing each
 * event straight through the whole pipeline (store → series.update → render)
 * would thrash the main thread. The ingestor coalesces everything into one
 * `MarketBatch` per flush interval (default 50 ms ≈ 2 frames):
 *
 *   - quotes are collapsed to the LATEST snapshot per symbol
 *   - trades are queued (capped) for client-side aggregation
 *   - bar updates are collapsed per (timeframe) — last write wins, but
 *     an `isNew` rollover is always preserved so appends are never lost
 *
 * This module is transport-agnostic: WebSocket, SSE or postMessage can
 * all feed `push*()` methods.
 */

import type { Bar, BarUpdate, MarketBatch, Quote, Trade } from './types';
import type { Timeframe } from '../core/types';

export interface BatchingIngestorOptions {
  /** Flush interval in ms. Default 50 (every ~3 frames at 60fps). */
  flushIntervalMs?: number;
  /** Max trades buffered between flushes. Older prints are dropped. */
  maxBufferedTrades?: number;
}

export class BatchingIngestor {
  private readonly flushIntervalMs: number;
  private readonly maxBufferedTrades: number;
  private readonly timer: ReturnType<typeof setInterval> | null;

  private latestQuotes = new Map<string, Quote>();
  private pendingTrades: Trade[] = [];
  private latestBars = new Map<Timeframe, { bar: Bar; isNew: boolean }>();
  private flushing = false;

  private onBatch: ((batch: MarketBatch) => void) | null = null;

  constructor(options: BatchingIngestorOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? 50;
    this.maxBufferedTrades = options.maxBufferedTrades ?? 2000;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    // Never keep a Node process alive just for the flush timer.
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      (this.timer as unknown as { unref: () => void }).unref();
    }
  }

  /** Register the downstream consumer (the chart engine). */
  setConsumer(handler: (batch: MarketBatch) => void): void {
    this.onBatch = handler;
  }

  /** Feed a realtime bar (from RealtimeBarsProvider). */
  pushBar(bar: Bar, timeframe: Timeframe): void {
    const existing = this.latestBars.get(timeframe);
    const isNew = existing ? bar.time > existing.bar.time : true;
    this.latestBars.set(timeframe, { bar, isNew: (existing?.isNew ?? false) || isNew });
  }

  /** Feed a trade print (from RealtimeTradesProvider). */
  pushTrade(trade: Trade): void {
    if (this.pendingTrades.length >= this.maxBufferedTrades) {
      // Drop oldest — the newest print carries the most relevant price.
      this.pendingTrades.shift();
    }
    this.pendingTrades.push(trade);
  }

  /** Feed a quote snapshot (from RealtimeQuotesProvider). */
  pushQuote(quote: Quote): void {
    this.latestQuotes.set(quote.symbol, quote);
  }

  /** Emit the coalesced batch to the consumer (also called by the timer). */
  flush(): void {
    if (this.flushing || !this.onBatch) return;
    if (
      this.latestBars.size === 0 &&
      this.pendingTrades.length === 0 &&
      this.latestQuotes.size === 0
    ) {
      return;
    }
    this.flushing = true;
    const barUpdates: BarUpdate[] = [];
    for (const [timeframe, entry] of this.latestBars) {
      barUpdates.push({ bar: entry.bar, isNew: entry.isNew, timeframe });
    }
    const trades = this.pendingTrades;
    const quotes = Array.from(this.latestQuotes.values());
    this.latestBars.clear();
    this.pendingTrades = [];
    this.latestQuotes.clear();
    this.flushing = false;

    this.onBatch({ barUpdates, trades, quotes });
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.onBatch = null;
    this.latestBars.clear();
    this.pendingTrades = [];
    this.latestQuotes.clear();
  }
}

// ---------------------------------------------------------------------------
// Trade → Bar aggregation
// ---------------------------------------------------------------------------

export interface TradeAggregatorOptions {
  timeframeSeconds: number;
}

/**
 * Aggregates raw trade prints into OHLCV buckets. Used when a provider
 * exposes `trades()` but no `bars()`, letting the chart still render.
 * The aggregator is fed pre-batched trades (see BatchingIngestor).
 */
export class TradeAggregator {
  private bucket: Bar | null = null;
  private readonly bucketSec: number;

  constructor(options: TradeAggregatorOptions) {
    this.bucketSec = options.timeframeSeconds;
  }

  reset(): void {
    this.bucket = null;
  }

  /** Seed the aggregator so the realtime bar continues from history seamlessly. */
  seed(bar: Bar): void {
    this.bucket = { ...bar };
  }

  /**
   * Fold trades into buckets. Returns finalized bars (bucket rolled over)
   * plus the in-progress bar (or null if nothing changed).
   */
  apply(
    trades: Trade[],
  ): { closed: Bar[]; current: Bar | null; isNewBucket: boolean } {
    const closed: Bar[] = [];
    let isNewBucket = false;

    for (const trade of trades) {
      const bucketStart = Math.floor(trade.time / this.bucketSec) * this.bucketSec;
      const cur = this.bucket;
      if (!cur || bucketStart > cur.time) {
        if (cur) closed.push(cur);
        this.bucket = {
          time: bucketStart,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.size,
        };
        isNewBucket = true;
      } else {
        cur.close = trade.price;
        if (trade.price > cur.high) cur.high = trade.price;
        if (trade.price < cur.low) cur.low = trade.price;
        cur.volume += trade.size;
      }
    }

    return { closed, current: this.bucket, isNewBucket };
  }

  currentBar(): Bar | null {
    return this.bucket ? { ...this.bucket } : null;
  }
}
