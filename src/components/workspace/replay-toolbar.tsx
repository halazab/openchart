'use client';

/**
 * Replay toolbar — floating control strip shown while bar replay is
 * active (bottom-left of the chart, TradingView-style).
 *
 * High-frequency cursor position renders via ref (textContent), not React.
 */

import { useEffect, useRef } from 'react';
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import { formatUtcTime } from '@/core/math';
import { cn } from '@/lib/utils';

const SPEEDS = [0.5, 1, 2, 5, 10];

export function ReplayToolbar() {
  const active = useUiStore((s) => s.replayActive);
  const playing = useUiStore((s) => s.replayPlaying);
  const speed = useUiStore((s) => s.replaySpeed);
  const posRef = useRef<HTMLSpanElement>(null);

  // Cursor position (changes every step) — imperative textContent.
  useEffect(() => {
    const engine = getChartEngine();
    if (!engine || !active) return;
    const render = () => {
      const st = engine.getReplayState();
      if (posRef.current) {
        posRef.current.textContent = `${st.index + 1} / ${st.total}`;
      }
    };
    render();
    return engine.events.on('replay-changed', render);
  }, [active]);

  // Replay bar time label.
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const engine = getChartEngine();
    if (!engine || !active) return;
    const render = () => {
      const st = engine.getReplayState();
      if (timeRef.current) {
        const store = engine.store;
        const time = st.index >= 0 && st.total > 0 ? store.timeAt(Math.min(st.index, st.total - 1)) : null;
        timeRef.current.textContent = time === null ? '' : formatUtcTime(time, true) + ' UTC';
      }
    };
    render();
    return engine.events.on('replay-changed', render);
  }, [active]);

  if (!active) return null;

  const engine = () => getChartEngine();

  return (
    <div
      role="toolbar"
      aria-label="Bar replay controls"
      className="absolute bottom-3 left-3 z-40 flex items-center gap-1 rounded-md border border-[#262c37] bg-[#161a22]/95 px-1.5 py-1 shadow-lg backdrop-blur"
    >
      <button
        onClick={() => engine()?.exitReplay()}
        className="rounded p-1 text-[#8b93a3] hover:bg-[#262c37] hover:text-[#ef5350]"
        aria-label="Exit replay"
        title="Exit replay"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="mx-0.5 h-4 w-px bg-[#262c37]" />
      <button
        onClick={() => engine()?.replayStep(-1)}
        className="rounded p-1 text-[#d1d5db] hover:bg-[#262c37]"
        aria-label="Step back"
        title="Step back (←)"
      >
        <SkipBack className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => {
          const e = engine();
          if (!e) return;
          if (useUiStore.getState().replayPlaying) e.replayPause();
          else e.replayPlay();
        }}
        className={cn('rounded p-1.5', playing ? 'text-[#e3b341]' : 'text-[#e6e9ef]', 'hover:bg-[#262c37]')}
        aria-label={playing ? 'Pause replay' : 'Play replay'}
        title={playing ? 'Pause (space)' : 'Play (space)'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button
        onClick={() => engine()?.replayStep(1)}
        className="rounded p-1 text-[#d1d5db] hover:bg-[#262c37]"
        aria-label="Step forward"
        title="Step forward (→)"
      >
        <SkipForward className="h-3.5 w-3.5" />
      </button>

      <div className="mx-0.5 h-4 w-px bg-[#262c37]" />
      <div className="flex items-center gap-1 px-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => engine()?.setReplaySpeed(s)}
            className={cn(
              'rounded px-1 py-0.5 font-mono text-[10px]',
              speed === s ? 'bg-[#262c37] text-[#e6e9ef]' : 'text-[#8b93a3] hover:text-[#d1d5db]',
            )}
            aria-pressed={speed === s}
            aria-label={`Replay speed ${s}x`}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="mx-0.5 h-4 w-px bg-[#262c37]" />
      <span ref={posRef} className="px-1 font-mono text-[10.5px] text-[#8b93a3]" />
      <span ref={timeRef} className="px-1 font-mono text-[10.5px] text-[#585f6d]" />
    </div>
  );
}
