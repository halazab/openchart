/**
 * TradingView bridge — a socket.io mini-service that exposes the
 * `@mathieuc/tradingview` library (Node-only WebSocket client to TradingView)
 * to the browser chart in the normalized provider-sdk event vocabulary.
 *
 * Why a bridge? The TV library needs server-controlled WebSocket headers
 * (Origin) that browsers cannot set. The chart's TradingViewProvider talks
 * to this service over socket.io via the gateway (`/?XTransformPort=3014`).
 *
 * RPC surface (socket.io):
 *   tv:history   { symbol, timeframe, end?, limit }        → ack { bars, hasMore } | { error }
 *   tv:meta      { symbol }                                → ack SymbolInfo | { error }
 *   tv:search    { query, limit }                          → ack SymbolInfo[] | { error }
 *   tv:subscribe-bars   { subId, symbol, timeframe }
 *   tv:subscribe-quotes { subId, symbols[] }
 *   tv:unsubscribe      { subId }
 * Events:
 *   tv:bar    { subId, bar, isNew }
 *   tv:quote  { subId, quote }
 *   tv:status { status }
 */

import { Server } from 'socket.io';
import TradingView, {
  type Client,
  type ChartSession,
  type QuoteSession,
  type TVPeriod,
  type TVQuoteData,
  type TVSymbolInfos,
} from '@mathieuc/tradingview';
import type {
  Bar,
  Quote,
  SymbolInfo,
} from '../../src/provider-sdk/types';
import type { Timeframe } from '../../src/core/types';

const PORT = Number(process.env.PORT || 3014);
const MAX_BARS_PER_TV_REQUEST = 2000;
const MAX_HISTORY_ITERATIONS = 4;
const BAR_FLUSH_MS = 100;
const SYMBOL_SEARCH_LIMIT = 30;

// ---------------------------------------------------------------------------
// Timeframe + type mapping
// ---------------------------------------------------------------------------

const TF_TO_TV: Record<Timeframe, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

const TF_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

function mapType(tvType: string | undefined): SymbolInfo['type'] {
  switch ((tvType ?? '').toLowerCase()) {
    case 'crypto':
    case 'cryptocurrency':
    case 'spot': // chart-session symbol_resolved uses 'spot' for crypto pairs
      return 'crypto';
    case 'index':
    case 'economic':
      return 'index';
    case 'forex':
    case 'fx':
      return 'forex';
    case 'futures':
    case 'fut':
      return 'futures';
    default:
      return 'stock'; // stock / cfd / dr / bond / ''
  }
}

function sessionModelFor(tvType: string | undefined, session: string | undefined): 'equity' | 'continuous' {
  const t = (tvType ?? '').toLowerCase();
  if (t === 'crypto' || t === 'cryptocurrency' || t === 'forex' || t === 'fx') {
    return 'continuous';
  }
  if (session === '24x7') return 'continuous';
  return 'equity';
}

function precisionFromInfos(infos: TVSymbolInfos): { precision: number; minMove: number } {
  const pricescale = Number(infos.pricescale ?? 100);
  const minmov = Number(infos.minmov ?? 1);
  const precision = Math.min(8, Math.max(0, Math.round(Math.log10(pricescale > 0 ? pricescale : 100))));
  return { precision, minMove: minmov / (pricescale > 0 ? pricescale : 100) };
}

// ---------------------------------------------------------------------------
// TV client supervisor (single guest connection, reconnect + resubscribe)
// ---------------------------------------------------------------------------

let client: Client | null = null;
let clientOpen = false;
let bridgeStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' = 'idle';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

const io = new Server(Number(PORT), {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

function broadcastStatus(): void {
  io.emit('tv:status', { status: bridgeStatus });
}

function setStatus(s: typeof bridgeStatus): void {
  if (bridgeStatus === s) return;
  bridgeStatus = s;
  broadcastStatus();
}

function waitForOpen(c: Client, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (c.isOpen) return resolve();
    const timer = setTimeout(() => reject(new Error('TradingView connection timeout')), timeoutMs);
    c.onConnected(() => {
      clearTimeout(timer);
      resolve();
    });
    c.onError((...err) => {
      clearTimeout(timer);
      reject(new Error(`TradingView error: ${err.join(' ')}`));
    });
  });
}

