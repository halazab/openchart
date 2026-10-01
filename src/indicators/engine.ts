/**
 * indicator-engine — lifecycle + renderer binding.
 *
 * The engine owns indicator INSTANCES (a definition + params + visibility),
 * drives computation (worker scheduler for full loads, bounded-tail
 * incremental recompute for realtime ticks) and pushes data into renderer
 * series through an opaque host interface — keeping this package
 * chart-library-free.
 */

import type { VolumeProfileResult } from './plugin-api';
import { BUILTIN_DEFINITIONS, defaultParams, getDefinition } from './builtin';
import { computeVolumeProfile } from './builtin/volume-profile';
import type { IndicatorDefinition } from './plugin-api';
import { IndicatorScheduler } from './scheduler';

// ---------------------------------------------------------------------------
// Host interface (implemented by chart-renderer)
// ---------------------------------------------------------------------------

/** Opaque renderer handle for one indicator instance. */
export interface IndicatorRenderHandle {
  instanceId: string;
  /** Mutable — the renderer may reassign panes when others are removed. */
  paneIndex: number;
  /** Opaque per-plot handles, keyed by plot id. */
  plots: Map<string, unknown>;
}

export interface IndicatorPoint {
  time: number;
  value: number;
  /** Per-point color (histogram colorByValue). */
  color?: string;
}

export interface IndicatorRenderHost {
  /** Create renderer series for every plot. Returns the handle. */
  createIndicatorSeries(
    definition: IndicatorDefinition,
    instanceId: string,
  ): IndicatorRenderHandle;
  removeIndicatorSeries(handle: IndicatorRenderHandle): void;
  /** Full replace (symbol/TF load, param change, pagination). */
  setPlotData(handle: IndicatorRenderHandle, plotId: string, data: IndicatorPoint[]): void;
  /** Single-point update for the realtime path. */
  updatePlotLast(handle: IndicatorRenderHandle, plotId: string, point: IndicatorPoint): void;
  setPlotVisible(handle: IndicatorRenderHandle, visible: boolean): void;
}

// ---------------------------------------------------------------------------
// Instance model
// ---------------------------------------------------------------------------

export interface IndicatorInstance {
  id: string;
  definitionId: string;
  params: Record<string, number>;
  visible: boolean;
  handle: IndicatorRenderHandle | null;
  isOverlay: boolean;
  /** Cached full-dataset output (used by overlay layers, e.g. band fills). */
  lastPlots: Map<string, Float64Array>;
}

export interface IndicatorEngineDeps {
  scheduler: IndicatorScheduler;
  host: IndicatorRenderHost;
  /** Column input for the FULL dataset (views over the BarStore). */
  getInput: () => import('./plugin-api').IndicatorInput;
  timeAt: (index: number) => number;
  barCount: () => number;
  /** Visible bar index range [start, end) — used by volume profile. */
  getVisibleRange: () => { start: number; end: number };
  onOverlayResult?: () => void;
}

const TAIL_WINDOW_MIN = 400;

export class IndicatorEngine {
  private readonly deps: IndicatorEngineDeps;
  private instances: IndicatorInstance[] = [];
  private seq = 0;
  private volumeProfileResult: VolumeProfileResult | null = null;
  private vpParams: { rows: number; valueAreaPercent: number } = { rows: 72, valueAreaPercent: 70 };
  private computeGeneration = 0;

  onChange: ((reason: 'add' | 'remove' | 'toggle') => void) | null = null;

  constructor(deps: IndicatorEngineDeps) {
    this.deps = deps;
  }

  definitions(): IndicatorDefinition[] {
    return BUILTIN_DEFINITIONS;
  }

  getDefinition(definitionId: string): IndicatorDefinition | undefined {
    return getDefinition(definitionId);
  }

  listInstances(): readonly IndicatorInstance[] {
    return this.instances;
  }

  hasOverlay(): boolean {
    return this.instances.some((i) => i.isOverlay && i.visible);
  }

  // -- Volume profile -------------------------------------------------------

  getVolumeProfileResult(): VolumeProfileResult | null {
    return this.volumeProfileResult;
  }

  volumeProfileParams(): { rows: number; valueAreaPercent: number } {
    return this.vpParams;
  }

