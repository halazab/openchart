'use client';

/**
 * Watchlist panel — symbol rows with live prices.
 *
 * IMPORTANT: quote updates are applied imperatively via refs; React only
 * re-renders when the row SET changes, never on ticks.
 */

import { useEffect, useRef } from 'react';
import { getChartEngine } from './chart-workspace';
import type { ChartEngine } from '@/core/chart-engine';
import { useUiStore } from '@/lib/ui-store';
import type { Quote } from '@/provider-sdk/types';
import { cn } from '@/lib/utils';

interface RowState {
  last: number;
  prevClose: number | null;
  precision: number;
}

export function WatchlistPanel({ engine }: { engine: ChartEngine | null }) {
  const symbol = useUiStore((s) => s.symbol);
  const storeWatchlist = useUiStore((s) => s.watchlist);
  const setOpen = useUiStore((s) => s.setWatchlistOpen);
  const rowsRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const stateRef = useRef<Map<string, RowState>>(new Map());
  const watchlist = Array.from(new Set([symbol, ...storeWatchlist]));

  const applyQuote = (quote: Quote) => {
    const el = rowRefs.current.get(quote.symbol);
    if (!el) return;
    let state = stateRef.current.get(quote.symbol);
    if (!state) {
      state = { last: quote.last, prevClose: quote.dayOpen ?? quote.prevClose ?? null, precision: 2 };
      stateRef.current.set(quote.symbol, state);
    }
    if (quote.dayOpen !== undefined) state.prevClose = quote.dayOpen;
    state.last = quote.last;
    const changePct =
      state.prevClose && state.prevClose !== 0
        ? ((quote.last - state.prevClose) / state.prevClose) * 100
        : 0;
    const color = changePct >= 0 ? '#26a69a' : '#ef5350';
    const lastEl = el.querySelector<HTMLElement>('[data-field="last"]');
    const chgEl = el.querySelector<HTMLElement>('[data-field="chg"]');
    if (lastEl) lastEl.textContent = formatQuote(quote.last, state.precision);
    if (chgEl) {
      chgEl.textContent = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
      chgEl.style.color = color;
    }
  };

  // Subscribe to quote events (throttled upstream by the batching layer).
  useEffect(() => {
    if (!engine) return;
    return engine.events.on('quotes', ({ updates }) => {
      for (const quote of updates) {
        applyQuote(quote);
      }
    });
  }, [engine]);

  return (
    <aside
      aria-label="Watchlist"
      className="flex w-64 shrink-0 flex-col border-l border-[#1e232c] bg-[#11141a]"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#1e232c] px-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8b93a3]">
          Watchlist
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-[10px] text-[#585f6d] hover:text-[#8b93a3]"
          aria-label="Hide watchlist"
        >
          hide
        </button>
      </div>
      <div ref={rowsRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#585f6d]">
          <span className="flex-1">Symbol</span>
          <span className="w-20 text-right">Last</span>
          <span className="w-16 text-right">Chg%</span>
        </div>
        {watchlist.map((s) => (
          <button
            key={s}
            ref={(el) => {
              if (el) rowRefs.current.set(s, el);
              else rowRefs.current.delete(s);
            }}
            onClick={() => {
              void getChartEngine()?.setSymbol(s);
            }}
            className={cn(
              'flex w-full items-center px-3 py-2 text-left text-[12px] hover:bg-[#161b23]',
              s === symbol && 'bg-[#1a2029]',
            )}
          >
            <span
              className={cn(
                'flex-1 truncate font-mono font-semibold',
                s === symbol ? 'text-[#e3b341]' : 'text-[#d1d5db]',
              )}
            >
              {s.includes(':') ? s.split(':').pop() : s}
            </span>
            <span data-field="last" className="w-20 text-right font-mono text-[11.5px] text-[#d1d5db]">
              —
            </span>
            <span data-field="chg" className="w-16 text-right font-mono text-[11px] text-[#585f6d]">
              —
            </span>
          </button>
        ))}
      </div>
      <SymbolDetails engine={engine} />
    </aside>
  );
}

function formatQuote(v: number, precision: number): string {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(precision, 2),
    maximumFractionDigits: precision,
  });
}

/**
 * Details block — static metadata (React-rendered; changes only on symbol
 * switch) plus day stats applied imperatively from quotes.
 */
function SymbolDetails({ engine }: { engine: ChartEngine | null }) {
  const info = useUiStore((s) => s.symbolInfo);
  const currentSymbol = useUiStore((s) => s.symbol);
  const dayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engine) return;
    return engine.events.on('quotes', ({ updates }) => {
      const container = dayRef.current;
      if (!container) return;
      const relevant = updates.find((q) => q.symbol === useUiStore.getState().symbol);
      if (!relevant) return;
      const cells = container.querySelectorAll<HTMLElement>('[data-stat]');
      const set = (key: string, value: string) => {
        const el = Array.from(cells).find((c) => c.dataset.stat === key);
        if (el) el.textContent = value;
      };
      set('open', relevant.dayOpen?.toFixed(2) ?? '—');
      set('high', relevant.dayHigh?.toFixed(2) ?? '—');
      set('low', relevant.dayLow?.toFixed(2) ?? '—');
      set('vol', relevant.volume !== undefined ? abbreviate(relevant.volume) : '—');
    });
  }, [engine]);

  return (
    <div className="shrink-0 border-t border-[#1e232c] px-3 py-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#8b93a3]">
        {info?.exchange ?? ''} · {info?.type ?? ''}
      </div>
      <div className="mb-3 text-[12.5px] leading-snug text-[#e6e9ef]">
        {info?.name ?? '—'}
      </div>
      <div ref={dayRef} className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <Stat label="Open" value="—" field="open" />
        <Stat label="Prev" value={info ? formatQuote(info.minMove, 2) : '—'} field="prev" />
        <Stat label="High" value="—" field="high" />
        <Stat label="Low" value="—" field="low" />
        <Stat label="Volume" value="—" field="vol" />
        <Stat label="Sessions" value={info?.sessionModel === 'equity' ? 'RTH/ETH' : '24/7'} field="sessions" />
      </div>
    </div>
  );
}

function Stat({ label, value, field }: { label: string; value: string; field: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#585f6d]">{label}</span>
      <span data-stat={field} className="font-mono text-[#d1d5db]">
        {value}
      </span>
    </div>
  );
}

function abbreviate(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}
