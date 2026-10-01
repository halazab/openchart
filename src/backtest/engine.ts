/**
 * backtest — execution engine.
 *
 * Semantics (kept deliberately honest):
 *  - Signals are evaluated on bar CLOSE; market orders fill at the NEXT
 *    bar's OPEN (no look-ahead fills).
 *  - Stop-loss / take-profit fills happen intrabar at the exact level.
 *    When both could trigger inside the same bar the STOP is assumed to
 *    fill first (pessimistic for longs).
 *  - Commission is charged on entry AND exit as % of notional.
 *  - Position sizing compounds: each trade's P&L rolls into equity.
 */

import type {
  BacktestBarInput,
  BacktestConfig,
  BacktestMarker,
  BacktestResult,
  BacktestStats,
  BacktestTrade,
} from './types';
import { getStrategy, defaultParams } from './strategies';

interface OpenPosition {
  side: 'long' | 'short';
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
}

const ROUND = (v: number, d = 4): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

export function runBacktest(input: BacktestBarInput, config: BacktestConfig): BacktestResult {
  const def = getStrategy(config.strategyId);
  if (!def) throw new Error(`Unknown strategy: ${config.strategyId}`);
  const params = { ...defaultParams(def), ...config.params };
  const signals = def.compute(input, params);

  const { times, open, high, low, close, length } = input;
  const trades: BacktestTrade[] = [];
  const markers: BacktestMarker[] = [];

  const equity = new Float64Array(length).fill(100);
  let position: OpenPosition | null = null;
  let equityPct = 100;

  const commission = Math.max(0, config.commissionPct) / 100;
  const stopPct = Math.max(0, config.stopLossPct) / 100;
  const takePct = Math.max(0, config.takeProfitPct) / 100;

  const closePosition = (
    pos: OpenPosition,
    exitIndex: number,
    exitPriceRaw: number,
    reason: BacktestTrade['exitReason'],
  ): void => {
    const dir = pos.side === 'long' ? 1 : -1;
    const grossPct = ((exitPriceRaw - pos.entryPrice) / pos.entryPrice) * 100 * dir;
    const pnlPct = grossPct - commission * 200; // both sides
    equityPct *= 1 + pnlPct / 100;
    trades.push({
      side: pos.side,
      entryIndex: pos.entryIndex,
      entryTime: pos.entryTime,
      entryPrice: ROUND(pos.entryPrice),
      exitIndex,
      exitTime: times[exitIndex],
      exitPrice: ROUND(exitPriceRaw),
      pnlPct: ROUND(pnlPct, 3),
      bars: exitIndex - pos.entryIndex,
      exitReason: reason,
    });
    markers.push({
      time: times[exitIndex],
      price: exitPriceRaw,
      kind: pos.side === 'long' ? 'exit-long' : 'exit-short',
      text: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
    });
    position = null;
  };

  for (let i = 1; i < length; i++) {
    const prev = i - 1;

    // 1) Protective exits on the OPEN position (checked first, intrabar).
    if (position) {
      const pos = position as OpenPosition;
      if (pos.side === 'long') {
        const stop = pos.entryPrice * (1 - stopPct);
        const target = pos.entryPrice * (1 + takePct);
        if (stopPct > 0 && low[i] <= stop) closePosition(pos, i, stop, 'stop');
        else if (takePct > 0 && high[i] >= target) closePosition(pos, i, target, 'target');
      } else {
        const stop = pos.entryPrice * (1 + stopPct);
        const target = pos.entryPrice * (1 - takePct);
        if (stopPct > 0 && high[i] >= stop) closePosition(pos, i, stop, 'stop');
        else if (takePct > 0 && low[i] <= target) closePosition(pos, i, target, 'target');
      }
    }

    // 2) Signal exits evaluated on the previous bar's close → fill at this open.
    if (position) {
      const pos = position as OpenPosition;
      const exitSignal = pos.side === 'long' ? signals.exitLong[prev] : signals.exitShort[prev];
      if (exitSignal) closePosition(pos, i, open[i], 'signal');
    }

    // 3) Signal entries evaluated on the previous bar's close → fill at this open.
    if (!position && i < length) {
      if (signals.enterLong[prev]) {
        position = { side: 'long', entryIndex: i, entryTime: times[i], entryPrice: open[i] };
        markers.push({ time: times[i], price: open[i], kind: 'entry-long' });
      } else if (config.direction === 'long-short' && signals.enterShort[prev]) {
        position = { side: 'short', entryIndex: i, entryTime: times[i], entryPrice: open[i] };
        markers.push({ time: times[i], price: open[i], kind: 'entry-short' });
      }
    }

    // 4) Mark-to-market equity for the curve.
    if (position) {
      const pos = position as OpenPosition;
      const dir = pos.side === 'long' ? 1 : -1;
      const unrealized = ((close[i] - pos.entryPrice) / pos.entryPrice) * 100 * dir;
      equity[i] = equityPct * (1 + unrealized / 100);
    } else {
      equity[i] = equityPct;
    }
  }

  // Force-close any open position at the final close.
  if (position && length > 0) {
    const pos = position as OpenPosition;
    closePosition(pos, length - 1, close[length - 1], 'end-of-data');
  }

  // Buy & hold reference over the same span.
  const buyHoldPct =
    length > 1 ? ((close[length - 1] - open[1]) / open[1]) * 100 : 0;

  const stats = computeStats(trades, buyHoldPct, equity);

  return {
    config,
    trades,
    markers,
    stats,
    equityTimes: times.slice(0, length),
    equityValues: equity,
  };
}

function computeStats(
  trades: BacktestTrade[],
  buyHoldPct: number,
  equity: Float64Array,
): BacktestStats {
  const n = trades.length;
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let sumPnl = 0;
  for (const t of trades) {
    if (t.pnlPct >= 0) {
      wins++;
      grossWin += t.pnlPct;
    } else {
      grossLoss += -t.pnlPct;
    }
    sumPnl += t.pnlPct;
  }
  // Max drawdown on the (compounded) equity curve.
  let peak = equity.length > 0 ? equity[0] : 100;
  let maxDd = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    const dd = ((peak - equity[i]) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }
  const avgWin = wins > 0 ? grossWin / wins : 0;
  const losses = n - wins;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  return {
    netProfitPct: ROUND((equity.length > 0 ? equity[equity.length - 1] : 100) - 100, 2),
    buyHoldPct: ROUND(buyHoldPct, 2),
    tradeCount: n,
    winRate: n > 0 ? ROUND((wins / n) * 100, 1) : 0,
    profitFactor: grossLoss > 0 ? ROUND(grossWin / grossLoss, 2) : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: ROUND(maxDd, 2),
    avgWinPct: ROUND(avgWin, 2),
    avgLossPct: ROUND(avgLoss, 2),
    expectancyPct: n > 0 ? ROUND(sumPnl / n, 2) : 0,
  };
}

export { defaultParams } from './strategies';
