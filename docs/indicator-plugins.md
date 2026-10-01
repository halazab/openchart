# Indicator Plugin Documentation

The indicator engine is fully decoupled from the renderer: an indicator is a
**pure function over typed-array market columns**. It runs identically on the
main thread (fallback) or inside the Web Worker (default). This document
explains the contract, the built-ins, and how to ship community plugins.

---

## 1. The definition contract

```ts
// src/indicators/plugin-api.ts
interface IndicatorDefinition {
  id: string;               // unique registry key ("sma", "macd", …)
  name: string;             // full name (indicators dialog)
  shortName: string;        // legend/axis label ("SMA", "MACD")
  target: 'main' | 'pane';  // overlay on price, or its own pane
  params: IndicatorParam[]; // editable numeric params
  plots: PlotSpec[];        // rendered series
  bandFill?: { upper: string; lower: string; color: string };
  compute(input: IndicatorInput, params: Record<string, number>): IndicatorOutput;
  paneStretch?: number;     // relative pane height when target === 'pane'
  formatValue?: (v: number, params: Record<string, number>) => string;
}
```

### Input — column-oriented bars

```ts
interface IndicatorInput {
  times: Float64Array;   // UTC seconds
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  flags: Uint8Array;     // bit 0 = sessionStart, bit 1 = extended hours
  length: number;
}
```

### Output — one aligned Float64Array per plot

```ts
interface IndicatorOutput {
  plots: Record<string, Float64Array>;  // keys must match plots[].id
}
```

**Rules:**

- Values align 1:1 with input bars; use `NaN` for "not yet defined" (the
  renderer turns them into gaps/whitespace automatically).
- Treat inputs as read-only. Workers transfer the buffers — mutation would
  corrupt the chart store.
- Must be deterministic and side-effect free (they run in a Worker).
- Import only pure math — no DOM, no chart library, no React. The Worker
  imports the same module.

## 2. Plots

```ts
interface PlotSpec {
  id: string;                    // referenced by compute() output
  type: 'line' | 'histogram';
  color: string;                 // CSS color
  lineWidth?: number;
  guides?: Array<{ value: number; color: string }>;  // static price lines (e.g. RSI 30/70)
  colorByValue?: { positive: string; negative: string }; // per-bar histogram coloring (MACD)
}
```

- `target: 'main'` overlays on the price pane (own invisible scale).
- `target: 'pane'` creates a resizable sub-pane with a visible price axis;
  `paneStretch` sizes it relative to the main pane.
- `bandFill` shades the area between two line plots (see Bollinger Bands).

## 3. Params

```ts
interface IndicatorParam {
  key: string; label: string;
  default: number; min: number; max: number; step: number;
}
```

Users edit these in the Indicators dialog; values are clamped to `[min, max]`
and the instance recomputes (worker path) on apply. **Performance hint:** name
length params with the substring `period` (or `fast`/`slow`) — the realtime
tail-recompute window is sized from them (`max(4×period, 400)` bars).

## 4. Realtime behavior (what you get for free)

- **Load / symbol / TF change / pagination** → full `compute()` in the Web
  Worker (buffers transferred zero-copy), results pushed to the chart.
- **Realtime tick** → bounded-tail recompute: your `compute()` runs over the
  last ~400+ bars and only the final point of each plot is pushed to the
  series. This is O(window) — no worker round-trip, no streaming state to
  maintain. Writing stateless classic formulas is enough.

## 5. Complete example — SuperTrend community plugin

```ts
// my-plugins/supertrend.ts
import type { IndicatorDefinition } from '@/indicators/plugin-api';

export const supertrendDefinition: IndicatorDefinition = {
  id: 'supertrend',
  name: 'SuperTrend',
  shortName: 'ST',
  target: 'main',
  params: [
    { key: 'period', label: 'ATR Period', default: 10, min: 2, max: 200, step: 1 },
    { key: 'mult',   label: 'Multiplier', default: 3, min: 0.5, max: 10, step: 0.5 },
  ],
  plots: [{ id: 'value', type: 'line', color: '#26a69a', lineWidth: 2 }],
  compute(input, params) {
    const n = input.length;
    const out = new Float64Array(n).fill(NaN);
    // ... ATR + trend state machine over input.high/low/close ...
    return { plots: { value: out } };
  },
};
```

Register it once (app code or a plugin loader):

```ts
import { registerDefinition } from '@/indicators/builtin';
registerDefinition(supertrendDefinition);
```

It now appears in the Indicators dialog automatically — series lifecycle,
pane management, legends, worker scheduling and undo-safe params editing are
handled by the engine.

## 6. Custom overlays (the Volume Profile pattern)

Some indicators aren't series. `overlay: 'volume-profile'` marks a definition
as handled by a dedicated renderer layer:

- The definition still lives in the registry (dialog, params, visibility).
- The engine skips series creation; instead it exposes the computed result
  (`getVolumeProfileResult()`) to `src/render/overlay/volume-profile-layer.ts`,
  which draws on the overlay canvas using `CoordinateSpace`.
- Recomputation hooks: visible-range changes (debounced 120 ms) and new-bar
  rollovers.

Use this escape hatch for price/histogram-style analytics that don't fit the
series model (profiles, VWAP bands with deviation fills, custom heatmaps).
New overlay kinds: add to `IndicatorOverlayKind`, implement a layer in
`src/render/overlay/`, and route it in `IndicatorEngine.add()`.

## 7. Built-in reference implementations

| Definition file | Indicators | Demonstrates |
|---|---|---|
| `builtin/overlays.ts` | SMA, EMA, VWAP, Bollinger | rolling window, EMA recursion, session-anchored reset via `flags`, band fill |
| `builtin/panes.ts` | RSI, MACD, ATR | Wilder smoothing, guides, `colorByValue` histogram, multi-plot panes |
| `builtin/volume-profile.ts` | Volume Profile | custom overlay kind, visible-range computation |

## 8. Worker notes

`src/indicators/worker.ts` imports the registry and answers
`{ kind: 'compute', definitionId, params, input }` messages. The scheduler
(`src/indicators/scheduler.ts`):

- copies+transfers buffers (store keeps ownership),
- falls back to inline computation if Worker construction fails
  (SSR, CSP, exotic bundlers),
- has a 4 s timeout valve that downgrades to inline rather than hanging.

Because plugin code runs in both contexts, **keep it synchronous and
allocation-conscious** (reuse scratch buffers for hot loops where possible).
Returning `Float64Array`s lets results transfer without serialization.

## 9. Testing checklist

- [ ] NaN prefix until enough bars (no exception at `length < period`)
- [ ] Deterministic: same input → same output (worker or inline)
- [ ] No mutation of input arrays
- [ ] Params at min/max don't divide by zero or produce `Infinity`
- [ ] Realtime tail path produces the same last value as a full recompute
