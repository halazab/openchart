'use client';

/**
 * Strategy Tester — bottom panel for running built-in strategies over the
 * loaded bars (replay-aware: with bar replay active it tests only up to
 * the replay cursor). Results render as chart markers + a metrics grid,
 * a trades table and an equity-curve sparkline.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, X } from 'lucide-react';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import {
  listStrategies,
  defaultParams,
  type BacktestResult,
  type StrategyDef,
} from '@/backtest';
import { formatUtcTime } from '@/core/math';
import { cn } from '@/lib/utils';

const STRATEGIES = listStrategies();

const COMMISSIONS = [0, 0.02, 0.04, 0.075];

export function StrategyPanel() {
  const open = useUiStore((s) => s.strategyOpen);
  const setOpen = useUiStore((s) => s.setStrategyOpen);
  const replayActive = useUiStore((s) => s.replayActive);
  const [def, setDef] = useState<StrategyDef>(STRATEGIES[0]);
  const [params, setParams] = useState<Record<string, number>>(() => defaultParams(STRATEGIES[0]));
  const [direction, setDirection] = useState<'long-only' | 'long-short'>('long-only');
  const [commission, setCommission] = useState(0.04);
  const [stopLoss, setStopLoss] = useState(0);
  const [takeProfit, setTakeProfit] = useState(0);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickStrategy = (next: StrategyDef) => {
    setDef(next);
    setParams(defaultParams(next));
    setResult(null);
    getChartEngine()?.clearBacktest();
  };

  const run = () => {
    const engine = getChartEngine();
    if (!engine) return;
    try {
      const res = engine.executeBacktest({
        strategyId: def.id,
        params,
        direction,
        commissionPct: commission,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
      });
      setResult(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest failed');
    }
  };

  const clear = () => {
    setResult(null);
    setError(null);
    getChartEngine()?.clearBacktest();
  };

  if (!open) return null;

  return (
    <section
      aria-label="Strategy Tester"
      className="flex h-64 shrink-0 flex-col border-t border-[#1e232c] bg-[#11141a]"
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[#1e232c] px-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8b93a3]">
          Strategy Tester
        </span>
        {replayActive ? (
          <span className="rounded bg-[#2a2510] px-1.5 py-0.5 text-[10px] text-[#e3b341]">
            replay range
          </span>
        ) : null}
        <div className="flex-1" />
        <button
          onClick={() => setOpen(false)}
          className="text-[#585f6d] hover:text-[#8b93a3]"
          aria-label="Close strategy tester"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Config column */}
        <div className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-[#1e232c] p-3">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-[#585f6d]">
            Strategy
            <select
              value={def.id}
              onChange={(e) => pickStrategy(STRATEGIES.find((s) => s.id === e.target.value) ?? STRATEGIES[0])}
              className="h-7 rounded border border-[#262c37] bg-[#0e1116] px-1.5 text-[12px] normal-case text-[#e6e9ef] outline-none"
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {def.params.map((p) => (
            <label key={p.key} className="flex items-center justify-between gap-2 text-[11px] text-[#8b93a3]">
              <span>{p.label}</span>
              <input
                type="number"
                value={params[p.key] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(e) =>
                  setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))
                }
                className="h-6 w-20 rounded border border-[#262c37] bg-[#0e1116] px-1.5 text-right font-mono text-[11px] text-[#e6e9ef] outline-none"
              />
            </label>
          ))}
          <div className="flex gap-1">
            {(['long-only', 'long-short'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={cn(
                  'h-6 flex-1 rounded text-[10.5px] transition-colors',
                  direction === d ? 'bg-[#262c37] text-[#e6e9ef]' : 'text-[#8b93a3] hover:bg-[#161a22]',
                )}
              >
                {d === 'long-only' ? 'Long only' : 'Long & Short'}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-[11px] text-[#8b93a3]">
            <span>Commission %</span>
            <select
              value={commission}
              onChange={(e) => setCommission(Number(e.target.value))}
              className="h-6 w-20 rounded border border-[#262c37] bg-[#0e1116] px-1 text-right font-mono text-[11px] text-[#e6e9ef] outline-none"
            >
              {COMMISSIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center justify-between gap-1 text-[11px] text-[#8b93a3]">
              <span>SL %</span>
              <input
                type="number"
                value={stopLoss}
                min={0}
                step={0.1}
                onChange={(e) => setStopLoss(Number(e.target.value))}
                className="h-6 w-14 rounded border border-[#262c37] bg-[#0e1116] px-1 text-right font-mono text-[11px] text-[#e6e9ef] outline-none"
              />
            </label>
            <label className="flex flex-1 items-center justify-between gap-1 text-[11px] text-[#8b93a3]">
              <span>TP %</span>
              <input
                type="number"
                value={takeProfit}
                min={0}
                step={0.1}
                onChange={(e) => setTakeProfit(Number(e.target.value))}
                className="h-6 w-14 rounded border border-[#262c37] bg-[#0e1116] px-1 text-right font-mono text-[11px] text-[#e6e9ef] outline-none"
              />
            </label>
          </div>
          <div className="mt-auto flex gap-2">
            <button
              onClick={run}
              className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded bg-[#e3b341] text-[11.5px] font-semibold text-black hover:bg-[#f0c455]"
            >
              <Play className="h-3 w-3" /> Run backtest
            </button>
            <button
              onClick={clear}
              className="h-7 rounded border border-[#262c37] px-2.5 text-[11px] text-[#8b93a3] hover:bg-[#161a22] hover:text-[#d1d5db]"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Results column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {error ? (
            <div className="p-3 text-[12px] text-[#ef5350]">{error}</div>
          ) : result ? (
            <Results result={result} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-[#585f6d]">
              {def.description} — press “Run backtest”.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Results({ result }: { result: BacktestResult }) {
  const s = result.stats;
  const tradesRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-[#1e232c] p-3">
        <Metric label="Net profit" value={fmtPct(s.netProfitPct)} accent={s.netProfitPct >= 0 ? 'up' : 'down'} />
        <Metric label="Buy & hold" value={fmtPct(s.buyHoldPct)} accent={s.buyHoldPct >= 0 ? 'up' : 'down'} />
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 text-[11px]">
          <Stat label="Trades" value={String(s.tradeCount)} />
          <Stat label="Win rate" value={`${s.winRate}%`} />
          <Stat
            label="Profit factor"
            value={Number.isFinite(s.profitFactor) ? String(s.profitFactor) : '∞'}
          />
          <Stat label="Max drawdown" value={`-${s.maxDrawdownPct}%`} />
          <Stat label="Avg win" value={`+${s.avgWinPct}%`} />
          <Stat label="Avg loss" value={`-${s.avgLossPct}%`} />
          <Stat label="Expectancy" value={`${s.expectancyPct >= 0 ? '+' : ''}${s.expectancyPct}%`} />
          <Stat label="Markers" value={String(result.markers.length)} />
        </div>
        <EquityCurve times={result.equityTimes} values={result.equityValues} />
      </div>
      <div ref={tradesRef} className="min-w-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-[#11141a] text-[10px] uppercase tracking-wide text-[#585f6d]">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">#</th>
              <th className="px-2 py-1.5 text-left font-medium">Side</th>
              <th className="px-2 py-1.5 text-left font-medium">Entry</th>
              <th className="px-2 py-1.5 text-left font-medium">Exit</th>
              <th className="px-2 py-1.5 text-right font-medium">Price in</th>
              <th className="px-2 py-1.5 text-right font-medium">Price out</th>
              <th className="px-2 py-1.5 text-right font-medium">Bars</th>
              <th className="px-2 py-1.5 text-left font-medium">Reason</th>
              <th className="px-3 py-1.5 text-right font-medium">P&amp;L</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {[...result.trades].reverse().map((t, i) => (
              <tr key={i} className="border-t border-[#1a1f29] hover:bg-[#161b23]">
                <td className="px-3 py-1 text-[#585f6d]">{result.trades.length - i}</td>
                <td className={cn('px-2 py-1 font-semibold', t.side === 'long' ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
                  {t.side.toUpperCase()}
                </td>
                <td className="px-2 py-1 text-[#8b93a3]">{formatUtcTime(t.entryTime)}</td>
                <td className="px-2 py-1 text-[#8b93a3]">{formatUtcTime(t.exitTime)}</td>
                <td className="px-2 py-1 text-right text-[#d1d5db]">{t.entryPrice}</td>
                <td className="px-2 py-1 text-right text-[#d1d5db]">{t.exitPrice}</td>
                <td className="px-2 py-1 text-right text-[#8b93a3]">{t.bars}</td>
                <td className="px-2 py-1 text-[#585f6d]">{t.exitReason}</td>
                <td className={cn('px-3 py-1 text-right font-semibold', t.pnlPct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
                  {t.pnlPct >= 0 ? '+' : ''}
                  {t.pnlPct.toFixed(2)}%
                </td>
              </tr>
            ))}
            {result.trades.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[#585f6d]">
                  No trades generated on this range.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: 'up' | 'down' }) {
  return (
    <div className="flex items-center justify-between rounded bg-[#0e1116] px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[#585f6d]">{label}</span>
      <span className={cn('font-mono text-[13px] font-semibold', accent === 'up' ? 'text-[#26a69a]' : 'text-[#ef5350]')}>
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#585f6d]">{label}</span>
      <span className="font-mono text-[#d1d5db]">{value}</span>
    </div>
  );
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** Equity curve sparkline (canvas, redrawn only when results change). */
function EquityCurve({ times, values }: { times: Float64Array; values: Float64Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    return { min, max };
  }, [values]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || values.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const pad = 2;
    const span = Math.max(1e-9, bounds.max - bounds.min);
    const up = values[values.length - 1] >= values[0];
    ctx.strokeStyle = up ? '#26a69a' : '#ef5350';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((values[i] - bounds.min) / span) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [values, bounds]);

  const label = times.length > 0 ? formatUtcTime(times[times.length - 1], true) : '';
  return (
    <div className="mt-auto pt-1">
      <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-[#585f6d]">
        Equity · {label}
      </div>
      <canvas ref={ref} className="h-14 w-full rounded bg-[#0e1116]" />
    </div>
  );
}