async function ensureClient(): Promise<Client> {
  if (client && clientOpen) return client;
  setStatus(bridgeStatus === 'error' ? 'reconnecting' : 'connecting');
  const next = new TradingView.Client({
    DEBUG: process.env.TV_DEBUG === '1',
  });
  next.onDisconnected(() => {
    clientOpen = false;
    setStatus('reconnecting');
    scheduleReconnect();
  });
  next.onError((...err) => {
    console.error('[tv-bridge] client error:', ...err);
  });
  await waitForOpen(next);
  client = next;
  clientOpen = true;
  reconnectDelay = 1000;
  setStatus('connected');
  return next;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await ensureClient();
      await resubscribeAll();
    } catch (err) {
      console.error('[tv-bridge] reconnect failed:', err);
      reconnectDelay = Math.min(15000, reconnectDelay * 2);
      scheduleReconnect();
    }
  }, reconnectDelay);
}

// ---------------------------------------------------------------------------
// Subscription registries
// ---------------------------------------------------------------------------

interface BarSub {
  socketId: string;
  subId: string;
  symbol: string;
  timeframe: Timeframe;
  chart: ChartSession | null;
  continuous: boolean;
  lastSentTime: number;
  pending: Bar | null;
}

interface QuoteSub {
  socketId: string;
  subId: string;
  symbols: string[];
  session: QuoteSession | null;
  markets: Array<{ market: { close(): void; onData(cb: (d: TVQuoteData) => void): void; onLoaded(cb: () => void): void; onError(cb: (...e: unknown[]) => void): void } }>;
}

const barSubs = new Map<string, BarSub>(); // key `${socketId}:${subId}`
const quoteSubs = new Map<string, QuoteSub>();

function subKey(socketId: string, subId: string): string {
  return `${socketId}:${subId}`;
}

async function resubscribeAll(): Promise<void> {
  for (const sub of barSubs.values()) {
    await attachBarChart(sub).catch((err) =>
      console.error(`[tv-bridge] resubscribe ${sub.symbol} failed:`, err),
    );
  }
  for (const sub of quoteSubs.values()) {
    await attachQuoteSession(sub).catch((err) =>
      console.error('[tv-bridge] quote resubscribe failed:', err),
    );
  }
}

// ---------------------------------------------------------------------------
// History fetching (throwaway chart sessions, settle-detection)
// ---------------------------------------------------------------------------

function periodToBar(
  p: TVPeriod,
  timeframe: Timeframe,
  continuous: boolean,
  prevTime: number | null,
): Bar {
  // Session flags:
  //  - continuous markets (crypto/forex): first bar of each UTC day
  //  - equity markets: first bar after a session gap (data arrives bounded
  //    to regular sessions, so gaps ≈ session breaks)
  const tfSec = TF_SECONDS[timeframe];
  let sessionStart = false;
  if (continuous) {
    sessionStart = p.time % 86400 < tfSec;
  } else if (prevTime !== null) {
    sessionStart = p.time - prevTime > Math.max(2 * tfSec, 5400);
  } else {
    sessionStart = true;
  }
  return {
    time: p.time,
    open: p.open,
    high: p.max,
    low: p.min,
    close: p.close,
    volume: p.volume,
    sessionStart,
  };
}

function fetchChunk(
  symbol: string,
  tvTf: string,
  to: number,
  range: number,
): Promise<{ bars: TVPeriod[]; infos: TVSymbolInfos }> {
  return new Promise(async (resolve, reject) => {
    let chart: ChartSession;
    try {
      const c = await ensureClient();
      chart = new c.Session.Chart();
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          chart.delete();
        } catch {
          /* noop */
        }
        reject(new Error('TradingView history timeout'));
      }
    }, 20000);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(stableTimer ?? undefined);
      clearTimeout(timeout);
      const periods = chart.periods.slice(); // newest-first
      const infos = chart.infos ?? {};
      try {
        chart.delete();
      } catch {
        /* already gone */
      }
      resolve({ bars: periods, infos });
    };

    chart.onError((...err) => {
      if (settled) return;
      settled = true;
      clearTimeout(stableTimer ?? undefined);
      clearTimeout(timeout);
      try {
        chart.delete();
      } catch {
        /* noop */
      }
      reject(new Error(`TradingView: ${err.join(' ')}`));
    });
    chart.onUpdate(() => {
      if (settled) return;
      const have = chart.periods.length;
      // Enough bars loaded → resolve immediately.
      if (have >= range) {
        finish();
        return;
      }
      // Otherwise wait for the stream to go quiet (history arrives in bursts).
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(finish, 3000);
    });
    chart.setMarket(symbol, { timeframe: tvTf, range, to });
  });
}

