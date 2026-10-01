/**
 * synthetic provider — instrument universe.
 * Deterministic, realistic metadata for demo + offline development.
 */

import type { SymbolInfo } from '../../provider-sdk/types';

function stock(
  symbol: string,
  name: string,
  price: number,
  annVol: number,
  tags: string[],
): SymbolInfo & { basePrice: number; annVol: number } {
  return {
    symbol,
    name,
    exchange: 'SYNTH',
    type: 'stock',
    ticker: symbol,
    description: name,
    sessionModel: 'equity',
    pricePrecision: 2,
    minMove: 0.01,
    tags,
    basePrice: price,
    annVol,
  };
}

function crypto(
  symbol: string,
  name: string,
  price: number,
  annVol: number,
  tags: string[],
): SymbolInfo & { basePrice: number; annVol: number } {
  return {
    symbol,
    name,
    exchange: 'SYNTH',
    type: 'crypto',
    ticker: symbol,
    description: name,
    sessionModel: 'continuous',
    pricePrecision: price > 1000 ? 2 : price > 10 ? 3 : 5,
    minMove: price > 1000 ? 0.01 : price > 10 ? 0.001 : 0.00001,
    tags,
    basePrice: price,
    annVol,
  };
}

export interface SyntheticSpec extends SymbolInfo {
  basePrice: number;
  /** Annualized volatility used by the generator. */
  annVol: number;
}

export const SYNTHETIC_UNIVERSE: SyntheticSpec[] = [
  crypto('BTCUSD', 'Bitcoin / U.S. Dollar', 67450, 0.55, ['major', 'pow']),
  crypto('ETHUSD', 'Ethereum / U.S. Dollar', 3512, 0.62, ['major', 'pos']),
  crypto('SOLUSD', 'Solana / U.S. Dollar', 162.4, 0.85, ['l1', 'pos']),
  crypto('BNBUSD', 'BNB / U.S. Dollar', 592.3, 0.6, ['exchange']),
  crypto('XRPUSD', 'XRP / U.S. Dollar', 0.5231, 0.75, ['payments']),
  crypto('DOGEUSD', 'Dogecoin / U.S. Dollar', 0.1284, 0.95, ['meme']),
  stock('AAPL', 'Apple Inc.', 227.6, 0.24, ['technology', 'mega-cap']),
  stock('NVDA', 'NVIDIA Corporation', 128.4, 0.45, ['semiconductors', 'ai']),
  stock('TSLA', 'Tesla, Inc.', 251.8, 0.55, ['autos', 'energy']),
  stock('MSFT', 'Microsoft Corporation', 419.2, 0.22, ['technology', 'mega-cap']),
  stock('AMZN', 'Amazon.com, Inc.', 186.4, 0.3, ['ecommerce', 'cloud']),
  stock('META', 'Meta Platforms, Inc.', 512.7, 0.35, ['social', 'ai']),
  stock('GOOGL', 'Alphabet Inc. Class A', 168.9, 0.26, ['search', 'cloud']),
  stock('AMD', 'Advanced Micro Devices, Inc.', 154.3, 0.48, ['semiconductors']),
  stock('JPM', 'JPMorgan Chase & Co.', 214.8, 0.2, ['banks']),
  stock('XOM', 'Exxon Mobil Corporation', 116.5, 0.25, ['energy']),
  stock('SPY', 'SPDR S&P 500 ETF Trust', 573.2, 0.14, ['etf', 'index']),
  stock('QQQ', 'Invesco QQQ Trust', 492.6, 0.18, ['etf', 'index']),
];

const BY_SYMBOL = new Map(SYNTHETIC_UNIVERSE.map((s) => [s.symbol, s]));

export function getSyntheticSpec(symbol: string): SyntheticSpec | undefined {
  return BY_SYMBOL.get(symbol);
}

export function searchSyntheticUniverse(query: string, limit = 20): SyntheticSpec[] {
  const q = query.trim().toUpperCase();
  if (!q) return SYNTHETIC_UNIVERSE.slice(0, limit);
  const scored: Array<{ spec: SyntheticSpec; score: number }> = [];
  for (const spec of SYNTHETIC_UNIVERSE) {
    const sym = spec.symbol.toUpperCase();
    const name = spec.name.toUpperCase();
    let score = -1;
    if (sym === q) score = 100;
    else if (sym.startsWith(q)) score = 80;
    else if (name.startsWith(q)) score = 60;
    else if (sym.includes(q)) score = 40;
    else if (name.includes(q)) score = 30;
    else if (spec.tags?.some((t) => t.toUpperCase().includes(q))) score = 10;
    if (score > 0) scored.push({ spec, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.spec);
}
