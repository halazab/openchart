/**
 * TradingView bridge smoke test — run: bunx tsx scripts/test-tv-bridge.ts
 * Exercises tv:history, tv:meta, tv:search, tv:subscribe-bars, tv:subscribe-quotes.
 */

import { io, Socket } from 'socket.io-client';

const URL = process.env.BRIDGE_URL ?? 'http://localhost:3014';

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket', 'polling'] });
    const timer = setTimeout(() => reject(new Error('bridge connect timeout')), 10000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 30000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), timeoutMs);
    socket.emit(event, payload, (res: unknown) => {
      clearTimeout(timer);
      // socket.io passes a single ack arg through directly (no wrapping).
      const r = res as T & { error?: string };
      if (r && typeof r === 'object' && 'error' in r && r.error) {
        reject(new Error(r.error));
        return;
      }
      resolve(r as T);
    });
  });
}

async function main(): Promise<void> {
  console.log('connecting to bridge at', URL);
  const socket = await connect();
  console.log('✓ connected');

  // 1. History
  const hist = await emitAck<{ bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number; sessionStart?: boolean }>; hasMore: boolean }>(
    socket,
    'tv:history',
    { symbol: 'BINANCE:BTCUSDT', timeframe: '1m', limit: 300 },
  );
  const bars = hist.bars;
  if (bars.length === 0) throw new Error('history returned no bars');
  let ascending = true;
  for (let i = 1; i < bars.length; i++) if (bars[i].time <= bars[i - 1].time) ascending = false;
  console.log(`✓ history: ${bars.length} bars, ascending=${ascending}, hasMore=${hist.hasMore}, lastClose=${bars[bars.length - 1].close} @ ${new Date(bars[bars.length - 1].time * 1000).toISOString()}`);
  if (!ascending) throw new Error('history not ascending');

  // 2. Older page (pagination)
  const page2 = await emitAck<{ bars: typeof bars; hasMore: boolean }>(
    socket,
    'tv:history',
    { symbol: 'BINANCE:BTCUSDT', timeframe: '1m', end: bars[0].time, limit: 300 },
  );
  const contiguous = page2.bars.length > 0 && page2.bars[page2.bars.length - 1].time < bars[0].time;
  console.log(`✓ older page: ${page2.bars.length} bars, contiguous=${contiguous}`);
  if (!contiguous) throw new Error('older page not contiguous');

  // 3. Equity history with session flags (NASDAQ:AAPL)
  const aapl = await emitAck<{ bars: Array<{ time: number; sessionStart?: boolean; extended?: boolean }> }>(
    socket,
    'tv:history',
    { symbol: 'NASDAQ:AAPL', timeframe: '5m', limit: 500 },
  );
  const sessionStarts = aapl.bars.filter((b) => b.sessionStart).length;
  console.log(`✓ AAPL 5m: ${aapl.bars.length} bars, sessionStarts=${sessionStarts}`);
  if (sessionStarts === 0) throw new Error('AAPL bars missing sessionStart flags');

  // 4. Meta
  const meta = await emitAck<{ symbol: string; exchange: string; pricePrecision: number; sessionModel: string; name: string }>(
    socket,
    'tv:meta',
    { symbol: 'NASDAQ:AAPL' },
  );
  console.log(`✓ meta: ${meta.symbol} ${meta.name} exchange=${meta.exchange} precision=${meta.pricePrecision} model=${meta.sessionModel}`);

  // 5. Search
  const search = await emitAck<Array<{ symbol: string; name: string; exchange: string }>>(
    socket,
    'tv:search',
    { query: 'gold', limit: 5 },
  );
  console.log(`✓ search "gold": ${search.length} results, first=${search[0]?.symbol} (${search[0]?.name})`);

  // 6. Realtime bars
  const barEvents: unknown[] = [];
  socket.on('tv:bar', (msg: { subId: string; bar: { close: number; time: number } }) => {
    if (msg.subId === 'b1') barEvents.push(msg.bar);
  });
  socket.emit('tv:subscribe-bars', { subId: 'b1', symbol: 'BINANCE:BTCUSDT', timeframe: '1m' });
  await new Promise((r) => setTimeout(r, 6000));
  console.log(`✓ realtime bars: ${barEvents.length} events in 6s, lastClose=${(barEvents[barEvents.length - 1] as { close: number })?.close}`);
  if (barEvents.length === 0) throw new Error('no realtime bar events');

  // 7. Quotes
  const quoteEvents: unknown[] = [];
  socket.on('tv:quote', (msg: { subId: string; quote: { symbol: string; last: number } }) => {
    if (msg.subId === 'q1') quoteEvents.push(msg.quote);
  });
  socket.emit('tv:subscribe-quotes', { subId: 'q1', symbols: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT'] });
  await new Promise((r) => setTimeout(r, 5000));
  console.log(`✓ quotes: ${quoteEvents.length} events in 5s, sample=${JSON.stringify(quoteEvents[quoteEvents.length - 1])}`);
  if (quoteEvents.length === 0) throw new Error('no quote events');

  socket.close();
  console.log('\nALL TV BRIDGE TESTS PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ FAIL:', err.message);
  process.exit(1);
});