async function fetchPage(
  symbol: string,
  timeframe: Timeframe,
  end: number | undefined,
  limit: number,
  continuous: boolean,
): Promise<{ bars: Bar[]; hasMore: boolean; infos: TVSymbolInfos }> {
  const tvTf = TF_TO_TV[timeframe];
  let to = end !== undefined ? end : Math.floor(Date.now() / 1000) + 60;
  let infos: TVSymbolInfos = {};
  const collected: TVPeriod[] = [];
  let lastChunkFull = false;

  for (let iter = 0; iter < MAX_HISTORY_ITERATIONS && collected.length < limit; iter++) {
    const want = Math.min(MAX_BARS_PER_TV_REQUEST, limit - collected.length);
    const { bars, infos: chunkInfos } = await fetchChunk(symbol, tvTf, to, want);
    if (iter === 0) infos = chunkInfos;
    if (bars.length === 0) {
      lastChunkFull = false;
      break;
    }
    lastChunkFull = bars.length >= want;
    // bars are newest-first; prepend ascending (chunks are disjoint by construction).
    const ascending = bars.slice().reverse();
    collected.unshift(...ascending);
    to = collected[0].time; // strictly older page next iteration
    if (!lastChunkFull) break;
  }

  // Normalize + session flags.
  const bars: Bar[] = [];
  let prev: number | null = null;
  for (const p of collected) {
    bars.push(periodToBar(p, timeframe, continuous, prev));
    prev = p.time;
  }
  // Dedupe (defensive).
  const deduped: Bar[] = [];
  for (const b of bars) {
    if (deduped.length === 0 || b.time > deduped[deduped.length - 1].time) {
      deduped.push(b);
    }
  }
  return { bars: deduped, hasMore: lastChunkFull && deduped.length >= limit, infos };
}

// ---------------------------------------------------------------------------
// Symbol info
// ---------------------------------------------------------------------------

function infosToSymbolInfo(symbol: string, infos: TVSymbolInfos): SymbolInfo {
  const { precision, minMove } = precisionFromInfos(infos);
  const tvType = (infos.type as string | undefined) ?? '';
  return {
    symbol,
    name: (infos.description as string | undefined) ?? symbol,
    exchange: (infos.exchange as string | undefined) ?? 'TV',
    type: mapType(tvType),
    ticker: (infos.symbol as string | undefined) ?? symbol.split(':').pop() ?? symbol,
    description: (infos.description as string | undefined) ?? undefined,
    sessionModel: sessionModelFor(tvType, infos.session as string | undefined),
    pricePrecision: precision,
    minMove,
    timezone: (infos.timezone as string | undefined) ?? 'UTC',
  };
}

const metaCache = new Map<string, SymbolInfo>();

async function fetchSymbolInfo(symbol: string): Promise<SymbolInfo> {
  const cached = metaCache.get(symbol);
  if (cached) return cached;
  const tvTf = '1';
  const { infos } = await fetchChunk(symbol, tvTf, Math.floor(Date.now() / 1000) + 60, 2);
  if (!infos || Object.keys(infos).length === 0) {
    throw new Error(`Unknown TradingView symbol: ${symbol}`);
  }
  const info = infosToSymbolInfo(symbol, infos);
  metaCache.set(symbol, info);
  return info;
}

async function searchSymbols(query: string, limit: number): Promise<SymbolInfo[]> {
  const results = await TradingView.searchMarketV3(query.trim() || 'popular', '', 0);
  return results.slice(0, limit).map((r) => {
    const tvType = r.type ?? '';
    return {
      symbol: r.id,
      name: r.description,
      exchange: r.exchange ?? r.id.split(':')[0],
      type: mapType(tvType),
      ticker: r.symbol,
      description: r.description,
      sessionModel: sessionModelFor(tvType, undefined),
      pricePrecision: 2,
      minMove: 0.01,
      timezone: 'UTC',
    } satisfies SymbolInfo;
  });
}

