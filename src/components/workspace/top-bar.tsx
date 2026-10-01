'use client';

/**
 * Top bar — symbol selector, timeframes, chart type, indicators, scales.
 */

import {
  BarChart3,
  CandlestickChart,
  ChartCandlestick,
  ChartLine,
  ChevronDown,
  Percent,
  Search,
  Sigma,
  SlidersHorizontal,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useCallback } from 'react';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import { TIMEFRAMES, type ChartType, type Timeframe } from '@/core/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const CHART_TYPES: Array<{ id: ChartType; label: string; icon: React.ReactNode }> = [
  { id: 'candles', label: 'Candlestick', icon: <ChartCandlestick className="h-4 w-4" /> },
  { id: 'bars', label: 'Bar', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'line', label: 'Line', icon: <ChartLine className="h-4 w-4" /> },
  { id: 'area', label: 'Area', icon: <ChartLine className="h-4 w-4" /> },
  { id: 'heikin-ashi', label: 'Heikin Ashi', icon: <CandlestickChart className="h-4 w-4" /> },
];

export function TopBar() {
  const symbol = useUiStore((s) => s.symbol);
  const symbolInfo = useUiStore((s) => s.symbolInfo);
  const timeframe = useUiStore((s) => s.timeframe);
  const chartType = useUiStore((s) => s.chartType);
  const scaleMode = useUiStore((s) => s.scaleMode);
  const loading = useUiStore((s) => s.loading);

  const openSearch = useUiStore((s) => s.setSymbolSearchOpen);
  const openIndicators = useUiStore((s) => s.setIndicatorsOpen);
  const setChartTypeFn = useCallback((t: ChartType) => {
    getChartEngine()?.setChartType(t);
  }, []);
  const setTimeframeFn = useCallback((tf: Timeframe) => {
    void getChartEngine()?.setTimeframe(tf);
  }, []);
  const toggleScale = useCallback((mode: 'logarithmic' | 'percentage') => {
    const engine = getChartEngine();
    if (!engine) return;
    engine.setScaleMode(engine.getScaleMode() === mode ? 'normal' : mode);
  }, []);

  const typeDef = CHART_TYPES.find((t) => t.id === chartType) ?? CHART_TYPES[0];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[#1e232c] bg-[#11141a] px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-[#e3b341] text-[11px] font-bold text-black">
          OC
        </div>
        <span className="hidden text-sm font-semibold text-[#e6e9ef] lg:inline">OpenChart</span>
      </div>

      <Button
        variant="outline"
        onClick={() => openSearch(true)}
        className="h-8 gap-2 border-[#262c37] bg-[#161a22] px-3 font-mono text-[13px] font-semibold text-[#e6e9ef] hover:bg-[#1d222c]"
        aria-label="Search symbol"
      >
        <Search className="h-3.5 w-3.5 text-[#8b93a3]" />
        {symbol}
        <span className="hidden max-w-40 truncate font-sans text-[11px] font-normal text-[#8b93a3] xl:inline">
          {symbolInfo?.name ?? ''}
        </span>
        {loading ? (
          <span className="ml-1 h-3 w-3 animate-spin rounded-full border border-[#8b93a3] border-t-transparent" />
        ) : null}
      </Button>

      <div className="mx-1 h-6 w-px bg-[#1e232c]" />

      <nav aria-label="Timeframes" className="flex items-center gap-0.5">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframeFn(tf)}
            aria-pressed={tf === timeframe}
            className={cn(
              'h-8 rounded px-2 font-mono text-[12px] transition-colors',
              tf === timeframe
                ? 'bg-[#262c37] font-semibold text-[#e6e9ef]'
                : 'text-[#8b93a3] hover:bg-[#161a22] hover:text-[#d1d5db]',
            )}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </nav>

      <div className="mx-1 h-6 w-px bg-[#1e232c]" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 gap-2 px-2 text-[12px] text-[#d1d5db] hover:bg-[#161a22]"
            aria-label="Chart type"
          >
            {typeDef.icon}
            <span className="hidden md:inline">{typeDef.label}</span>
            <ChevronDown className="h-3 w-3 text-[#8b93a3]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-[#262c37] bg-[#161a22] text-[#d1d5db]">
          {CHART_TYPES.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => setChartTypeFn(t.id)}
              className={cn('gap-2 text-[12px]', t.id === chartType && 'bg-[#262c37]')}
            >
              {t.icon}
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        onClick={() => openIndicators(true)}
        className="h-8 gap-2 px-2 text-[12px] text-[#d1d5db] hover:bg-[#161a22]"
        aria-label="Indicators"
      >
        <Sigma className="h-4 w-4" />
        <span className="hidden md:inline">Indicators</span>
      </Button>

      <div className="flex-1" />

      <button
        onClick={() => toggleScale('logarithmic')}
        aria-pressed={scaleMode === 'logarithmic'}
        title="Logarithmic scale"
        className={cn(
          'flex h-8 items-center gap-1 rounded px-2 text-[11px] transition-colors',
          scaleMode === 'logarithmic'
            ? 'bg-[#262c37] text-[#e6e9ef]'
            : 'text-[#8b93a3] hover:bg-[#161a22]',
        )}
      >
        <span className="font-mono">log</span>
      </button>
      <button
        onClick={() => toggleScale('percentage')}
        aria-pressed={scaleMode === 'percentage'}
        title="Percentage scale"
        className={cn(
          'flex h-8 items-center gap-1 rounded px-2 text-[11px] transition-colors',
          scaleMode === 'percentage'
            ? 'bg-[#262c37] text-[#e6e9ef]'
            : 'text-[#8b93a3] hover:bg-[#161a22]',
        )}
      >
        <Percent className="h-3.5 w-3.5" />
        <span className="hidden font-mono lg:inline">%</span>
      </button>
      <WatchlistToggle />
      <SettingsButton />
    </header>
  );
}

function WatchlistToggle() {
  const open = useUiStore((s) => s.watchlistOpen);
  const setOpen = useUiStore((s) => s.setWatchlistOpen);
  return (
    <button
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      title="Toggle watchlist"
      className="flex h-8 items-center rounded px-2 text-[#8b93a3] hover:bg-[#161a22] hover:text-[#d1d5db]"
    >
      {open ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
      <span className="hidden text-[11px] lg:inline">Watchlist</span>
    </button>
  );
}

function SettingsButton() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  return (
    <button
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      title="Chart settings"
      className={cn(
        'flex h-8 items-center rounded px-2 transition-colors',
        open ? 'bg-[#262c37] text-[#e6e9ef]' : 'text-[#8b93a3] hover:bg-[#161a22]',
      )}
    >
      <SlidersHorizontal className="h-4 w-4" />
    </button>
  );
}
