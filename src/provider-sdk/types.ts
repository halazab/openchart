/**
 * provider-sdk — market-data contracts.
 *
 * The charting system knows NOTHING about any concrete vendor. It only
 * consumes these interfaces. A provider can be a simulator, a REST+WebSocket
 * backend, a company internal feed, or a community adapter — swapping it
 * never touches chart/indicator/drawing code.
 *
 * See `docs/provider-interfaces.md` for a full authoring guide.
 */

import type { ConnectionStatus, SessionModel, Timeframe } from '../core/types';

// ---------------------------------------------------------------------------
// Normalized market events
// ---------------------------------------------------------------------------

/** OHLCV bar. `time` = bucket open time, UTC seconds. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** First bar of a regular session (used for session breaks / VWAP reset). */
  sessionStart?: boolean;
  /** Bar belongs to pre/post-market (extended hours). */
  extended?: boolean;
}

/** Individual trade print. */
export interface Trade {
  time: number;
  price: number;
  size: number;
  side?: 'buy' | 'sell';
  id?: string;
}

/** Best quote / ticker snapshot for lists (watchlist, details). */
export interface Quote {
  symbol: string;
  time: number;
  last: number;
  bid?: number;
  ask?: number;
  dayOpen?: number;
  dayHigh?: number;
  dayLow?: number;
  prevClose?: number;
  volume?: number;
}

// ---------------------------------------------------------------------------
// Instrument metadata
// ---------------------------------------------------------------------------

export interface SymbolInfo {
  /** Canonical ticker used in all requests, e.g. "BTCUSD" or "BINANCE:BTCUSDT". */
  symbol: string;
  /** Human name, e.g. "Bitcoin / U.S. Dollar". */
  name: string;
  exchange: string;
  type: 'crypto' | 'stock' | 'index' | 'forex' | 'futures';
  /** Short display ticker (legend / watchlist). */
  ticker: string;
  description?: string;
  /** Session model — drives session breaks, shading and VWAP resets. */
  sessionModel: SessionModel;
  pricePrecision: number;
  /** Minimum price move (tick size). */
  minMove: number;
  /** Timezones displayed are UTC; providers may expose their native tz here. */
  timezone?: string;
  /** Sectors/tags used by symbol search ranking. */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Provider capability interfaces
// ---------------------------------------------------------------------------

export interface BarsRequest {
  symbol: string;
  timeframe: Timeframe;
  /**
   * Page boundary: return up to `limit` bars strictly BEFORE this time
   * (exclusive). Omit to page from "now". Bars are returned ascending.
   */
  end?: number;
  limit: number;
}

export interface BarsPage {
  bars: Bar[];
  /** False when the provider has no older data. */
  hasMore: boolean;
}

/** Historical OHLCV access with backward pagination. */
export interface HistoricalBarsProvider {
  fetchBars(request: BarsRequest): Promise<BarsPage>;
}

export type RealtimeHandler<T> = (data: T) => void;
export type Unsubscribe = () => void;

/** Streaming OHLCV updates for the chart's current bar. */
export interface RealtimeBarsProvider {
  subscribeBars(
    symbol: string,
    timeframe: Timeframe,
    handler: RealtimeHandler<Bar>,
  ): Unsubscribe;
}

/** Streaming trade prints (aggregated client-side into bars). */
export interface RealtimeTradesProvider {
  subscribeTrades(symbol: string, handler: RealtimeHandler<Trade>): Unsubscribe;
}

/** Streaming quotes for watchlist / details panels. */
export interface RealtimeQuotesProvider {
  subscribeQuotes(symbols: string[], handler: RealtimeHandler<Quote>): Unsubscribe;
}

export interface SymbolSearchResult {
  symbols: SymbolInfo[];
}

/**
 * The facade every market-data plugin implements. Individual capabilities
 * are exposed via accessor methods so the engine can degrade gracefully
 * (e.g. aggregate trades when `bars()` is not implemented).
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  /** True when historical/realtime data is generated locally (offline). */
  readonly offline: boolean;

  searchSymbols(query: string, limit?: number): Promise<SymbolInfo[]>;
  getSymbol(symbol: string): Promise<SymbolInfo>;

  history(): HistoricalBarsProvider;
  bars(): RealtimeBarsProvider | null;
  trades(): RealtimeTradesProvider | null;
  quotes(): RealtimeQuotesProvider | null;

  /** Optional eager connect (WebSocket transports). */
  connect?(): Promise<void>;
  disconnect?(): void;
  status(): ConnectionStatus;
  onStatus(handler: (status: ConnectionStatus) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
// Normalized realtime batch (produced by BatchingIngestor)
// ---------------------------------------------------------------------------

export interface BarUpdate {
  bar: Bar;
  /** True when the bar opens a new bucket (append) vs updates the current one. */
  isNew: boolean;
  timeframe: Timeframe;
}

export interface MarketBatch {
  barUpdates: BarUpdate[];
  trades: Trade[];
  quotes: Quote[];
}
