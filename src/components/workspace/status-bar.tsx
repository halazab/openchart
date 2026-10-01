'use client';

/**
 * Status bar — provider, connection, data stats. Stats values update
 * imperatively (no React re-render per tick).
 */

import { useEffect, useRef, useState } from 'react';
import type { ChartEngine } from '@/core/chart-engine';
import { useUiStore } from '@/lib/ui-store';
import { changeProvider } from './chart-workspace';
import { PROVIDERS } from '@/lib/provider-registry';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const STATUS_COLOR: Record<string, string> = {
  connected: '#26a69a',
  connecting: '#e3b341',
  reconnecting: '#e3b341',
  disconnected: '#585f6d',
  idle: '#585f6d',
  error: '#ef5350',
};

export function StatusBar({ engine }: { engine: ChartEngine | null }) {
  const providerId = useUiStore((s) => s.providerId);
  const status = useUiStore((s) => s.status);
  const symbol = useUiStore((s) => s.symbol);
  const timeframe = useUiStore((s) => s.timeframe);

  const barsRef = useRef<HTMLSpanElement>(null);
  const ticksRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const lastBarRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!engine) return;
    return engine.events.on('stats', (stats) => {
      if (barsRef.current) barsRef.current.textContent = `${stats.bars.toLocaleString()} bars`;
      if (ticksRef.current)
        ticksRef.current.textContent = `${stats.ticksPerSec} ticks/s`;
      if (fpsRef.current) fpsRef.current.textContent = `${stats.fps} fps`;
      const t = engine.getLastRealtimeBarTime();
      if (lastBarRef.current) {
        lastBarRef.current.textContent =
          t === null ? '—' : new Date(t * 1000).toISOString().slice(11, 16) + ' UTC';
      }
    });
  }, [engine]);

  const pickProvider = (id: string) => {
    if (!engine) return;
    void changeProvider(id);
  };

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-[#1e232c] bg-[#11141a] px-3 text-[10.5px] text-[#8b93a3]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-[#1a1f29]"
            aria-label="Select data provider"
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: STATUS_COLOR[status] ?? '#585f6d' }}
              data-testid="connection-dot"
            />
            <span className="font-medium text-[#d1d5db]">{providerId}</span>
            <span className="text-[#585f6d]">▾</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-[#262c37] bg-[#161a22] text-[#11px] text-[#d1d5db]">
          {PROVIDERS.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => pickProvider(p.id)}
              className={cn('text-[11px]', p.id === providerId && 'bg-[#262c37]')}
            >
              {p.name}
              {p.offline ? ' · offline sim' : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-[#585f6d]">|</span>
      <span>
        {symbol} · {timeframe.toUpperCase()}
      </span>

      <div className="flex-1" />

      <span ref={lastBarRef} className="font-mono" title="Last realtime bar (UTC)">
        —
      </span>
      <span ref={barsRef} className="font-mono">
        0 bars
      </span>
      <span ref={ticksRef} className="font-mono" title="Ingested realtime events per second">
        0 ticks/s
      </span>
      <span ref={fpsRef} className="font-mono" title="Render loop frames per second">
        0 fps
      </span>
    </footer>
  );
}
