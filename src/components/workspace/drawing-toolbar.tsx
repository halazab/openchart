'use client';

/**
 * Drawing toolbar — TradingView-style left rail.
 *
 * Tools are grouped (lines & rays / shapes / ranges / fib & channels /
 * positions); clicking a group button opens a flyout menu and displays the
 * last-used tool from that group, exactly like TradingView. Single-tool
 * entries (cursor, text) sit directly on the rail.
 */

import {
  ArrowDown,
  ArrowRightToLine,
  ArrowUp,
  CalendarRange,
  Circle,
  Eye,
  EyeOff,
  GitCommitHorizontal,
  GitFork,
  Magnet,
  Minus,
  MoveDiagonal,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  Ruler,
  ScanLine,
  Slash,
  Square,
  Trash2,
  TrendingUp,
  Triangle,
  Type,
  Undo2,
  Waypoints,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import type { DrawingToolId } from '@/core/types';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ToolDef {
  id: DrawingToolId;
  label: string;
  icon: React.ReactNode;
  /** Optional icon color (position tools). */
  accent?: string;
}

interface ToolGroup {
  id: string;
  label: string;
  main: DrawingToolId;
  tools: ToolDef[];
}

function ArrowUpRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

const TOOLS: Record<string, ToolDef> = {
  cursor: { id: 'cursor', label: 'Cursor / Select', icon: <MousePointer2 className="h-4 w-4" /> },
  trendline: { id: 'trendline', label: 'Trend Line', icon: <PenLine className="h-4 w-4" /> },
  ray: { id: 'ray', label: 'Ray', icon: <Slash className="h-4 w-4" /> },
  'extended-line': { id: 'extended-line', label: 'Extended Line', icon: <MoveDiagonal className="h-4 w-4" /> },
  arrow: { id: 'arrow', label: 'Arrow', icon: <ArrowUpRightIcon /> },
  'horizontal-ray': { id: 'horizontal-ray', label: 'Horizontal Ray', icon: <ArrowRightToLine className="h-4 w-4" /> },
  hline: { id: 'hline', label: 'Horizontal Line', icon: <Minus className="h-4 w-4" /> },
  vline: { id: 'vline', label: 'Vertical Line', icon: <GitCommitHorizontal className="h-4 w-4 rotate-90" /> },
  'cross-line': { id: 'cross-line', label: 'Cross Line', icon: <Plus className="h-4 w-4" /> },
  rectangle: { id: 'rectangle', label: 'Rectangle', icon: <Square className="h-4 w-4" /> },
  triangle: { id: 'triangle', label: 'Triangle', icon: <Triangle className="h-4 w-4" /> },
  ellipse: { id: 'ellipse', label: 'Ellipse', icon: <Circle className="h-4 w-4" /> },
  pricerange: { id: 'pricerange', label: 'Price Range', icon: <Ruler className="h-4 w-4" /> },
  daterange: { id: 'daterange', label: 'Date Range', icon: <CalendarRange className="h-4 w-4" /> },
  fib: { id: 'fib', label: 'Fibonacci Retracement', icon: <TrendingUp className="h-4 w-4" /> },
  pitchfork: { id: 'pitchfork', label: "Andrews' Pitchfork", icon: <GitFork className="h-4 w-4" /> },
  channel: { id: 'channel', label: 'Parallel Channel', icon: <Waypoints className="h-4 w-4" /> },
  'long-position': {
    id: 'long-position',
    label: 'Long Position',
    icon: <ArrowUp className="h-4 w-4" />,
    accent: '#26a69a',
  },
  'short-position': {
    id: 'short-position',
    label: 'Short Position',
    icon: <ArrowDown className="h-4 w-4" />,
    accent: '#ef5350',
  },
  text: { id: 'text', label: 'Text Annotation', icon: <Type className="h-4 w-4" /> },
};

const GROUPS: ToolGroup[] = [
  {
    id: 'lines',
    label: 'Lines & Rays',
    main: 'trendline',
    tools: [TOOLS.trendline, TOOLS.ray, TOOLS['extended-line'], TOOLS.arrow, TOOLS['horizontal-ray'], TOOLS.hline, TOOLS.vline, TOOLS['cross-line']],
  },
  {
    id: 'shapes',
    label: 'Geometric Shapes',
    main: 'rectangle',
    tools: [TOOLS.rectangle, TOOLS.triangle, TOOLS.ellipse],
  },
  {
    id: 'ranges',
    label: 'Measure Ranges',
    main: 'pricerange',
    tools: [TOOLS.pricerange, TOOLS.daterange],
  },
  {
    id: 'fib',
    label: 'Fibonacci & Channels',
    main: 'fib',
    tools: [TOOLS.fib, TOOLS.pitchfork, TOOLS.channel],
  },
  {
    id: 'positions',
    label: 'Position Tools',
    main: 'long-position',
    tools: [TOOLS['long-position'], TOOLS['short-position']],
  },
];

export function DrawingToolbar() {
  const activeTool = useUiStore((s) => s.activeTool);
  const canUndo = useUiStore((s) => s.canUndo);
  const canRedo = useUiStore((s) => s.canRedo);
  const selected = useUiStore((s) => s.selectedDrawingId);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const pickTool = useCallback((tool: DrawingToolId) => {
    getChartEngine()?.setActiveTool(tool);
    setOpenGroup(null);
  }, []);

  const toggleMagnet = useCallback(() => {
    const engine = getChartEngine();
    if (!engine) return;
    const next = !engine.getSettings().magnet;
    engine.setSetting('magnet', next);
  }, []);

  const toggleHide = useCallback(() => {
    const engine = getChartEngine();
    if (!engine) return;
    const next = !engine.getSettings().hideDrawings;
    engine.setSetting('hideDrawings', next);
  }, []);

  const magnet = useUiStoreStoreMagnet();
  const hidden = useUiStoreStoreHidden();

  // Icon shown on a group button = the active tool if it belongs to the
  // group, otherwise the group's main tool (TradingView behavior).
  const iconForGroup = (group: ToolGroup) => {
    const active = group.tools.find((t) => t.id === activeTool);
    return active ?? TOOLS[group.main];
  };

  return (
    <TooltipProvider delayDuration={250}>
      <aside
        aria-label="Drawing tools"
        className="relative flex w-11 shrink-0 flex-col items-center gap-1 border-r border-[#1e232c] bg-[#11141a] py-2"
      >
        {openGroup && (
          <div
            aria-hidden
            className="fixed inset-0 z-40"
            onClick={() => setOpenGroup(null)}
          />
        )}

        <ToolbarButton
          label={TOOLS.cursor.label}
          active={activeTool === 'cursor'}
          onClick={() => pickTool('cursor')}
        >
          {TOOLS.cursor.icon}
        </ToolbarButton>

        {GROUPS.map((group) => {
          const shown = iconForGroup(group);
          const hasActive = group.tools.some((t) => t.id === activeTool);
          return (
            <div key={group.id} className="relative">
              <ToolbarButton
                label={hasActive ? shown.label : group.label}
                active={hasActive}
                accent={shown.accent}
                onClick={() => setOpenGroup((cur) => (cur === group.id ? null : group.id))}
                chevron
              >
                {shown.icon}
              </ToolbarButton>
              {openGroup === group.id && (
                <div
                  role="menu"
                  aria-label={group.label}
                  className="absolute left-10 top-0 z-50 w-52 rounded-md border border-[#262c37] bg-[#161a22] py-1 shadow-xl shadow-black/50"
                >
                  {group.tools.map((tool) => (
                    <button
                      key={tool.id}
                      role="menuitemradio"
                      aria-checked={activeTool === tool.id}
                      onClick={() => pickTool(tool.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors',
                        activeTool === tool.id
                          ? 'bg-[#222a36] text-[#e3b341]'
                          : 'text-[#b7bec9] hover:bg-[#1e242f] hover:text-[#e6e9ef]',
                      )}
                    >
                      <span
                        className="flex h-4 w-4 items-center justify-center"
                        style={tool.accent ? { color: tool.accent } : undefined}
                      >
                        {tool.icon}
                      </span>
                      {tool.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <ToolbarButton
          label={TOOLS.text.label}
          active={activeTool === 'text'}
          onClick={() => pickTool('text')}
        >
          {TOOLS.text.icon}
        </ToolbarButton>

        <div className="my-1 h-px w-6 bg-[#1e232c]" />

        <ToolbarButton label="Magnet (snap to OHLC)" active={magnet} onClick={toggleMagnet}>
          <Magnet className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label={hidden ? 'Show drawings' : 'Hide drawings'}
          active={hidden}
          onClick={toggleHide}
        >
          {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ToolbarButton>

        <div className="my-1 h-px w-6 bg-[#1e232c]" />

        <ToolbarButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => getChartEngine()?.undo()}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => getChartEngine()?.redo()}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>

        <div className="my-1 h-px w-6 bg-[#1e232c]" />

        <ToolbarButton
          label="Delete selected (Del)"
          disabled={!selected}
          onClick={() => {
            const engine = getChartEngine();
            const id = engine?.getDrawingManager()?.isSelected();
            if (engine && id) engine.getDrawingManager()?.remove(id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Remove all drawings"
          onClick={() => getChartEngine()?.getDrawingManager()?.clearAll()}
        >
          <span className="text-[11px] font-bold leading-none">✕</span>
        </ToolbarButton>
      </aside>
    </TooltipProvider>
  );
}

// Magnet/hide flags are engine settings mirrored into the UI store on change.
function useUiStoreStoreMagnet(): boolean {
  return useUiStore((s) => (s.settingsChanged?.magnet ?? false));
}
function useUiStoreStoreHidden(): boolean {
  return useUiStore((s) => (s.settingsChanged?.hidden ?? false));
}

function ToolbarButton({
  label,
  active,
  disabled,
  accent,
  chevron,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  accent?: string;
  chevron?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-pressed={active}
          aria-label={label}
          className={cn(
            'relative flex h-8 w-8 items-center justify-center rounded transition-colors',
            active
              ? 'bg-[#2a3140] text-[#e3b341]'
              : 'text-[#8b93a3] hover:bg-[#1a1f29] hover:text-[#d1d5db]',
            disabled && 'cursor-not-allowed opacity-35 hover:bg-transparent',
          )}
        >
          <span style={accent && !active ? { color: accent } : undefined}>{children}</span>
          {chevron && (
            <span
              aria-hidden
              className={cn(
                'absolute bottom-0.5 right-0.5 h-0 w-0 border-b-[4px] border-l-[4px] border-b-[#5a6373] border-l-transparent',
              )}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="border-[#262c37] bg-[#161a22] px-2 py-1 text-[11px] text-[#d1d5db]"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
