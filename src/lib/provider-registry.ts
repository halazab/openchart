/**
 * Provider registry — the only place that knows which providers exist.
 * Adding a vendor = implementing MarketDataProvider + one line here.
 */

import type { MarketDataProvider } from '@/provider-sdk/types';
import { SyntheticMarketProvider } from '@/providers/synthetic';
import { BinanceMarketProvider } from '@/providers/binance';

export const PROVIDERS: MarketDataProvider[] = [
  new SyntheticMarketProvider(),
  new BinanceMarketProvider(),
];

export function getProvider(id: string): MarketDataProvider {
  const found = PROVIDERS.find((p) => p.id === id);
  return found ?? PROVIDERS[0];
}

export const DEFAULT_WATCHLIST = [
  'BTCUSD',
  'ETHUSD',
  'SOLUSD',
  'NVDA',
  'AAPL',
  'TSLA',
  'SPY',
];
