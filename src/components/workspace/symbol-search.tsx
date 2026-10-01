'use client';

/**
 * Symbol search dialog — provider-agnostic instrument lookup.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import type { SymbolInfo } from '@/provider-sdk/types';
import { cn } from '@/lib/utils';

export function SymbolSearchDialog() {
  const open = useUiStore((s) => s.symbolSearchOpen);
  const setOpen = useUiStore((s) => s.setSymbolSearchOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="max-w-lg border-[#262c37] bg-[#11141a] p-0 text-[#d1d5db]">
        {open ? <SearchBody onPick={setOpen} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SearchBody({ onPick }: { onPick: (open: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolInfo[]>([]);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const engine = getChartEngine();
    if (!engine) return;
    void engine.searchSymbols('', 30).then((symbols) => {
      setResults(symbols);
    });
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    const engine = getChartEngine();
    if (!engine) return;
    const handle = setTimeout(() => {
      void engine.searchSymbols(query, 30).then((symbols) => {
        setResults(symbols);
        setHighlight(0);
      });
    }, 80);
    return () => clearTimeout(handle);
  }, [query]);

  const pick = useMemo(
    () => (symbol: string) => {
      onPick(false);
      void getChartEngine()?.setSymbol(symbol);
    },
    [onPick],
  );

  return (
    <>
        <DialogHeader className="px-4 pb-0 pt-4">
          <DialogTitle className="text-sm font-medium text-[#8b93a3]">
            Symbol Search
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 rounded-md border border-[#262c37] bg-[#0e1116] px-3">
            <Search className="h-4 w-4 text-[#8b93a3]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                } else if (e.key === 'Enter' && results[highlight]) {
                  pick(results[highlight].symbol);
                }
              }}
              placeholder="Search markets (e.g. BTC, NVDA, gold…)"
              className="h-10 w-full bg-transparent text-[13px] text-[#e6e9ef] outline-none placeholder:text-[#585f6d]"
              aria-label="Symbol search input"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto px-2 pb-3" role="listbox">
          {results.map((info, i) => (
            <button
              key={`${info.exchange}:${info.symbol}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(info.symbol)}
              className={cn(
                'flex w-full items-center gap-3 rounded px-2 py-2 text-left',
                i === highlight ? 'bg-[#1d232e]' : 'hover:bg-[#161b23]',
              )}
            >
              <span className="w-20 font-mono text-[13px] font-semibold text-[#e6e9ef]">
                {info.ticker}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-[#8b93a3]">
                {info.description ?? info.name}
              </span>
              <span className="rounded bg-[#1a1f29] px-1.5 py-0.5 text-[10px] uppercase text-[#8b93a3]">
                {info.type}
              </span>
              <span className="w-16 text-right text-[10px] uppercase text-[#585f6d]">
                {info.exchange}
              </span>
            </button>
          ))}
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-[#585f6d]">
              No instruments match “{query}”
            </div>
          ) : null}
        </div>
      </>
  );
}
