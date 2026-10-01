'use client';

/**
 * Indicator dialog — browse the registry, edit params, manage instances.
 * Adding/removing goes straight to the IndicatorEngine (worker-backed).
 */

import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getChartEngine } from './chart-workspace';
import { useUiStore } from '@/lib/ui-store';
import type { IndicatorInstance } from '@/indicators/engine';
import { cn } from '@/lib/utils';

export function IndicatorDialog() {
  const open = useUiStore((s) => s.indicatorsOpen);
  const setOpen = useUiStore((s) => s.setIndicatorsOpen);
  const engine = getChartEngine();
  const [version, setVersion] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onChange = () => setVersion((v) => v + 1);
    const unsub = engine?.events.on('indicators-changed', onChange);
    return unsub;
  }, [open, engine]);

  const definitions = useMemo(
    () => engine?.getIndicatorEngine()?.definitions() ?? [],
    [engine, open, version],
  );
  const instances = useMemo(
    () => engine?.getIndicatorEngine()?.listInstances() ?? [],
    [engine, open, version],
  );

  const add = (defId: string, params?: Record<string, number>) => {
    void engine?.getIndicatorEngine()?.add(defId, params);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[70vh] max-w-xl flex-col border-[#262c37] bg-[#11141a] p-0 text-[#d1d5db]">
        <DialogHeader className="px-4 pb-1 pt-4">
          <DialogTitle className="text-sm font-medium text-[#8b93a3]">
            Indicators
          </DialogTitle>
        </DialogHeader>

        {/* Active instances */}
        {instances.length > 0 ? (
          <div className="border-b border-[#1e232c] px-4 pb-3">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-[#585f6d]">
              Active on chart
            </div>
            <div className="flex flex-col gap-1">
              {instances.map((inst) => (
                <InstanceRow
                  key={inst.id}
                  instance={inst}
                  onRemove={() => engine?.getIndicatorEngine()?.remove(inst.id)}
                  onToggle={() =>
                    engine?.getIndicatorEngine()?.setVisible(inst.id, !inst.visible)
                  }
                  onUpdateParams={(params) =>
                    void engine?.getIndicatorEngine()?.updateParams(inst.id, params)
                  }
                  expanded={expanded === inst.id}
                  onToggleExpand={() =>
                    setExpanded((e) => (e === inst.id ? null : inst.id))
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Registry */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-[#585f6d]">
            Available indicators
          </div>
          <div className="flex flex-col gap-1">
            {definitions.map((def) => {
              const alreadyActive = instances.some(
                (i) => i.definitionId === def.id && (def.overlay === 'volume-profile' || i.definitionId === def.id),
              );
              return (
                <div
                  key={def.id}
                  className="flex items-center gap-3 rounded px-2 py-2 hover:bg-[#161b23]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-[#e6e9ef]">{def.name}</div>
                    <div className="text-[11px] text-[#585f6d]">
                      {def.target === 'main' ? 'Overlay' : 'Separate pane'}
                      {def.params.length > 0
                        ? ` · ${def.params.map((p) => `${p.label}: ${p.default}`).join(', ')}`
                        : ''}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      alreadyActive && def.overlay === 'volume-profile'
                        ? undefined
                        : add(def.id)
                    }
                    disabled={alreadyActive && def.overlay === 'volume-profile'}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded border border-[#262c37] text-[#8b93a3] transition-colors',
                      'hover:bg-[#1d232e] hover:text-[#e6e9ef]',
                      alreadyActive && def.overlay === 'volume-profile' && 'cursor-not-allowed opacity-40',
                    )}
                    aria-label={`Add ${def.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#585f6d]">
            Community indicators can be registered at runtime via
            <code className="mx-1 rounded bg-[#0e1116] px-1 py-0.5 font-mono text-[10px] text-[#8b93a3]">
              registerDefinition()
            </code>
            — see docs/indicator-plugins.md.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InstanceRow({
  instance,
  onRemove,
  onToggle,
  onUpdateParams,
  expanded,
  onToggleExpand,
}: {
  instance: IndicatorInstance;
  onRemove: () => void;
  onToggle: () => void;
  onUpdateParams: (params: Record<string, number>) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const engine = getChartEngine();
  const def = engine?.getIndicatorEngine()?.getDefinition(instance.definitionId);
  const [draft, setDraft] = useState<Record<string, number>>({ ...instance.params });

  return (
    <div className="rounded border border-[#1e232c] bg-[#0e1116]">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={onToggle}
          className="text-[#8b93a3] hover:text-[#d1d5db]"
          aria-label={instance.visible ? 'Hide indicator' : 'Show indicator'}
        >
          {instance.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <span className="text-[12px] text-[#e6e9ef]">{def?.name ?? instance.definitionId}</span>
          <span className="ml-2 font-mono text-[10.5px] text-[#585f6d]">
            {Object.values(instance.params).join(' ')}
          </span>
        </button>
        <button onClick={onRemove} className="text-[#8b93a3] hover:text-[#ef5350]" aria-label="Remove indicator">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && def && def.params.length > 0 ? (
        <div className="flex flex-wrap gap-3 border-t border-[#1e232c] px-3 py-2">
          {def.params.map((p) => (
            <label key={p.key} className="flex items-center gap-1.5 text-[11px] text-[#8b93a3]">
              {p.label}
              <input
                type="number"
                value={draft[p.key] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [p.key]: Number(e.target.value) }))
                }
                onBlur={() => onUpdateParams(draft)}
                className="h-6 w-16 rounded border border-[#262c37] bg-[#11141a] px-1 font-mono text-[11px] text-[#e6e9ef] outline-none focus:border-[#3a4252]"
              />
            </label>
          ))}
          <button
            onClick={() => onUpdateParams(draft)}
            className="ml-auto h-6 rounded bg-[#262c37] px-2 text-[11px] text-[#e6e9ef] hover:bg-[#323a49]"
          >
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
