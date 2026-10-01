/**
 * backtest — strategy backtesting types.
 *
 * Framework-agnostic: operates on typed-array bar columns and returns
 * plain data structures consumable by the UI and the chart renderer.
 */

export interface BacktestBarInput {
  times: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  length: number;
}

export type TradeSide = 'long' | 'short';

export type TradeExitReason = 'signal' | 'stop' | 'target' | 'end-of-data';

export interface BacktestTrade {
  side: TradeSide;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  /** Net P&L in percent of entry notional (commission on both sides included). */
  pnlPct: number;
  bars: number;
  exitReason: TradeExitReason;
}

export interface BacktestStats {
  /** Net return over the period, % (compounded). */
  netProfitPct: number;
  /** Buy & hold return over the same span, % (for comparison). */
  buyHoldPct: number;
  tradeCount: number;
  winRate: number;
  /** Gross wins / gross losses; Infinity when no losing trade. */
  profitFactor: number;
  maxDrawdownPct: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Average P&L per trade, %. */
  expectancyPct: number;
}

export interface BacktestConfig {
  strategyId: string;
  params: Record<string, number>;
  direction: 'long-only' | 'long-short';
  /** Commission per side, % of notional (0 = frictionless). */
  commissionPct: number;
  /** Optional protective exits, % from entry (0 = disabled). */
  stopLossPct: number;
  takeProfitPct: number;
}

export interface BacktestMarker {
  time: number;
  price: number;
  kind: 'entry-long' | 'entry-short' | 'exit-long' | 'exit-short';
  text?: string;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  markers: BacktestMarker[];
  stats: BacktestStats;
  /** Equity curve in % of initial capital, one point per bar. */
  equityTimes: Float64Array;
  equityValues: Float64Array;
}