  /** Recompute the visible-range profile (cheap: O(visible bars + rows)). */
  recomputeVolumeProfile(): void {
    const def = getDefinition('volume-profile');
    if (!def) return;
    const input = this.deps.getInput();
    if (input.length === 0) {
      this.volumeProfileResult = null;
      this.deps.onOverlayResult?.();
      return;
    }
    const { start, end } = this.deps.getVisibleRange();
    const s = Math.max(0, Math.min(input.length, Math.floor(start)));
    const e = Math.max(s, Math.min(input.length, Math.ceil(end)));
    if (e <= s) {
      this.volumeProfileResult = null;
      this.deps.onOverlayResult?.();
      return;
    }
    // Visible price domain.
    let priceLow = Infinity;
    let priceHigh = -Infinity;
    for (let i = s; i < e; i++) {
      if (input.high[i] > priceHigh) priceHigh = input.high[i];
      if (input.low[i] < priceLow) priceLow = input.low[i];
    }
    if (!(priceHigh > priceLow)) {
      this.volumeProfileResult = null;
      this.deps.onOverlayResult?.();
      return;
    }
    this.volumeProfileResult = computeProfile(
      input,
      s,
      e,
      priceLow,
      priceHigh,
      this.vpParams.rows,
      this.vpParams.valueAreaPercent,
    );
    this.deps.onOverlayResult?.();
  }

  // -- Instance management ----------------------------------------------------

  async add(definitionId: string, params?: Record<string, number>): Promise<IndicatorInstance | null> {
    const def = getDefinition(definitionId);
    if (!def) return null;

    if (def.overlay === 'volume-profile') {
      if (params) {
        this.vpParams = {
          rows: clampParam(params.rows ?? def.params[0]?.default ?? 72, 10, 200, 72),
          valueAreaPercent: clampParam(
            params.valueAreaPercent ?? def.params[1]?.default ?? 70,
            10,
            99,
            70,
          ),
        };
      }
      // Register the instance so visibility/params/dedup work uniformly.
      const existing = this.instances.find((i) => i.definitionId === 'volume-profile');
      if (existing) {
        existing.params = { ...this.vpParams };
        existing.visible = true;
      } else {
        this.instances.push({
          id: 'vp',
          definitionId,
          params: { ...this.vpParams },
          visible: true,
          handle: null,
          isOverlay: true,
          lastPlots: new Map(),
        });
      }
      this.recomputeVolumeProfile();
      this.onChange?.('add');
      return this.instances.find((i) => i.id === 'vp') ?? null;
    }

    const instance: IndicatorInstance = {
      id: `inst_${++this.seq}`,
      definitionId,
      params: sanitizeParams(def, params),
      visible: true,
      handle: null,
      isOverlay: false,
      lastPlots: new Map(),
    };
    instance.handle = this.deps.host.createIndicatorSeries(def, instance.id);
    this.instances.push(instance);
    await this.recomputeInstance(instance);
    this.onChange?.('add');
    return instance;
  }

  remove(instanceId: string): void {
    const idx = this.instances.findIndex((i) => i.id === instanceId);
    if (idx < 0) return;
    const instance = this.instances[idx];
    if (instance.handle) this.deps.host.removeIndicatorSeries(instance.handle);
    this.instances.splice(idx, 1);
    this.onChange?.('remove');
  }

  setVisible(instanceId: string, visible: boolean): void {
    const instance = this.instances.find((i) => i.id === instanceId);
    if (!instance) return;
    instance.visible = visible;
    if (instance.handle) this.deps.host.setPlotVisible(instance.handle, visible);
    if (instance.isOverlay) this.recomputeVolumeProfile();
    this.onChange?.('toggle');
  }

  isOverlayActive(): boolean {
    return this.instances.some((i) => i.isOverlay && i.visible);
  }

  async updateParams(instanceId: string, params: Record<string, number>): Promise<void> {
    const instance = this.instances.find((i) => i.id === instanceId);
    if (!instance) return;
    const def = getDefinition(instance.definitionId);
    if (!def) return;
    instance.params = sanitizeParams(def, params);
    if (instance.isOverlay) {
      this.vpParams = {
        rows: clampParam(instance.params.rows ?? 72, 10, 200, 72),
        valueAreaPercent: clampParam(instance.params.valueAreaPercent ?? 70, 10, 99, 70),
      };
      instance.params = { ...this.vpParams };
      this.recomputeVolumeProfile();
    } else {
      await this.recomputeInstance(instance);
    }
  }

  getInstance(instanceId: string): IndicatorInstance | undefined {
    return this.instances.find((i) => i.id === instanceId);
  }

  // -- Data flow ---------------------------------------------------------------

  /** Full recompute of every series indicator (data load / pagination). */
  async recomputeAll(): Promise<void> {
    const generation = ++this.computeGeneration;
    for (const instance of this.instances) {
      if (instance.isOverlay) continue;
      await this.recomputeInstance(instance);
      if (generation !== this.computeGeneration) return; // superseded
    }
    this.recomputeVolumeProfile();
  }

