/**
 * TradingView provider — browser adapter for the `@mathieuc/tradingview`
 * library (github.com/Mathieu2301/TradingView-API).
 *
 * The library itself is Node-only (it needs server-controlled Origin
 * headers), so it runs inside the `mini-services/tradingview-bridge`
 * socket.io service. This adapter speaks the normalized provider-sdk
 * vocabulary over the gateway:
 *
 *   io('/?XTransformPort=3014')
 *     tv:history / tv:meta / tv:search          (ack RPCs)
 *     tv:subscribe-bars  → tv:bar { subId, bar, isNew }
 *     tv:subscribe-quotes → tv:quote { subId, quote }
 *     tv:status { status }
 *
 * Symbols use TradingView's full format: 'BINANCE:BTCUSDT', 'NASDAQ:AAPL',
 * 'SP:SPX', 'FX:EURUSD' — the search dialog queries TradingView's universe.
 */

import { io, type Socket } from 'socket.io-client';

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

const BRIDGE_QUERY = 'XTransformPort=3014';
const ACK_TIMEOUT_MS = 20000;

interface HistoryAck {
  bars?: Bar[];
  hasMore?: boolean;
  error?: string;
}

export class TradingViewProvider implements MarketDataProvider {
  readonly id = 'tradingview';
  readonly name = 'TradingView (bridge)';

  /** Provider-appropriate default watchlist (full TV symbols). */
  readonly defaultWatchlist: string[] = [
    'BINANCE:BTCUSDT',
    'BINANCE:ETHUSDT',
    'BINANCE:SOLUSDT',
    'NASDAQ:AAPL',
    'NASDAQ:NVDA',
    'NASDAQ:TSLA',
    'SP:SPX',
    'FX:EURUSD',
  ];

  private socket: Socket | null = null;
  private statusValue: ConnectionStatus = 'idle';
  private statusHandlers = new Set<(s: ConnectionStatus) => void>();
  private seq = 0;
  private bridgeStatus: ConnectionStatus | null = null;

  // -- MarketDataProvider ---------------------------------------------------

  async searchSymbols(query: string, limit = 20): Promise<SymbolInfo[]> {
    const socket = this.ensureSocket();
    const res = await this.emitAck<SymbolInfo[]>(socket, 'tv:search', { query, limit });
    return Array.isArray(res) ? res : [];
  }

  async getSymbol(symbol: string): Promise<SymbolInfo> {
    const socket = this.ensureSocket();
    const res = await this.emitAck<SymbolInfo>(socket, 'tv:meta', { symbol });
    if (!res || typeof res !== 'object' || !('symbol' in res)) {
      throw new Error(`Unknown symbol: ${symbol}`);
    }
    return res;
  }

  history(): HistoricalBarsProvider {
    return {
      fetchBars: async ({ symbol, timeframe, end, limit }): Promise<BarsPage> => {
        const socket = this.ensureSocket();
        const res = await this.emitAck<HistoryAck>(socket, 'tv:history', {
          symbol,
          timeframe,
          end,
          limit,
        });
        if (res.error) throw new Error(res.error);
        return { bars: res.bars ?? [], hasMore: res.hasMore ?? false };
      },
    };
  }

  bars(): RealtimeBarsProvider {
    return {
      subscribeBars: (symbol: string, timeframe: Timeframe, handler: RealtimeHandler<Bar>): Unsubscribe => {
        const socket = this.ensureSocket();
        const subId = `b${++this.seq}`;
        const onBar = (msg: { subId: string; bar: Bar }) => {
          if (msg.subId !== subId) return;
          handler(msg.bar);
        };
        const onError = (msg: { subId: string; error?: string }) => {
          if (msg.subId !== subId) return;
          console.error(`[tv-provider] bar stream error (${symbol}):`, msg.error);
        };
        socket.on('tv:bar', onBar);
        socket.on('tv:bar-error', onError);
        socket.emit('tv:subscribe-bars', { subId, symbol, timeframe });
        return () => {
          socket.off('tv:bar', onBar);
          socket.off('tv:bar-error', onError);
          socket.emit('tv:unsubscribe', { subId });
        };
      },
    };
  }

  trades(): null {
    return null; // TV gives us bars directly
  }

  quotes(): RealtimeQuotesProvider {
    return {
      subscribeQuotes: (symbols: string[], handler: RealtimeHandler<Quote>): Unsubscribe => {
        const socket = this.ensureSocket();
        const subId = `q${++this.seq}`;
        const onQuote = (msg: { subId: string; quote: Quote }) => {
          if (msg.subId !== subId) return;
          handler(msg.quote);
        };
        socket.on('tv:quote', onQuote);
        socket.emit('tv:subscribe-quotes', { subId, symbols });
        return () => {
          socket.off('tv:quote', onQuote);
          socket.emit('tv:unsubscribe', { subId });
        };
      },
    };
  }

  /** Fail fast so the UI can surface a toast when the bridge is down. */
  async connect(): Promise<void> {
    const socket = this.ensureSocket();
    if (socket.connected) {
      this.setStatus(this.mapBridgeStatus());
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('TradingView bridge unreachable (is mini-services/tradingview-bridge running?)'));
      }, 6000);
      const onConnect = () => {
        cleanup();
        this.setStatus(this.mapBridgeStatus());
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(new Error(`TradingView bridge error: ${err.message}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };
      socket.on('connect', onConnect);
      socket.on('connect_error', onError);
      socket.connect();
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  status(): ConnectionStatus {
    return this.statusValue;
  }

  onStatus(handler: (s: ConnectionStatus) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  // -- Internals -------------------------------------------------------------

  private mapBridgeStatus(): ConnectionStatus {
    if (this.bridgeStatus) return this.bridgeStatus;
    if (this.socket?.connected) return 'connected';
    return 'connecting';
  }

  private ensureSocket(): Socket {
    if (this.socket) return this.socket;
    const socket = io(`/?${BRIDGE_QUERY}`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 8000,
    });
    socket.on('connect', () => this.setStatus(this.mapBridgeStatus()));
    socket.on('disconnect', () => this.setStatus('reconnecting'));
    socket.on('connect_error', () => this.setStatus('reconnecting'));
    socket.io.on('reconnect', () => this.setStatus(this.mapBridgeStatus()));
    socket.on('tv:status', ({ status }: { status: string }) => {
      const mapped: ConnectionStatus =
        status === 'connected'
          ? 'connected'
          : status === 'reconnecting'
            ? 'reconnecting'
            : status === 'error'
              ? 'error'
              : status === 'connecting'
                ? 'connecting'
                : 'idle';
      this.bridgeStatus = mapped;
      this.setStatus(mapped);
    });
    this.socket = socket;
    return socket;
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.statusValue === s) return;
    this.statusValue = s;
    for (const h of this.statusHandlers) h(s);
  }

  private emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} timed out`)), ACK_TIMEOUT_MS + 1000);
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit(event, payload, (timeoutErr: unknown, ackResult: unknown) => {
          clearTimeout(timer);
          if (timeoutErr) {
            reject(new Error(`${event} ack timeout`));
            return;
          }
          // socket.io passes a single ack arg through directly (no wrapping) —
          // array payloads (tv:search) must survive untouched.
          const res = ackResult as T & { error?: string };
          if (res && typeof res === 'object' && !Array.isArray(res) && 'error' in res && res.error) {
            reject(new Error(res.error as string));
            return;
          }
          resolve(res);
        });
    });
  }
}
