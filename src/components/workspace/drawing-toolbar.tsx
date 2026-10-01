'use client';

/**
 * Drawing toolbar — left rail of tools + history + magnet/hide toggles.
 */

import {
  Crosshair,
  Eye,
  EyeOff,
  GitCommitHorizontal,
  History,
  Magnet,
  Minus,
  Move3d,
  MousePointer2,
  PenLine,
  Pipette,
  Redo2,
  Ruler,
  ScanLine,
  Slash,
  Square,
  Trash2,
  TrendingUp,
  Undo2,
  Waypoints,
} from 'lucide-react';
import { useCallback } from 'react';
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
}

const TOOLS: ToolDef[] = [
  { id: 'cursor', label: 'Cursor / Select', icon: <MousePointer2 className="h-4 w-4" /> },
  { id: 'trendline', label: 'Trend Line', icon: <PenLine className="h-4 w-4" /> },
  { id: 'ray', label: 'Ray', icon: <Slash className="h-4 w-4" /> },
  { id: 'hline', label: 'Horizontal Line', icon: <Minus className="h-4 w-4" /> },
  { id: 'vline', label: 'Vertical Line', icon: <GitCommitHorizontal className="h-4 w-4 rotate-90" /> },
  { id: 'rectangle', label: 'Rectangle', icon: <Square className="h-4 w-4" /> },
  { id: 'pricerange', label: 'Price Range', icon: <Ruler className="h-4 w-4" /> },
  { id: 'daterange', label: 'Date Range', icon: <ScanLine className="h-4 w-4" /> },
  { id: 'fib', label: 'Fibonacci Retracement', icon: <TrendingUp className="h-4 w-4" /> },
  { id: 'channel', label: 'Parallel Channel', icon: <Waypoints className="h-4 w-4" /> },
];

export function DrawingToolbar() {
  const activeTool = useUiStore((s) => s.activeTool);
  const canUndo = useUiStore((s) => s.canUndo);
  const canRedo = useUiStore((s) => s.canRedo);
  const selected = useUiStore((s) => s.selectedDrawingId);

  const pickTool = useCallback((tool: DrawingToolId) => {
    getChartEngine()?.setActiveTool(tool);
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

  return (
    <TooltipProvider delayDuration={250}>
      <aside
        aria-label="Drawing tools"
        className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-[#1e232c] bg-[#11141a] py-2"
      >
        {TOOLS.map((tool) => (
          <ToolbarButton
            key={tool.id}
            label={tool.label}
            active={activeTool === tool.id}
            onClick={() => pickTool(tool.id)}
          >
            {tool.icon}
          </ToolbarButton>
        ))}

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
          <History className="hidden" />
          <Move3d className="hidden" />
          <Pipette className="hidden" />
          <Crosshair className="hidden" />
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
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
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
            'flex h-8 w-8 items-center justify-center rounded transition-colors',
            active
              ? 'bg-[#2a3140] text-[#e3b341]'
              : 'text-[#8b93a3] hover:bg-[#1a1f29] hover:text-[#d1d5db]',
            disabled && 'cursor-not-allowed opacity-35 hover:bg-transparent',
          )}
        >
          {children}
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
