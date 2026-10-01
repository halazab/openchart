/**
 * Binance public market-data provider — a REAL provider implementation of
 * the provider-sdk contracts (no API key required, browser-friendly CORS).
 *
 *  - HistoricalBarsProvider → GET /api/v3/klines (auto-paginates 1000/page)
 *  - RealtimeBarsProvider   → combined WS stream  <pair>@kline_<interval>
 *  - RealtimeQuotesProvider → combined WS stream  <pair>@miniTicker
 *
 * It shows how a vendor adapter maps vendor payloads onto normalized
 * Bar/Quote events, manages reconnect/backoff, and never leaks vendor
 * details upstream.
 */

import type {
  Bar,
  BarsPage,
  HistoricalBarsProvider,
  MarketDataProvider,
  Quote,
  RealtimeBarsProvider,
  RealtimeHandler,
  RealtimeQuotesProvider,
  SymbolInfo,
  Unsubscribe,
} from '../../provider-sdk/types';
import type { ConnectionStatus, Timeframe } from '../../core/types';
import { TIMEFRAME_SECONDS } from '../../core/types';

const REST_BASE = 'https://api.binance.com/api/v3';
const WS_BASE = 'wss://stream.binance.com:9443/stream';

const TF_TO_BINANCE: Record<Timeframe, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

interface PairSpec {
  symbol: string;
  pair: string;
  name: string;
}

const PAIRS: PairSpec[] = [
  { symbol: 'BTCUSD', pair: 'btcusdt', name: 'Bitcoin / TetherUS' },
  { symbol: 'ETHUSD', pair: 'ethusdt', name: 'Ethereum / TetherUS' },
  { symbol: 'SOLUSD', pair: 'solusdt', name: 'Solana / TetherUS' },
  { symbol: 'BNBUSD', pair: 'bnbusdt', name: 'BNB / TetherUS' },
  { symbol: 'XRPUSD', pair: 'xrpusdt', name: 'XRP / TetherUS' },
  { symbol: 'DOGEUSD', pair: 'dogeusdt', name: 'Dogecoin / TetherUS' },
  { symbol: 'ADAUSD', pair: 'adausdt', name: 'Cardano / TetherUS' },
  { symbol: 'LINKUSD', pair: 'linkusdt', name: 'Chainlink / TetherUS' },
  { symbol: 'AVAXUSD', pair: 'avaxusdt', name: 'Avalanche / TetherUS' },
  { symbol: 'LTCUSD', pair: 'ltcusdt', name: 'Litecoin / TetherUS' },
];

const BY_SYMBOL = new Map(PAIRS.map((p) => [p.symbol, p]));
const PRECISION = 2;

function toSymbolInfo(p: PairSpec): SymbolInfo {
  return {
    symbol: p.symbol,
    name: p.name,
    exchange: 'BINANCE',
    type: 'crypto',
    ticker: p.symbol,
    description: p.name,
    sessionModel: 'continuous',
    pricePrecision: PRECISION,
    minMove: 0.01,
    timezone: 'UTC',
    tags: ['crypto', 'binance'],
  };
}

/** Continuous markets anchor VWAP/sessions per UTC day. */
function withDailySessionFlags(bars: Bar[], timeframe: Timeframe): Bar[] {
  const tfSec = TIMEFRAME_SECONDS[timeframe];
  return bars.map((b) => ({
    ...b,
    sessionStart: b.time % 86400 < tfSec || undefined,
  }));
}

// ---------------------------------------------------------------------------
// WebSocket connection manager with reconnect + backoff
// ---------------------------------------------------------------------------

type StreamHandler = (stream: string, payload: unknown) => void;

class BinanceSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<StreamHandler>();
  private streams = new Set<string>();
  private subscribed = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private onStatus: (s: ConnectionStatus) => void;

  constructor(onStatus: (s: ConnectionStatus) => void) {
    this.onStatus = onStatus;
  }

  addStream(stream: string, handler: StreamHandler): Unsubscribe {
    const isNew = this.streams.size === 0;
    this.streams.add(stream);
    this.handlers.add(handler);
    if (isNew) {
      this.connect();
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe([stream], 'SUBSCRIBE');
    }
    return () => {
      this.handlers.delete(handler);
      this.streams.delete(stream);
      if (this.subscribed.has(stream)) {
        this.sendSubscribe([stream], 'UNSUBSCRIBE');
        this.subscribed.delete(stream);
      }
      if (this.streams.size === 0) this.close();
    };
  }

  private sendSubscribe(streams: string[], method: 'SUBSCRIBE' | 'UNSUBSCRIBE'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ method, params: streams, id: Date.now() % 1e9 }));
    } catch {
      /* socket will reconnect anyway */
    }
  }

  private connect(): void {
    if (typeof WebSocket === 'undefined') return; // SSR safety
    this.closedByUser = false;
    this.onStatus(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    const streamList = Array.from(this.streams).join('/');
    const url = streamList ? `${WS_BASE}?streams=${streamList}` : WS_BASE;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.subscribed = new Set(this.streams);
      this.onStatus('connected');
      // Streams added while the socket was CONNECTING were never sent on the
      // wire (the URL only carries the first batch). SUBSCRIBE is idempotent,
      // so re-assert the full set explicitly.
      const all = Array.from(this.streams);
      if (all.length > 0) this.sendSubscribe(all, 'SUBSCRIBE');
    };
    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          stream?: string;
          data?: unknown;
        };
        if (msg.stream) {
          for (const h of this.handlers) h(msg.stream, msg.data);
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    this.ws.onerror = () => {
      this.onStatus('reconnecting');
    };
    this.ws.onclose = () => {
      this.subscribed.clear();
      if (this.closedByUser) {
        this.onStatus('disconnected');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(15000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    this.onStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.streams.size > 0) this.connect();
    }, delay);
  }

  /** After reconnect, the combined-stream URL already contains streams. */
  resubscribeAll(): void {
    this.subscribed = new Set(this.streams);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribed.clear();
    this.onStatus('disconnected');
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface KlineMsg {
  e: string;
  s: string;
  k: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
    x: boolean;
  };
}

