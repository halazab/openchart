/**
 * Synthetic market provider — an offline, deterministic market simulation
 * implementing the full provider-sdk surface.
 *
 * Capabilities exercised:
 *  - HistoricalBarsProvider (paginated, session-aware)
 *  - RealtimeTradesProvider (tick-level feed → client-side bar aggregation)
 *  - RealtimeQuotesProvider (watchlist / details)
 *
 * NOTE: bars() intentionally returns null so the engine demonstrates the
 * TradeAggregator path (trades → OHLCV). Providers with native bar streams
 * implement bars() instead (see the Binance provider).
 */

import type {
  Bar,
  BarsPage,
  HistoricalBarsProvider,
  MarketDataProvider,
  Quote,
  RealtimeQuotesProvider,
  RealtimeTradesProvider,
  RealtimeHandler,
  SymbolInfo,
  Trade,
  Unsubscribe,
} from '../../provider-sdk/types';
import type { ConnectionStatus, Timeframe } from '../../core/types';
import { TIMEFRAME_SECONDS } from '../../core/types';
import { mulberry32 } from '../../core/math';
import {
  fetchSyntheticBars,
  getBaseSeries,
  syntheticQuote,
} from './generator';
import { getSyntheticSpec, searchSyntheticUniverse, SYNTHETIC_UNIVERSE } from './symbols';

const TICK_INTERVAL_MS = 150;
const QUOTE_INTERVAL_MS = 600;

interface TradeFeed {
  symbol: string;
  timer: ReturnType<typeof setInterval>;
  rand: () => number;
  lastPrice: number;
  perTickVol: number;
  pricePrecision: number;
  tradeSeq: number;
  handlers: Set<RealtimeHandler<{ time: number; price: number; size: number; side?: 'buy' | 'sell' }>>;
}

interface QuoteFeed {
  symbols: string[];
  timer: ReturnType<typeof setInterval>;
  rand: () => number;
  state: Map<string, Quote>;
  handler: RealtimeHandler<Quote>;
}

export class SyntheticMarketProvider implements MarketDataProvider {
  readonly id = 'synthetic';
  readonly name = 'Simulated Markets';
  readonly offline = true;

  private statusValue: ConnectionStatus = 'idle';
  private statusHandlers = new Set<(s: ConnectionStatus) => void>();
  private tradeFeeds = new Map<string, TradeFeed>();
  private quoteFeed: QuoteFeed | null = null;

  // -- MarketDataProvider ---------------------------------------------------

  async searchSymbols(query: string, limit = 20): Promise<SymbolInfo[]> {
    return searchSyntheticUniverse(query, limit);
  }

  async getSymbol(symbol: string): Promise<SymbolInfo> {
    const spec = getSyntheticSpec(symbol);
    if (!spec) throw new Error(`Unknown symbol: ${symbol}`);
    return spec;
  }

  history(): HistoricalBarsProvider {
    return {
      fetchBars: async ({ symbol, timeframe, end, limit }: { symbol: string; timeframe: Timeframe; end?: number; limit: number }): Promise<BarsPage> => {
        const spec = getSyntheticSpec(symbol);
        if (!spec) throw new Error(`Unknown symbol: ${symbol}`);
        // Small artificial latency so loading states are observable.
        await new Promise((r) => setTimeout(r, 30));
        return fetchSyntheticBars(spec, timeframe, end, limit);
      },
    };
  }

  bars(): null {
    return null;
  }

  trades(): RealtimeTradesProvider {
    return {
      subscribeTrades: (symbol, handler) => this.subscribeTrades(symbol, handler),
    };
  }

  quotes(): RealtimeQuotesProvider {
    return {
      subscribeQuotes: (symbols, handler) => this.subscribeQuotes(symbols, handler),
    };
  }

  async connect(): Promise<void> {
    this.setStatus('connected');
  }

  disconnect(): void {
    for (const feed of this.tradeFeeds.values()) clearInterval(feed.timer);
    this.tradeFeeds.clear();
    if (this.quoteFeed) clearInterval(this.quoteFeed.timer);
    this.quoteFeed = null;
    this.setStatus('disconnected');
  }

  status(): ConnectionStatus {
    return this.statusValue;
  }