// ---------------------------------------------------------------------------
// Bar subscription plumbing
// ---------------------------------------------------------------------------

function flushBar(sub: BarSub): void {
  if (!sub.pending) return;
  const bar = sub.pending;
  sub.pending = null;
  const isNew = bar.time > sub.lastSentTime;
  sub.lastSentTime = Math.max(sub.lastSentTime, bar.time);
  io.to(sub.socketId).emit('tv:bar', { subId: sub.subId, bar, isNew });
}

async function attachBarChart(sub: BarSub): Promise<void> {
  if (sub.chart) {
    try {
      sub.chart.delete();
    } catch {
      /* noop */
    }
    sub.chart = null;
  }
  const c = await ensureClient();
  const chart = new c.Session.Chart();
  sub.chart = chart;
  chart.onError((...err) => {
    console.error(`[tv-bridge] chart error ${sub.symbol}:`, ...err);
    io.to(sub.socketId).emit('tv:bar-error', {
      subId: sub.subId,
      error: err.join(' '),
    });
  });
  chart.onUpdate(() => {
    const periods = chart.periods;
    if (periods.length === 0) return;
    const newest = periods[0]; // newest-first
    sub.pending = periodToBar(newest, sub.timeframe, sub.continuous, sub.lastSentTime || null);
    // Coalesce bursts; flush on the shared timer.
    if (!pendingFlush) pendingFlush = setTimeout(flushAllBars, BAR_FLUSH_MS);
  });
  chart.setMarket(sub.symbol, { timeframe: TF_TO_TV[sub.timeframe], range: 50 });
}

let pendingFlush: ReturnType<typeof setTimeout> | null = null;
function flushAllBars(): void {
  pendingFlush = null;
  for (const sub of barSubs.values()) flushBar(sub);
}

