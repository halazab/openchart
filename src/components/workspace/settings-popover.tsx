'use client';

/**
 * Settings popover — display toggles (grid, sessions, extended hours,
 * crosshair OHLC, left scale) + view reset.
 */

import { useEffect } from 'react';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export function SettingsPopover() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const engine = getChartEngine();
  const settings = useUiStore((s) => s.settingsChanged);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-settings-popover]')) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  if (!open) return null;

  const get = (key: 'grid' | 'sessionBreaks' | 'extendedHours' | 'crosshairOhlc' | 'leftScale' | 'volume') =>
    engine?.getSettings()[key] ?? false;

  const set = (key: 'grid' | 'sessionBreaks' | 'extendedHours' | 'crosshairOhlc' | 'leftScale' | 'volume', value: boolean) => {
    engine?.setSetting(key, value);
    const s = engine?.getSettings();
    if (s) {
      useUiStore.getState().setSettingsChanged({
        magnet: s.magnet,
        hidden: s.hideDrawings,
        extendedHours: s.extendedHours,
        sessionBreaks: s.sessionBreaks,
      });
    }
  };

  void settings;

  const info = engine?.getSymbolInfo();
  const equity = info?.sessionModel === 'equity';

  return (
    <div
      data-settings-popover
      className="absolute right-3 top-3 z-50 w-64 rounded-md border border-[#262c37] bg-[#11141a] p-3 shadow-xl shadow-black/40"
      role="dialog"
      aria-label="Chart settings"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#585f6d]">
        Display
      </div>
      <Row label="Grid lines" checked={get('grid')} onChange={(v) => set('grid', v)} />
      <Row label="Volume histogram" checked={get('volume')} onChange={(v) => set('volume', v)} />
      <Row label="Crosshair OHLC" checked={get('crosshairOhlc')} onChange={(v) => set('crosshairOhlc', v)} />
      <Row label="Left price scale" checked={get('leftScale')} onChange={(v) => set('leftScale', v)} />
      <Row
        label="Session breaks"
        checked={get('sessionBreaks')}
        onChange={(v) => set('sessionBreaks', v)}
        disabled={!equity}
        hint={equity ? undefined : 'Continuous market — no sessions'}
      />
      <Row
        label="Extended hours"
        checked={get('extendedHours')}
        onChange={(v) => set('extendedHours', v)}
        disabled={!equity}
        hint={equity ? 'Reloads data' : 'Continuous market — always on'}
      />
      <button
        onClick={() => engine?.resetView()}
        className="mt-2 w-full rounded border border-[#262c37] py-1.5 text-[11px] text-[#8b93a3] hover:bg-[#161b23] hover:text-[#d1d5db]"
      >
        Reset view
      </button>
    </div>
  );
}

function Row({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-1.5',
        disabled && 'opacity-40',
      )}
      title={hint}
    >
      <span className="text-[11.5px] text-[#d1d5db]">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="data-[state=checked]:bg-[#3d6b64]"
      />
    </div>
  );
}
