# Data-Provider Interface Documentation

The charting system knows nothing about any vendor. It consumes the contracts
in `src/provider-sdk/types.ts`. This document is the complete authoring guide
for plugging any market-data source into the platform.

---

## 1. Contracts overview

```ts
interface MarketDataProvider {
  readonly id: string;          // unique, used by the provider registry
  readonly name: string;        // shown in the status bar

  searchSymbols(query: string, limit?: number): Promise<SymbolInfo[]>;
  getSymbol(symbol: string): Promise<SymbolInfo>;

  history(): HistoricalBarsProvider;
  bars(): RealtimeBarsProvider | null;    // preferred realtime path
  trades(): RealtimeTradesProvider | null; // aggregated client-side if no bars()
  quotes(): RealtimeQuotesProvider | null; // watchlist / details panels

  connect?(): Promise<void>;   // optional eager connect (WebSocket transports)
  disconnect?(): void;
  status(): ConnectionStatus;
  onStatus(handler: (s: ConnectionStatus) => void): Unsubscribe;
}
```

Capability accessors return `null` when unsupported. The engine degrades
gracefully:

| bars() | trades() | Behavior |
|---|---|---|
| ✓ | any | realtime bar stream drives the current candle |
| ✗ | ✓ | trades are folded client-side via `TradeAggregator` |
| ✗ | ✗ | chart is historical-only (still fully usable) |

## 2. Normalized events

```ts
interface Bar {
  time: number;        // bucket OPEN time, UTC seconds (not ms!)
  open: number; high: number; low: number; close: number;
  volume: number;
  sessionStart?: boolean; // first bar of a REGULAR session → session breaks, VWAP reset
  extended?: boolean;     // pre/post-market bar → extended-hours shading
}

interface Trade {
  time: number;          // UTC seconds
  price: number;
  size: number;
  side?: 'buy' | 'sell';
  id?: string;
}

interface Quote {
  symbol: string; time: number;
  last: number;
  bid?: number; ask?: number;
  dayOpen?: number; dayHigh?: number; dayLow?: number;
  prevClose?: number; volume?: number;
}
```

### Hard requirements

1. **Bar times are UTC seconds** and align to bucket opens
   (`t % TIMEFRAME_SECONDS[tf] === 0` for continuous markets). The UI
   displays UTC.