  onStatus(handler: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(s: ConnectionStatus): void {
    this.statusValue = s;
    for (const h of this.statusHandlers) h(s);
  }

  // -- Internals -------------------------------------------------------------

  /** True when the (equity) symbol is within its simulated trading hours. */
  private marketOpenNow(symbol: string): boolean {
    const spec = getSyntheticSpec(symbol);
    if (!spec || spec.sessionModel === 'continuous') return true;
    const now = new Date();
    const sod = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
    const weekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;
    return !weekend && sod >= 8 * 3600 && sod < 24 * 3600;
  }

  private subscribeTrades(
    symbol: string,
    handler: RealtimeHandler<Trade>,
  ): Unsubscribe {
    let feed = this.tradeFeeds.get(symbol);
    if (!feed) {
      const spec = getSyntheticSpec(symbol);
      if (!spec) throw new Error(`Unknown symbol: ${symbol}`);
      const quote = syntheticQuote(spec);
      // ~3 prints/min per side; scale annual vol down to per-tick.
      const ticksPerYear = 3 * 60 * 24 * 365;
      const perTickVol = (spec.annVol / Math.sqrt(ticksPerYear)) * 1.5;
      const rand = mulberry32(Math.floor(quote.last * 7919));
      // Tick sizes calibrated so folded per-minute volume matches the
      // generated history's volume scale (crypto ≈ 100/min, equity ≈ 1.3K/min).
      const tickSize = spec.type === 'crypto' ? 0.1 + rand() * 0.8 : 2 + rand() * 8;
      feed = {
        symbol,
        timer: setInterval(() => {
          if (!this.marketOpenNow(symbol)) return;
          if (rand() < 0.28) return; // bursty activity
          const price = feed!.lastPrice * (1 + (rand() - 0.5) * 2 * perTickVol);
          feed!.lastPrice = price;
          const p = spec.pricePrecision;
          const f = 10 ** p;
          const rounded = Math.round(price * f) / f;
          handler({
            time: Math.floor(Date.now() / 1000),
            price: rounded,
            size: Math.round(rand() * tickSize * 100) / 100,
            side: rand() > 0.5 ? 'buy' : 'sell',
            id: `${symbol}-${++feed!.tradeSeq}`,
          } satisfies Trade);
        }, TICK_INTERVAL_MS),
        rand,
        lastPrice: quote.last,
        perTickVol,
        pricePrecision: spec.pricePrecision,
        tradeSeq: 0,
        handlers: new Set(),
      };
      const timerUnref = feed.timer as unknown as { unref?: () => void };
      timerUnref.unref?.();
      this.tradeFeeds.set(symbol, feed);
    }
    feed.handlers.add(handler as never);
    return () => {
      feed?.handlers.delete(handler as never);
      if (feed && feed.handlers.size === 0) {
        clearInterval(feed.timer);
        this.tradeFeeds.delete(symbol);
      }
    };
  }

  private subscribeQuotes(symbols: string[], handler: RealtimeHandler<Quote>): Unsubscribe {
    if (this.quoteFeed) clearInterval(this.quoteFeed.timer);
    const rand = mulberry32(0xc0ffee);
    const state = new Map<string, Quote>();
    for (const symbol of symbols) {
      const spec = getSyntheticSpec(symbol);
      if (!spec) continue;
      const q = syntheticQuote(spec);
      state.set(symbol, {
        symbol,
        time: Math.floor(Date.now() / 1000),
        last: q.last,
        dayOpen: q.dayOpen,
        dayHigh: q.dayHigh,
        dayLow: q.dayLow,
        volume: q.volume,
      });
    }
    const feed: QuoteFeed = {
      symbols: symbols.slice(),
      timer: setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        for (const symbol of feed.symbols) {
          const spec = getSyntheticSpec(symbol);
          const prev = state.get(symbol);
          if (!spec || !prev) continue;
          // Watchlist stays lively even outside equity sessions (simulation).
          const drift = (rand() - 0.5) * 2 * (spec.annVol / Math.sqrt(3_600 * 24 * 252)) * prev.last * 0.6;
          const f = 10 ** spec.pricePrecision;
          const last = Math.round((prev.last + drift) * f) / f;
          const quote: Quote = {
            symbol,
            time: now,
            last,
            dayOpen: prev.dayOpen ?? last,
            dayHigh: Math.max(prev.dayHigh ?? last, last),
            dayLow: Math.min(prev.dayLow ?? last, last),
            volume: (prev.volume ?? 0) + Math.round(rand() * 30),
          };
          state.set(symbol, quote);
          handler(quote);
        }
      }, QUOTE_INTERVAL_MS),
      rand,
      state,
      handler,
    };
    const timerUnref = feed.timer as unknown as { unref?: () => void };
    timerUnref.unref?.();
    this.quoteFeed = feed;
    return () => {
      if (this.quoteFeed === feed) {
        clearInterval(feed.timer);
        this.quoteFeed = null;
      }
    };
  }
}

/** Warm the deterministic cache for a subset of symbols (used on startup). */
export function preloadSyntheticSymbols(symbols: string[]): void {
  for (const s of symbols) {
    const spec = getSyntheticSpec(s);
    if (spec) getBaseSeries(spec);
  }
}

export { SYNTHETIC_UNIVERSE };
