# OpenChart — Open-Source Trading Charting Platform

A modular, provider-agnostic trading chart engine built entirely on open-source
components. Not a demo — this is the foundation of a real charting product:
a typed-array data core, a worker-backed indicator engine, a fully decoupled
drawing engine, batched realtime ingestion, and a pluggable market-data SDK.

**Chart rendering:** [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0) —
used as the rendering backend behind a strict adapter seam, exactly as a
building block. No proprietary SDKs, no embedded TradingView widgets.

---

## Feature matrix

### Core chart
- Candlestick, OHLC bar, line, area and **Heikin-Ashi** charts
- Volume histogram (overlay scale, buy/sell colored)
- **Multiple synchronized panes** (RSI/MACD/ATR sub-panes, resizable)
- Multiple price scales (left/right visible scales + overlay scales)
- Timeframe switching (1m → 1W) and symbol switching (searchable)
- Smooth mouse/touch pan & zoom (native LWC gestures + kinetic scroll)
- **Crosshair synchronized across all panes**, magnet (OHLC snap) mode
- Price/time tooltips via axis labels + OHLC legend
- Autoscaling, **logarithmic** and **percentage** scale modes
- Extended-hours sessions (pre/post-market) with **session breaks**
  and extended-hours shading (equity symbols)
- **Real-time candle updates** (tick → aggregate → coalesce → update)
- **Bar replay** — time freezes at any bar (right-click → "Start bar replay
  from here", or `Alt+R`), then step (`,`/`.` or arrows), play/pause
  (`space`) at 0.5×–10× speed; realtime streams pause, indicators and
  markers track the replay cursor
- **Strategy Tester (backtesting)** — EMA Cross, RSI Reversion, MACD Cross,
  Bollinger Reversion: configurable params, long-only / long-short,
  commission % and optional SL/TP; honest fill semantics (signals on close,
  fills at next open, intrabar protective exits); net profit, buy & hold,
  win rate, profit factor, max drawdown, expectancy, per-trade table and
  equity curve; entries/exits render as chart markers
- **Historical pagination** when scrolling backward (5k-bar pages,
  visible-range preserving)
- Efficient handling of hundreds of thousands of bars (typed-array store,
  viewport-based rendering, indicator downsampling)

### Watchlist & tools
- Live quotes with per-symbol prices, day change %, imperative tick flash
- **Add/remove symbols** (+ button → search in add mode, hover × to remove)
- **Per-provider persistence** — each provider's watchlist survives reloads
- Symbol details block (day O/H/L/V, session model)

### Indicator engine
- Built-ins: **SMA, EMA, VWAP (session-anchored), RSI, MACD, Bollinger Bands
  (with band fill), ATR, Volume Profile (visible range)**
- Overlays on price **or** independent panes, dynamically added/removed
- Params editable at runtime (dialog), instances toggleable
- **Web Worker computation** with zero-copy buffer transfer + inline fallback
- Incremental realtime updates via bounded-tail recompute (O(window) per tick)
- **Plugin API** for community indicators — see
  [docs/indicator-plugins.md](docs/indicator-plugins.md)

### Drawing engine
- **19 tools** — trend line, ray, extended line, arrow, horizontal ray,
  horizontal line, vertical line, cross line, rectangle, triangle, ellipse,
  price range, date range, Fibonacci retracement, Andrews' pitchfork,
  parallel channel, **long position, short position**, text annotation
- **Long/Short Position planners** — TradingView-style risk/reward boxes:
  entry/stop/target levels (default 1% risk / 2% reward, R/R label),
  profit (green) and loss (red) zones, entry handle moves the whole plan,
  stop/target handles resize their level and the plan width
- **Grouped toolbar with flyout menus** — click a group (lines & rays,
  shapes, ranges, fib & channels, positions) to pick a tool; the button
  remembers the last-used tool, exactly like TradingView
- Selection, dragging, resizing (endpoint/corner handles), delete
- **Text annotations** — inline editor on placement, double-click to re-edit
- Per-object style properties (color / width / dash) via floating editor
- **Right-click context menu** — horizontal line at price, replay from
  this bar, copy price, reset view
- **Bar-close countdown** on the last-price label (hidden during replay)
- **PNG export** (camera button) of the visible chart
- **Serialization** to versioned JSON, **restoration** (per-symbol localStorage)
- **Undo/redo** (command stack, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
- **Magnet mode** snapping anchors to OHLC
- **Zero coupling to Lightweight Charts internals** — drawings live in
  time/price space and project through a `CoordinateSpace` interface
  (see "The adapter seam" below)

### Data architecture
- No vendor hard-coding. Contracts only:
  `MarketDataProvider`, `HistoricalBarsProvider`, `RealtimeBarsProvider`,
  `RealtimeTradesProvider`, `RealtimeQuotesProvider`
- Normalized events: **`Bar`**, **`Trade`**, **`Quote`**
- **BatchingIngestor** — coalesces high-frequency updates (50 ms flush),
  collapses quotes per symbol, preserves bar rollovers
- **TradeAggregator** — folds raw trade prints into OHLCV buckets
  (for vendors whose realtime feed is trade-level, e.g. exchange tick streams)
- Two real providers ship in-tree:
  - `binance` — real public crypto data (REST klines + combined WS streams,
    no API key), a production vendor adapter with reconnect/backoff
  - `tradingview` — the **full TradingView instrument universe** via
    [`@mathieuc/tradingview`](https://github.com/Mathieu2301/TradingView-API)
    (Mathieu2301/TradingView-API). The library is Node-only, so it runs in a
    socket.io bridge mini-service (`mini-services/tradingview-bridge`) and the
    browser adapter speaks the normalized provider-sdk vocabulary over the
    gateway (`/?XTransformPort=3014`) — see "TradingView bridge" below
- Swapping providers never touches chart/indicator/drawing code — switch
  providers live from the status bar; symbol + watchlist realign to each
  provider's instrument universe automatically

---

## Quick start

```bash
bun install
bun run dev          # http://localhost:3000
bun run lint
bunx tsc --noEmit
bun scripts/test-bar-store.ts   # store pagination stress test
```

Try: switch symbol (click the symbol chip), switch timeframe, pan left past
history (pagination), add indicators, draw a trendline. The app boots on the
**Binance (public)** provider; switch to **TradingView (bridge)** in the
status bar for the full multi-exchange universe (stocks, indices, forex).

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ ui (Next.js App Router, React 19)                                  │
│   shell only — toolbars/panels/dialogs; NO tick-path re-renders    │
└───────────────┬────────────────────────────────────────────────────┘
                │ facade calls + low-frequency events
┌───────────────▼────────────────────────────────────────────────────┐
│ chart-core (ChartEngine — composition root)                        │
│   typed event bus · display settings · symbol/TF lifecycle         │
├──────────────┬───────────────────┬─────────────────┬───────────────┤
│ data-engine  │ indicator-engine  │ drawing-engine  │ chart-renderer│
│ BarStore     │ plugin API        │ 19 tools        │ LWC adapter   │
│ (typed cols) │ registry          │ hit-testing     │ overlay canvas│
│ pagination   │ worker scheduler  │ command stack   │ CoordinateSpace│
└──────┬───────┴─────────┬─────────┴────────┬────────┴───────┬───────┘
       │                 │                  │                │
┌──────▼─────────────────▼──────────────────▼────────────────▼───────┐
│ provider-sdk (contracts + plumbing)                                 │
│   MarketDataProvider · HistoricalBarsProvider · Realtime*           │
│   BatchingIngestor · TradeAggregator                                │
└──────┬──────────────────────────────┬───────────────────────────────┘
       │                              │
       │                 ┌────────────▼──────────────┐
       │                 │ providers/binance         │
       │                 │ (real REST + WebSocket)   │
       │                 └───────────────────────────┘
┌──────▼─────────────────────────────────────────────────────────────┐
│ providers/tradingview                                              │
│ (browser adapter → gateway → mini-services/tradingview-bridge)     │
└────────────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point one way. `provider-sdk` and `core/types`
depend on nothing. The drawing and indicator engines never import the chart
library — they talk to narrow interfaces (`CoordinateSpace`,
`IndicatorRenderHost`) that `chart-renderer` implements.

### Module map

| Path | Package | Responsibility |
|---|---|---|
| `src/core/` | chart-core | shared types, `TypedEmitter`, math utils, `ChartEngine` facade |
| `src/data/` | data-engine | `BarStore` (column-oriented typed arrays), pagination glue |
| `src/provider-sdk/` | provider-sdk | contracts, `BatchingIngestor`, `TradeAggregator` |
| `src/providers/` | provider plugins | `binance`, `tradingview` adapters |
| `src/indicators/` | indicator-engine | plugin API, registry, 8 built-ins, worker scheduler, instance engine |
| `src/drawings/` | drawing-engine | model, geometry, renderer, interactions, history, manager |
| `src/render/` | chart-renderer | LWC adapter, `CoordinateSpace`, overlay layers, legend controller |
| `src/components/workspace/` | ui | terminal shell (top bar, toolbars, panels, dialogs) |

### The adapter seam (renderer replaceability)

`src/render/coordinate-space.ts` defines:

```ts
interface CoordinateSpace {
  timeToX(time: number): number | null;   // fractional logical indexing
  xToTime(x: number): number | null;      // interpolates + extrapolates
  priceToY(price: number): number | null;
  yToPrice(y: number): number | null;
  mainPaneRect(): Rect | null;
}
```

The drawing engine renders and hit-tests **only** through this interface, so
replacing Lightweight Charts with a custom WebGL/WebGPU renderer means
reimplementing one class plus the `IndicatorRenderHost` methods — drawings,
indicators, and the UI are untouched.

### Performance model

1. **Typed arrays everywhere.** `BarStore` keeps `times/open/high/low/close/
   volume/flags` in pre-allocated `Float64Array` columns with head-cursor
   prepends (no copies per page) and O(1) appends. Indicator workers receive
   transferred buffers (zero-copy).
2. **Batched realtime.** Provider events → `BatchingIngestor` (50 ms flush,
   quote coalescing) → one store mutation + one `series.update()` per flush —
   never per tick.
3. **No React on the hot path.** Ticks and crosshair moves update legends,
   watchlist rows and stats via imperative DOM writes (`textContent`), and
   chart pixels via LWC's canvas. React renders only on user actions.
4. **Overlay canvas with rAF dirty-flags.** Sessions/volume-profile/drawings
   redraw coalesced into one `requestAnimationFrame`; per-layer dirty hooks.
5. **Incremental indicators.** Realtime ticks recompute only a bounded tail
   (`max(4×period, 400)` bars) and push the last point; full recomputes run
   in the Web Worker on load/pagination.
6. **Viewport-based rendering.** LWC renders only visible bars
   (`minBarSpacing: 0.08` → zoom out to 300k+ bars stays responsive);
   overlay layers iterate only the visible index range.

Load test: page backward repeatedly — the store stress script validates
33k+ bars across 6 prepend pages (ascending times, content integrity).

### TradingView bridge (`mini-services/tradingview-bridge`)

The [Mathieu2301/TradingView-API](https://github.com/Mathieu2301/TradingView-API)
library connects to TradingView's WebSocket feed from Node (custom `Origin`
headers, guest or user tokens). Browsers cannot set those headers, so the
integration is split exactly along the provider seam:

```
browser (TradingViewProvider)  →  gateway  →  bridge mini-service  →  TradingView
  io('/?XTransformPort=3014')      (Caddy)     socket.io :3014          wss (Node 'ws')
```

Bridge responsibilities (`mini-services/tradingview-bridge/index.ts`):
- one supervised guest `TradingView.Client` (reconnect + full resubscribe)
- `tv:history` — chunked `setMarket({ to, range })` fetches with
  settle-detection, assembled ascending, session flags inferred
  (gap-based for equities, UTC-day for 24/7 markets)
- `tv:subscribe-bars` — one long-lived chart session per subscription,
  bursts coalesced to 10 Hz before broadcast
- `tv:subscribe-quotes` — TV quote sessions for the watchlist
  (`lp`, day OHLC, prev-close → normalized `Quote`)
- `tv:search` / `tv:meta` — TradingView's symbol universe → `SymbolInfo`
  (search v3 + chart `symbol_resolved` metadata; `spot` → crypto mapping)

Run it (auto-reload on change):

```bash
cd mini-services/tradingview-bridge && bun run dev   # listens on :3014
```

If the bridge is down, the provider surfaces a connection error toast and
`reconnecting` status; other providers keep working. Optional auth:
`new TradingView.Client({ token, signature })` inside the bridge enables
premium-data symbols (free guest accounts get standard markets).

Smoke test: `bunx tsx scripts/test-tv-bridge.ts` (history, pagination
contiguity, session flags, meta, search, realtime bars, quotes).

### Drawing persistence

Serialized per symbol to `localStorage` under `openchart.drawings.<symbol>`
(`{ version: 1, drawings: [...] }`). Anchors are `{ time, price }` pairs, so
drawings survive timeframe switches, reloads and provider swaps.
`DrawingManager.exportJSON()/importJSON()` provide portable backups.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Esc` | cancel creation / deselect |
| `Del` / `Backspace` | delete selected drawing |
| `Ctrl/Cmd+Z` | undo drawing |
| `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` | redo drawing |

---

## Extending

- **Plug in a real data vendor** → [docs/provider-interfaces.md](docs/provider-interfaces.md)
- **Write an indicator** → [docs/indicator-plugins.md](docs/indicator-plugins.md)

Both are pure TypeScript with no framework coupling; register the module and
the UI (search dialog / indicators dialog) picks it up automatically.

## Roadmap (intentionally out of scope for this foundation)

- Server-side symbol watchlists & layout sync (Prisma schema ready to extend)
- Magnet refinements (snap-to-level for fib/channel), drawing locking
- Community plugin loading from remote bundles (registry + sandboxed eval)
- Custom WebGL renderer implementing `CoordinateSpace` for extreme datasets
- Exchange-timezone axis labels (currently UTC)

## License note

Chart rendering uses TradingView Lightweight Charts (Apache-2.0). All engine
code in this repository is original.