2. **History pages are strictly ascending by time** and pages are
   *exclusive* of the `end` boundary. (The engine defensively normalizes
   unsorted data, but don't rely on it — sorting 100k rows costs.)
3. **Session flags drive features.** Without `sessionStart`, session breaks
   and VWAP resets degrade to daily (UTC) anchors for equity symbols;
   crypto/continuous symbols don't need them.

## 3. Symbol metadata

```ts
interface SymbolInfo {
  symbol: string;            // canonical request id, e.g. "BTCUSD"
  name: string;              // full name (search + details)
  exchange: string;          // display code ("BINANCE", "NASDAQ")
  type: 'crypto' | 'stock' | 'index' | 'forex' | 'futures';
  ticker: string;            // short legend/watchlist code
  description?: string;
  sessionModel: 'equity' | 'continuous';
  pricePrecision: number;    // axis/legend formatting
  minMove: number;           // tick size
  timezone?: string;         // informational (display is UTC)
  tags?: string[];           // search ranking
}
```

## 4. Historical pagination

```ts
interface BarsRequest {
  symbol: string;
  timeframe: Timeframe;      // '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w'
  end?: number;              // UTC seconds — return bars strictly BEFORE this
  limit: number;             // max bars to return
}

interface HistoricalBarsProvider {
  fetchBars(request: BarsRequest): Promise<{ bars: Bar[]; hasMore: boolean }>;
}
```

- `end` omitted → page from the most recent data.
- `hasMore: false` stops pagination permanently for that load.
- The engine requests pages of **5000** as the user pans toward the left
  edge (60 bars of headroom), prepends them into the typed-array store and
  shifts the visible range so the viewport is stable.

Reference implementation to copy from:

- **`src/providers/binance/index.ts`** — vendor paging loop (newest-first
  REST pages re-assembled ascending).

## 5. Realtime contracts

```ts
interface RealtimeBarsProvider {
  subscribeBars(symbol: string, timeframe: Timeframe, handler: (bar: Bar) => void): Unsubscribe;
}
interface RealtimeTradesProvider {
  subscribeTrades(symbol: string, handler: (trade: Trade) => void): Unsubscribe;
}
interface RealtimeQuotesProvider {
  subscribeQuotes(symbols: string[], handler: (quote: Quote) => void): Unsubscribe;
}
```

Rules:

- Return an **idempotent unsubscribe**; after the last unsubscribe for a
  symbol you should tear down vendor subscriptions (refcount handlers per
  symbol and clean up at zero).
- Push updates as they arrive; **do not throttle yourself** — the engine's
  `BatchingIngestor` coalesces everything (50 ms flush by default, quote
  collapsing per symbol, bar rollover preservation). That layer exists
  precisely so providers can stay dumb and correct.
- Reconnect logic belongs in the provider (see `BinanceSocket`:
  exponential backoff 1s → 15s, status events `reconnecting`).

## 6. WebSocket ingestion pattern

For a vendor WebSocket, the recommended adapter shape (as in the Binance
provider):

1. **Connection manager** owning one socket, a `Set<string>` of streams,
   explicit SUBSCRIBE/UNSUBSCRIBE frames, reconnect+backoff, and status
   fan-out.
2. **Re-assert subscriptions on open** — streams added while the socket was
   CONNECTING are not on the wire yet (this bit us in testing; the Binance
   adapter re-subscribes the full set on every open).
3. **Map vendor payloads → normalized events** at the adapter boundary.
   Vendor field names must not leak past this file.
4. Feed normalized events into the returned handler — never into the chart.

## 7. Registration

```ts
// src/lib/provider-registry.ts
export const PROVIDERS: MarketDataProvider[] = [
  new BinanceMarketProvider(),
  new MyVendorProvider(),   // ← add here; the status-bar menu picks it up
];
```

The active provider is switchable at runtime (`engine.setProvider(p)`); the
engine cancels the old subscriptions, reloads the current symbol/timeframe
from the new provider and re-subscribes. Drawings are provider-independent
(anchored in time/price).

## 8. Testing checklist for a new provider


- [ ] `fetchBars` returns ascending bars; `end` boundary is exclusive
- [ ] `hasMore` eventually false (or documented infinite)
- [ ] Unsubscribing stops all vendor traffic for that symbol
- [ ] Status transitions: `connecting → connected`, `reconnecting` on drop
- [ ] Quotes include `dayOpen` (watchlist change% needs it)
- [ ] Works with extended-hours display toggles (`extended` flag) if equity
- [ ] Reload the page mid-stream — no duplicate/zero bars after reconnect

## 9. Server-side vendor bridges (the TradingView pattern)

Some vendors cannot be reached from a browser (custom Origin headers, private
protocols, IP allowlists). The provider seam supports a two-tier adapter:

```
Browser adapter (provider-sdk vocabulary)
   └── socket.io over the gateway:  io('/?XTransformPort=<port>')
          └── Node bridge mini-service (mini-services/<vendor>-bridge/)
                 └── vendor SDK / raw WebSocket
```

Rules for a bridge:

- Translate vendor payloads to normalized `Bar`/`Quote`/`Trade` events on the
  server; the browser adapter stays vendor-agnostic.
- Use socket.io **ack callbacks** for request/response RPCs (`history`,
  `meta`, `search`) and plain events for streams. Ack payloads must survive
  as single arguments — socket.io does NOT wrap them, so array results pass
  through untouched (a wrong "unwrap first element" on the client silently
  corrupts array acks — this bit us during integration).
- Coalesce high-frequency vendor streams server-side (the bridge flushes bar
  bursts at 10 Hz) in addition to the client's BatchingIngestor.
- Supervise vendor connections: one client, reconnect with backoff, full
  resubscribe of charts/quotes after reconnect, per-socket cleanup on
  disconnect.
- Keep the bridge port out of URLs — only `XTransformPort` in the query.

The reference implementation is `mini-services/tradingview-bridge/` with the
browser adapter in `src/providers/tradingview/index.ts`.

## 10. In-tree providers

| Provider | History | Realtime | Notes |
|---|---|---|---|
| `binance` | `/api/v3/klines` (1000/page loop) | combined WS: `@kline_<tf>` + `@miniTicker` | public endpoints, no key; browser CORS OK |
| `tradingview` | TradingView chart sessions (chunked `to`/`range` fetches) | TV chart + quote sessions via socket.io bridge | Node-only library behind `mini-services/tradingview-bridge`; full TV symbol universe (`EXCHANGE:SYMBOL` ids) |