async function attachQuoteSession(sub: QuoteSub): Promise<void> {
  if (sub.session) {
    try {
      sub.session.delete();
    } catch {
      /* noop */
    }
    sub.session = null;
  }
  const c = await ensureClient();
  const session = new c.Session.Quote();
  sub.session = session;
  for (const symbol of sub.symbols) {
    try {
      const market = new session.Market(symbol, 'regular');
      sub.markets.push({ market });
      market.onError((...err) => {
        console.error(`[tv-bridge] quote error ${symbol}:`, ...err);
      });
      market.onData((d: TVQuoteData) => {
        if (!d || (d.s !== undefined && d.s !== 'ok')) return;
        const last = (d.lp ?? d.close_price) as number | undefined;
        if (last === undefined || !Number.isFinite(last)) return;
        const quote: Quote = {
          symbol,
          time: Math.floor(Date.now() / 1000),
          last,
          dayOpen: d.open_price,
          dayHigh: d.high_price,
          dayLow: d.low_price,
          prevClose: d.prev_close_price,
          volume: d.volume,
        };
        io.to(sub.socketId).emit('tv:quote', { subId: sub.subId, quote });
      });
    } catch (err) {
      console.error(`[tv-bridge] quote attach failed ${symbol}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Socket.io RPC surface
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  const socketSubKeys = new Set<string>();

  const track = (key: string) => socketSubKeys.add(key);

  socket.on('tv:history', async (req: { symbol: string; timeframe: Timeframe; end?: number; limit?: number }, ack?: (r: unknown) => void) => {
    if (typeof ack !== 'function') return;
    try {
      const { symbol, timeframe = '1m' } = req ?? {};
      const limit = Math.min(Math.max(Number(req?.limit ?? 500), 10), 20000);
      if (!symbol || !TF_TO_TV[timeframe]) throw new Error('bad request');
      const tvTypeGuess = mapType(undefined);
      void tvTypeGuess;
      // First pass reveals the symbol type; recompute continuous for flags.
      const first = await fetchPage(symbol, timeframe, req?.end, Math.min(limit, MAX_BARS_PER_TV_REQUEST), false);
      let bars = first.bars;
      let hasMore = first.hasMore;
      const infos = first.infos;
      const continuous = sessionModelFor(infos.type as string | undefined, infos.session as string | undefined) === 'continuous';
      if (bars.length > 0) {
        let prev: number | null = null;
        bars = bars.map((b) => {
          const nb = periodToBar(
            { time: b.time, open: b.open, close: b.close, max: b.high, min: b.low, volume: b.volume },
            timeframe,
            continuous,
            prev,
          );
          prev = b.time;
          return nb;
        });
      }
      // Continue filling if the caller wanted more than one TV request.
      if (bars.length > 0 && bars.length < limit && hasMore) {
        const rest = await fetchPage(symbol, timeframe, bars[0].time, limit - bars.length, continuous);
        bars = [...rest.bars, ...bars];
        hasMore = rest.hasMore;
      }
      ack({ bars, hasMore });
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  socket.on('tv:meta', async (req: { symbol: string }, ack?: (r: unknown) => void) => {
    if (typeof ack !== 'function') return;
    try {
      const info = await fetchSymbolInfo(req?.symbol ?? '');
      ack(info);
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  socket.on('tv:search', async (req: { query: string; limit?: number }, ack?: (r: unknown) => void) => {
    if (typeof ack !== 'function') return;
    try {
      const results = await searchSymbols(req?.query ?? '', Math.min(req?.limit ?? 20, SYMBOL_SEARCH_LIMIT));
      ack(results);
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  socket.on('tv:subscribe-bars', async (req: { subId: string; symbol: string; timeframe: Timeframe }) => {
    try {
      const { subId, symbol, timeframe = '1m' } = req ?? {};
      if (!subId || !symbol || !TF_TO_TV[timeframe]) return;
      const key = subKey(socket.id, subId);
      if (barSubs.has(key)) return;
      let continuous = false;
      const meta = metaCache.get(symbol);
      if (meta) continuous = meta.sessionModel === 'continuous';
      const sub: BarSub = { socketId: socket.id, subId, symbol, timeframe, chart: null, continuous, lastSentTime: 0, pending: null };
      barSubs.set(key, sub);
      track(key);
      await attachBarChart(sub);
    } catch (err) {
      console.error('[tv-bridge] subscribe-bars failed:', err);
      socket.emit('tv:bar-error', { subId: req?.subId, error: err instanceof Error ? err.message : String(err) });
    }
  });

  socket.on('tv:subscribe-quotes', async (req: { subId: string; symbols: string[] }) => {
    try {
      const { subId, symbols = [] } = req ?? {};
      if (!subId || symbols.length === 0) return;
      const key = subKey(socket.id, subId);
      if (quoteSubs.has(key)) return;
      const sub: QuoteSub = { socketId: socket.id, subId, symbols: symbols.slice(0, 10), session: null, markets: [] };
      quoteSubs.set(key, sub);
      track(key);
      await attachQuoteSession(sub);
    } catch (err) {
      console.error('[tv-bridge] subscribe-quotes failed:', err);
    }
  });

  socket.on('tv:unsubscribe', (req: { subId: string }) => {
    const subId = req?.subId;
    if (!subId) return;
    const bKey = subKey(socket.id, subId);
    const barSub = barSubs.get(bKey);
    if (barSub) {
      try {
        barSub.chart?.delete();
      } catch {
        /* noop */
      }
      barSubs.delete(bKey);
      socketSubKeys.delete(bKey);
    }
    const qSub = quoteSubs.get(bKey);
    if (qSub) {
      try {
        qSub.session?.delete();
      } catch {
        /* noop */
      }
      quoteSubs.delete(bKey);
      socketSubKeys.delete(bKey);
    }
  });

  socket.on('disconnect', () => {
    for (const key of socketSubKeys) {
      const barSub = barSubs.get(key);
      if (barSub) {
        try {
          barSub.chart?.delete();
        } catch {
          /* noop */
        }
        barSubs.delete(key);
      }
      const qSub = quoteSubs.get(key);
      if (qSub) {
        try {
          qSub.session?.delete();
        } catch {
          /* noop */
        }
        quoteSubs.delete(key);
      }
    }
    socketSubKeys.clear();
  });
});

io.on('error', (err) => console.error('[tv-bridge] io error:', err));

console.log(`[tv-bridge] listening on :${PORT} (gateway: /?XTransformPort=${PORT})`);
void ensureClient().catch((err) => {
  console.error('[tv-bridge] initial TradingView connection failed:', err);
  setStatus('error');
  scheduleReconnect();
});
