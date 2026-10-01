'use client';

/**
 * Chart right-click context menu — TradingView-style quick actions:
 * horizontal line at price, bar replay from this bar, copy price,
 * reset view. Positioned imperatively from the contextmenu event.
 */

import { useEffect, useRef, useState } from 'react';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';

interface MenuState {
  x: number;
  y: number;
  price: number;
  logicalIndex: number;
}

export function ChartContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const replayActive = useUiStore((s) => s.replayActive);

  // Listen on the chart container (registered once; engine may swap).
  useEffect(() => {
    const attach = setTimeout(() => {
      const container = document.querySelector<HTMLElement>('[aria-label="Main chart"] > div');
      if (!container) return;
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const engine = getChartEngine();
        if (!engine) return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const coords = engine.getAdapter()?.coordinateSpace();
        const price = coords?.yToPrice(y) ?? null;
        const time = coords?.xToTime(x) ?? null;
        if (price === null) return;
        const store = engine.store;
        const logicalIndex = time !== null && store.length > 0
          ? Math.min(Math.max(0, store.indexOfTime(time)), store.length - 1)
          : store.length - 1;
        setMenu({ x: e.clientX, y: e.clientY, price, logicalIndex });
      };
      container.addEventListener('contextmenu', onContextMenu);
      (container as HTMLElement & { __ctxMenuCleanup?: () => void }).__ctxMenuCleanup = () =>
        container.removeEventListener('contextmenu', onContextMenu);
    }, 50);
    return () => {
      clearTimeout(attach);
      const container = document.querySelector<HTMLElement>('[aria-label="Main chart"] > div');
      const cleanup = (container as (HTMLElement & { __ctxMenuCleanup?: () => void }) | null)
        ?.__ctxMenuCleanup;
      cleanup?.();
    };
  }, []);

  // Dismiss on any click outside / Escape / scroll.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!menu) return null;

  const engine = getChartEngine();
  const precision = engine?.getSymbolInfo()?.pricePrecision ?? 2;
  const items: Array<{ label: string; hint?: string; action: () => void }> = [
    {
      label: `Add horizontal line at ${menu.price.toFixed(Math.min(precision, 4))}`,
      action: () => engine?.createHorizontalLine(menu.price),
    },
    {
      label: replayActive ? 'Restart bar replay from here' : 'Start bar replay from here',
      action: () => engine?.enterReplay(menu.logicalIndex),
    },
    {
      label: 'Copy price',
      action: () => {
        void navigator.clipboard?.writeText(String(menu.price)).catch(() => {});
      },
    },
    {
      label: 'Reset chart view',
      action: () => engine?.resetView(),
    },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[100] min-w-56 overflow-hidden rounded-md border border-[#262c37] bg-[#161a22] py-1 shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            item.action();
            setMenu(null);
          }}
          className="block w-full px-3 py-1.5 text-left text-[12px] text-[#d1d5db] hover:bg-[#262c37]"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
