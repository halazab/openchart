'use client';

/**
 * Inline text editor for the Text annotation tool.
 *
 * Opens when a freshly placed text drawing requests editing
 * ('text-edit-requested'), positioned over the drawing's anchor.
 * Enter/blur commits; Escape cancels; an empty commit removes the drawing.
 */

import { useEffect, useRef, useState } from 'react';
import { getChartEngine } from './chart-workspace';
import type { ChartEngine } from '@/core/chart-engine';
import { cn } from '@/lib/utils';

interface EditState {
  drawingId: string;
  x: number;
  y: number;
}

export function TextEditPopover({ engine }: { engine: ChartEngine | null }) {
  const [edit, setEdit] = useState<EditState | null>(null);

  useEffect(() => {
    if (!engine) return;

    const openEditor = (drawingId: string): void => {
      const dm = engine.getDrawingManager();
      const adapter = engine.getAdapter();
      if (!dm || !adapter) return;
      const drawing = dm.list().find((d) => d.id === drawingId);
      if (!drawing || drawing.points.length === 0) return;
      const coords = adapter.coordinateSpace();
      const x = coords.timeToX(drawing.points[0].time);
      const y = coords.priceToY(drawing.points[0].price);
      if (x === null || y === null) return;
      setEdit({ drawingId, x, y });
    };

    // New placements fire the engine event.
    const unsub = engine.events.on('text-edit-requested', ({ drawingId }) => {
      openEditor(drawingId);
    });
    return unsub;
  }, [engine]);

  if (!edit) return null;
  return <TextEditor key={edit.drawingId} edit={edit} onDone={() => setEdit(null)} />;
}

function TextEditor({ edit, onDone }: { edit: EditState; onDone: () => void }) {
  const [value, setValue] = useState(() => {
    const dm = getChartEngine()?.getDrawingManager();
    const drawing = dm?.list().find((d) => d.id === edit.drawingId);
    return drawing?.text ?? '';
  });
  const committedRef = useRef(false);

  const commit = (removeIfEmpty: boolean) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const dm = getChartEngine()?.getDrawingManager();
    if (!dm) return onDone();
    const text = value.trim();
    if (text.length === 0 && removeIfEmpty) {
      dm.remove(edit.drawingId);
    } else {
      dm.updateText(edit.drawingId, text);
    }
    onDone();
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          commit(true);
        }
      }}
      onBlur={() => commit(true)}
      placeholder="Type text…"
      aria-label="Text annotation"
      style={{ left: edit.x, top: edit.y - 11 }}
      className={cn(
        'absolute z-50 w-56 rounded border border-[#3a82f7] bg-[#161a22] px-2 py-1 text-[12.5px] text-[#e6e9ef]',
        'outline-none shadow-xl shadow-black/50 placeholder:text-[#5a6373]',
      )}
    />
  );
}
