/**
 * Provider registry — the only place that knows which providers exist.
 * Adding a vendor = implementing MarketDataProvider + one line here.
 *
 * Available providers:
 *  - synthetic  : offline deterministic simulator (equity sessions, ticks)
 *  - binance    : real public crypto data (REST + WS, no key)
 *  - tradingview: full TradingView universe via the @mathieuc/tradingview
 *                 library, proxied by mini-services/tradingview-bridge
 *                 (Node-only WebSocket client behind the gateway)
 */

import type { MarketDataProvider } from '@/provider-sdk/types';
import { SyntheticMarketProvider } from '@/providers/synthetic';
import { BinanceMarketProvider } from '@/providers/binance';
import { TradingViewProvider } from '@/providers/tradingview';

export const PROVIDERS: MarketDataProvider[] = [
  new SyntheticMarketProvider(),
  new BinanceMarketProvider(),
  new TradingViewProvider(),
];

export function getProvider(id: string): MarketDataProvider {
  const found = PROVIDERS.find((p) => p.id === id);
  return found ?? PROVIDERS[0];
}

/** Shared watchlist for providers using short tickers (synthetic/binance). */
export const DEFAULT_WATCHLIST = [
  'BTCUSD',
  'ETHUSD',
  'SOLUSD',
  'NVDA',
  'AAPL',
  'TSLA',
  'SPY',
];

/**
 * Switch the active provider AND realign symbol + watchlist with the
 * provider's own instrument universe (full TV symbols vs short tickers).
 */
export async function switchProvider(
  apply: (provider: MarketDataProvider, symbol: string) => Promise<void>,
  setWatchlist: (symbols: string[]) => void,
  providerId: string,
): Promise<void> {
  const provider = getProvider(providerId);
  const watchlist = provider.defaultWatchlist ?? DEFAULT_WATCHLIST;
  const defaultSymbol = watchlist[0] ?? 'BTCUSD';
  setWatchlist(watchlist);
  await apply(provider, defaultSymbol);
}