interface MiniTickerMsg {
  e: string;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
}

export class BinanceMarketProvider implements MarketDataProvider {
  readonly id = 'binance';
  readonly name = 'Binance (public)';

  /** Provider-appropriate default watchlist (short tickers). */
  readonly defaultWatchlist: string[] = PAIRS.map((p) => p.symbol);

  private socket: BinanceSocket;
  private statusValue: ConnectionStatus = 'idle';
  private statusHandlers = new Set<(s: ConnectionStatus) => void>();

  constructor() {
    this.socket = new BinanceSocket((s) => {
      this.statusValue = s;
      for (const h of this.statusHandlers) h(s);
    });
  }

  async searchSymbols(query: string, limit = 20): Promise<SymbolInfo[]> {
    const q = query.trim().toUpperCase();
    const filtered = q
      ? PAIRS.filter(
          (p) =>
            p.symbol.includes(q) ||
            p.name.toUpperCase().includes(q) ||
            p.pair.includes(q.toLowerCase()),
        )
      : PAIRS;
    return filtered.slice(0, limit).map(toSymbolInfo);
  }

  async getSymbol(symbol: string): Promise<SymbolInfo> {
    const pair = BY_SYMBOL.get(symbol);
    if (!pair) throw new Error(`Unknown Binance symbol: ${symbol}`);
    return toSymbolInfo(pair);
  }

  history(): HistoricalBarsProvider {
    return {
      fetchBars: async ({ symbol, timeframe, end, limit }) => {
        const pair = BY_SYMBOL.get(symbol);
        if (!pair) throw new Error(`Unknown Binance symbol: ${symbol}`);
        const interval = TF_TO_BINANCE[timeframe];
        const want = Math.min(Math.max(limit, 1), 5000);
        // Pages are fetched newest-first; each page is ascending internally.
        const pages: Bar[][] = [];
        let endTime = end !== undefined ? end * 1000 - 1 : undefined;
        let hasMore = true;
        while (pages.length * 1000 < want && hasMore) {
          const page = Math.min(1000, want - pages.length * 1000);
          const url =
            `${REST_BASE}/klines?symbol=${pair.pair.toUpperCase()}` +
            `&interval=${interval}&limit=${page}` +
            (endTime !== undefined ? `&endTime=${endTime}` : '');
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
          const raw = (await res.json()) as unknown[];
          if (!Array.isArray(raw) || raw.length === 0) {
            hasMore = false;
            break;
          }
          const pageBars: Bar[] = raw.map((row) => {
            const r = row as [number, string, string, string, string, string, ...unknown[]];
            return {
              time: Math.floor(r[0] / 1000),
              open: parseFloat(r[1]),
              high: parseFloat(r[2]),
              low: parseFloat(r[3]),
              close: parseFloat(r[4]),
              volume: parseFloat(r[5]),
            };
          });
          pages.push(pageBars);
          endTime = pageBars[0].time * 1000 - 1;
          if (raw.length < page) hasMore = false;
        }
        // Assemble ascending: oldest page first.
        const bars: Bar[] = [];
        for (let i = pages.length - 1; i >= 0; i--) bars.push(...pages[i]);
        return { bars: withDailySessionFlags(bars, timeframe), hasMore };
      },
    };
  }

  bars(): RealtimeBarsProvider {
    return {
      subscribeBars: (symbol, timeframe, handler) => {
        const pair = BY_SYMBOL.get(symbol);
        if (!pair) throw new Error(`Unknown Binance symbol: ${symbol}`);
        const stream = `${pair.pair}@kline_${TF_TO_BINANCE[timeframe]}`;
        return this.socket.addStream(stream, (s, payload) => {
          if (s !== stream) return; // combined socket fans ALL streams out
          const msg = payload as KlineMsg;
          if (!msg || msg.e !== 'kline') return;
          const k = msg.k;
          const time = Math.floor(k.t / 1000);
          handler({
            time,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            sessionStart: time % 86400 < TIMEFRAME_SECONDS[timeframe] || undefined,
          });
        });
      },
    };
  }

  trades(): null {
    return null; // kline stream is authoritative for the chart
  }

  quotes(): RealtimeQuotesProvider {
    return {
      subscribeQuotes: (symbols, handler) => {
        const unsubs: Unsubscribe[] = [];
        for (const symbol of symbols) {
          const pair = BY_SYMBOL.get(symbol);
          if (!pair) continue;
          const stream = `${pair.pair}@miniTicker`;
          unsubs.push(
            this.socket.addStream(stream, (s, payload) => {
              if (s !== stream) return; // combined socket fans ALL streams out
              const msg = payload as MiniTickerMsg;
              if (!msg || msg.e !== '24hrMiniTicker') return;
              const quote: Quote = {
                symbol,
                time: Math.floor(Date.now() / 1000),
                last: parseFloat(msg.c),
                dayOpen: parseFloat(msg.o),
                dayHigh: parseFloat(msg.h),
                dayLow: parseFloat(msg.l),
                volume: parseFloat(msg.v),
              };
              handler(quote);
            }),
          );
        }
        return () => unsubs.forEach((u) => u());
      },
    };
  }

  status(): ConnectionStatus {
    return this.statusValue;
  }

  onStatus(handler: (s: ConnectionStatus) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    // Connection is lazy; first subscription opens the socket.
  }

  disconnect(): void {
    this.socket.close();
  }
}
