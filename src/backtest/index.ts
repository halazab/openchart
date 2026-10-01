/**
 * backtest — public surface of the strategy backtesting package.
 */

export { runBacktest } from './engine';
export { listStrategies, getStrategy, defaultParams } from './strategies';
export type { StrategyDef, StrategyParam, SignalSet } from './strategies';
export type {
  BacktestBarInput,
  BacktestConfig,
  BacktestMarker,
  BacktestResult,
  BacktestStats,
  BacktestTrade,
  TradeExitReason,
  TradeSide,
} from './types';
