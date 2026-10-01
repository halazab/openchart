'use client';

/**
 * Chart workspace — the terminal layout.
 *
 * React owns the SHELL (toolbars, panels, dialogs). The chart engine lives
 * outside React: market ticks and crosshair moves are applied imperatively
 * and never trigger React re-renders (see README "Performance model").
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useUiStore } from '@/lib/ui-store';
import { getProvider, DEFAULT_PROVIDER_ID, defaultBootConfig, switchProvider } from '@/lib/provider-registry';
import { ChartEngine } from '@/core/chart-engine';
import type { ConnectionStatus } from '@/core/types';
import { TopBar } from './top-bar';
import { DrawingToolbar } from './drawing-toolbar';
import { WatchlistPanel } from './watchlist-panel';
import { StatusBar } from './status-bar';
import { SymbolSearchDialog } from './symbol-search';
import { IndicatorDialog } from './indicator-dialog';
import { SettingsPopover } from './settings-popover';
import { SelectionStylePopover } from './selection-style-popover';

let engineSingleton: ChartEngine | null = null;

export function getChartEngine(): ChartEngine | null {
  return engineSingleton;
}

/** Single entry point for provider switching (symbol + watchlist realignment included). */
export async function changeProvider(providerId: string): Promise<void> {
  const engine = engineSingleton;
  if (!engine) return;
  useUiStore.getState().setProviderId(providerId);
  useUiStore.getState().setLoading(true);
  await switchProvider(
    async (provider, symbol) => {
      await engine.setProvider(provider, symbol);
    },
    (symbols) => {
      engine.setWatchlist(symbols);
      useUiStore.getState().setWatchlist(symbols);
    },
    providerId,
  );
}

export function ChartWorkspace() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  // Engine instance exposed to child panels once created (they must not
  // capture it during their first effects — child effects run first).
  const [engine, setEngine] = useState<ChartEngine | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const boot = defaultBootConfig();
    const engine = new ChartEngine({
      container: containerRef.current,
      provider: getProvider(DEFAULT_PROVIDER_ID),
      symbol: boot.symbol,
      timeframe: '1m',
    });
    engineRef.current = engine;
    engineSingleton = engine;
    setEngine(engine);

    const unsubs: Array<() => void> = [];

    unsubs.push(
      engine.events.on('symbol-changed', ({ symbol, info }) => {
        useUiStore.getState().setSymbol(symbol, info);
      }),
    );
    unsubs.push(
      engine.events.on('timeframe-changed', ({ timeframe }) => {
        useUiStore.getState().setTimeframe(timeframe);
      }),
    );
    unsubs.push(
      engine.events.on('chart-type-changed', ({ type }) => {
        useUiStore.getState().setChartType(type);
      }),
    );
    unsubs.push(
      engine.events.on('scale-changed', ({ mode }) => {
        useUiStore.getState().setScaleMode(mode);
      }),
    );
    unsubs.push(
      engine.events.on('status-changed', ({ status }) => {
        useUiStore.getState().setStatus(status as ConnectionStatus);
      }),
    );
    unsubs.push(
      engine.events.on('loading-changed', ({ loading }) => {
        useUiStore.getState().setLoading(loading);
      }),
    );
    unsubs.push(
      engine.events.on('tool-changed', ({ tool }) => {
        useUiStore.getState().setActiveTool(tool);
      }),
    );
    unsubs.push(
      engine.events.on('selection-changed', ({ drawingId }) => {
        useUiStore.getState().setSelectedDrawing(drawingId);
      }),
    );
    unsubs.push(
      engine.events.on('drawings-changed', () => {
        const dm = engine.getDrawingManager();
        if (dm) {
          useUiStore.getState().setHistoryFlags(dm.canUndo(), dm.canRedo());
        }
      }),
    );
    unsubs.push(
      engine.events.on('settings-changed', () => {
        const s = engine.getSettings();
        useUiStore.getState().setSettingsChanged({
          magnet: s.magnet,
          hidden: s.hideDrawings,
          extendedHours: s.extendedHours,
          sessionBreaks: s.sessionBreaks,
        });
      }),
    );
    unsubs.push(
      engine.events.on('error', ({ message }) => {
        toast({
          title: 'Data feed error',
          description: message,
          variant: 'destructive',
        });
      }),
    );

    engine.setWatchlist(boot.watchlist);
    useUiStore.getState().setWatchlist(boot.watchlist);
    void engine.mount();

    return () => {
      for (const u of unsubs) u();
      setEngine(null);
      engine.destroy();
      engineSingleton = null;
      engineRef.current = null;
    };
  }, []);

  // Global shortcuts: undo/redo for drawings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const engine = engineRef.current;
      if (!engine) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        engine.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const watchlistOpen = useUiStore((s) => s.watchlistOpen);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0b0d10] text-[#d1d5db]">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <DrawingToolbar />
        <main className="relative min-w-0 flex-1" aria-label="Main chart">
          <div
            ref={containerRef}
            className="absolute inset-0"
            // LWC injects its own canvases; the overlay + legends are added by the engine.
          />
          <SettingsPopover />
          <SelectionStylePopover />
        </main>
        {watchlistOpen ? <WatchlistPanel engine={engine} /> : null}
      </div>
      <StatusBar engine={engine} />
      <SymbolSearchDialog />
      <IndicatorDialog />
    </div>
  );
}
