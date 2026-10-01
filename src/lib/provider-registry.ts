/**
 * Provider registry — the only place that knows which providers exist.
 * Adding a vendor = implementing MarketDataProvider + one line here.
 *
 * Available providers (all real market data):
 *  - binance    : Binance public crypto data (REST + WS, no key)
 *  - tradingview: full TradingView universe via the @mathieuc/tradingview
 *                 library, proxied by mini-services/tradingview-bridge
 *                 (Node-only WebSocket client behind the gateway)
 */

import type { MarketDataProvider } from '@/provider-sdk/types';
import { BinanceMarketProvider } from '@/providers/binance';
import { TradingViewProvider } from '@/providers/tradingview';
import { loadSavedWatchlist } from '@/lib/watchlist-store';

export const PROVIDERS: MarketDataProvider[] = [
  new BinanceMarketProvider(),
  new TradingViewProvider(),
];

/** The first registered provider boots with the app. */
export const DEFAULT_PROVIDER_ID = PROVIDERS[0].id;

export function getProvider(id: string): MarketDataProvider {
  const found = PROVIDERS.find((p) => p.id === id);
  return found ?? PROVIDERS[0];
}

/** Boot configuration (provider + symbol + watchlist) for app startup. */
export function defaultBootConfig(): {
  provider: MarketDataProvider;
  symbol: string;
  watchlist: string[];
} {
  const provider = PROVIDERS[0];
  const saved = typeof window !== 'undefined' ? loadSavedWatchlist(provider.id) : null;
  const watchlist = saved ?? provider.defaultWatchlist ?? [];
  const symbol = watchlist[0] ?? '';
  return { provider, symbol, watchlist };
}

/**
 * Switch the active provider AND realign symbol + watchlist with the
 * provider's own instrument universe. A provider's saved watchlist
 * (localStorage) wins over its built-in default.
 */
export async function switchProvider(
  apply: (provider: MarketDataProvider, symbol: string) => Promise<void>,
  setWatchlist: (symbols: string[]) => void,
  providerId: string,
): Promise<void> {
  const provider = getProvider(providerId);
  const saved = typeof window !== 'undefined' ? loadSavedWatchlist(providerId) : null;
  const watchlist = saved ?? provider.defaultWatchlist ?? [];
  const defaultSymbol = watchlist[0] ?? '';
  setWatchlist(watchlist);
  await apply(provider, defaultSymbol);
}
