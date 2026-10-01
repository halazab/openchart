'use client';

/**
 * Selection style popover — floating style editor for the selected drawing.
 * Remounts (keyed) on selection change so style state initializes fresh
 * without effects.
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import type { LineStyleKind } from '@/drawings/types';
import { cn } from '@/lib/utils';

const SWATCHES = ['#e3b341', '#26a69a', '#ef5350', '#4d8fc9', '#9575cd', '#e6e9ef'];

export function SelectionStylePopover() {
  const selectedId = useUiStore((s) => s.selectedDrawingId);
  if (!selectedId) return null;
  return <StyleEditor key={selectedId} drawingId={selectedId} />;
}

function StyleEditor({ drawingId }: { drawingId: string }) {
  const [color, setColor] = useState(() => {
    const d = getChartEngine()?.getDrawingManager()?.getSelectedDrawing();
    return d?.style.color ?? '#e3b341';
  });
  const [width, setWidth] = useState(() => {
    const d = getChartEngine()?.getDrawingManager()?.getSelectedDrawing();
    return d?.style.lineWidth ?? 2;
  });
  const [lineStyle, setLineStyle] = useState<LineStyleKind>(() => {
    const d = getChartEngine()?.getDrawingManager()?.getSelectedDrawing();
    return d?.style.lineStyle ?? 'solid';
  });

  const applyStyle = (patch: Partial<{ color: string; lineWidth: number; lineStyle: LineStyleKind }>) => {
    const dm = getChartEngine()?.getDrawingManager();
    if (!dm) return;
    if (patch.color !== undefined) setColor(patch.color);
    if (patch.lineWidth !== undefined) setWidth(patch.lineWidth);
    if (patch.lineStyle !== undefined) setLineStyle(patch.lineStyle);
    dm.updateStyle(drawingId, patch);
  };

  return (
    <div
      className="absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[#262c37] bg-[#11141a] px-2.5 py-1.5 shadow-xl shadow-black/40"
      role="toolbar"
      aria-label="Drawing style"
    >
      {SWATCHES.map((c) => (
        <button
          key={c}
          onClick={() => applyStyle({ color: c })}
          aria-label={`Color ${c}`}
          className={cn(
            'h-4 w-4 rounded-full border',
            color === c ? 'border-[#e6e9ef]' : 'border-transparent',
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <div className="h-5 w-px bg-[#262c37]" />
      {[1, 2, 3, 4].map((w) => (
        <button
          key={w}
          onClick={() => applyStyle({ lineWidth: w })}
          aria-label={`Width ${w}`}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded',
            width === w ? 'bg-[#262c37]' : 'hover:bg-[#1a1f29]',
          )}
        >
          <span
            className="block rounded-full bg-[#d1d5db]"
            style={{ width: w + 1, height: w + 1 }}
          />
        </button>
      ))}
      <div className="h-5 w-px bg-[#262c37]" />
      {(
        [
          ['solid', 'Solid'],
          ['dashed', 'Dash'],
          ['dotted', 'Dot'],
        ] as Array<[LineStyleKind, string]>
      ).map(([kind, label]) => (
        <button
          key={kind}
          onClick={() => applyStyle({ lineStyle: kind })}
          className={cn(
            'h-6 rounded px-1.5 text-[10.5px]',
            lineStyle === kind ? 'bg-[#262c37] text-[#e6e9ef]' : 'text-[#8b93a3] hover:bg-[#1a1f29]',
          )}
        >
          {label}
        </button>
      ))}
      <div className="h-5 w-px bg-[#262c37]" />
      <button
        onClick={() => {
          getChartEngine()?.getDrawingManager()?.remove(drawingId);
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-[#8b93a3] hover:bg-[#1a1f29] hover:text-[#ef5350]"
        aria-label="Delete drawing"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