  private async recomputeInstance(instance: IndicatorInstance): Promise<void> {
    const def = getDefinition(instance.definitionId);
    if (!def || !instance.handle) return;
    const input = this.deps.getInput();
    const output = await this.deps.scheduler.compute(def.id, instance.params, input);
    instance.lastPlots = new Map(Object.entries(output.plots));
    for (const plot of def.plots) {
      const values = output.plots[plot.id];
      if (!values) continue;
      const data = buildPoints(input.times, values, input.length, plot.colorByValue);
      this.deps.host.setPlotData(instance.handle, plot.id, data);
    }
  }

  /**
   * Realtime path — bounded-tail incremental recompute.
   * Re-runs each indicator over the last `max(4×period, 400)` bars and
   * updates only the final point of every plot: O(window) per flush,
   * no worker round-trip.
   */
  onRealtimeUpdate(): void {
    const input = this.deps.getInput();
    const n = input.length;
    if (n === 0) return;
    for (const instance of this.instances) {
      if (instance.isOverlay || !instance.handle || !instance.visible) continue;
      const def = getDefinition(instance.definitionId);
      if (!def) continue;
      let window = TAIL_WINDOW_MIN;
      for (const p of def.params) {
        if (p.key.toLowerCase().includes('period')) {
          window = Math.max(window, p.default * 4);
        }
      }
      for (const key of Object.keys(instance.params)) {
        if (key.toLowerCase().includes('period') || key === 'slow' || key === 'fast') {
          window = Math.max(window, (instance.params[key] ?? 0) * 4);
        }
      }
      const start = Math.max(0, n - window);
      const tailInput = sliceInput(input, start, n);
      const output = def.compute(tailInput, instance.params);
      const lastTime = this.deps.timeAt(n - 1);
      for (const plot of def.plots) {
        const values = output.plots[plot.id];
        if (!values || values.length === 0) continue;
        const last = values[values.length - 1];
        if (Number.isNaN(last)) continue;
        this.deps.host.updatePlotLast(instance.handle, plot.id, {
          time: lastTime,
          value: last,
        });
      }
    }
  }

  dispose(): void {
    for (const instance of this.instances) {
      if (instance.handle) this.deps.host.removeIndicatorSeries(instance.handle);
    }
    this.instances = [];
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function computeProfile(
  input: import('./plugin-api').IndicatorInput,
  start: number,
  end: number,
  priceLow: number,
  priceHigh: number,
  rows: number,
  valueAreaPercent: number,
): VolumeProfileResult {
  return computeVolumeProfile(
    {
      high: input.high,
      low: input.low,
      close: input.close,
      open: input.open,
      volume: input.volume,
    },
    start,
    end,
    priceLow,
    priceHigh,
    rows,
    valueAreaPercent,
  );
}

function sanitizeParams(
  def: IndicatorDefinition,
  params?: Record<string, number>,
): Record<string, number> {
  const result = defaultParams(def);
  if (params) {
    for (const p of def.params) {
      if (params[p.key] !== undefined && Number.isFinite(params[p.key])) {
        result[p.key] = clampParam(params[p.key], p.min, p.max, p.default);
      }
    }
  }
  return result;
}

function clampParam(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Build chart points, skipping NaN as whitespace gaps. */
function buildPoints(
  times: Float64Array,
  values: Float64Array,
  length: number,
  colorByValue?: { positive: string; negative: string },
): Array<IndicatorPoint & { color?: string }> {
  const out: Array<IndicatorPoint & { color?: string }> = [];
  // Downsample when the dataset is huge: beyond ~60k visible points the
  // chart cannot resolve them anyway at typical widths.
  const stride = length > 60000 ? Math.ceil(length / 60000) : 1;
  for (let i = 0; i < length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (stride > 1 && i % stride !== 0 && i !== length - 1) continue;
    out.push({
      time: times[i],
      value: v,
      ...(colorByValue
        ? { color: v >= 0 ? colorByValue.positive : colorByValue.negative }
        : {}),
    });
  }
  return out;
}

function sliceInput(
  input: import('./plugin-api').IndicatorInput,
  start: number,
  end: number,
): import('./plugin-api').IndicatorInput {
  return {
    times: input.times.subarray(start, end),
    open: input.open.subarray(start, end),
    high: input.high.subarray(start, end),
    low: input.low.subarray(start, end),
    close: input.close.subarray(start, end),
    volume: input.volume.subarray(start, end),
    flags: input.flags.subarray(start, end),
    length: end - start,
  };
}
