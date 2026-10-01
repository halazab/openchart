/**
 * indicator-engine — Web Worker entry.
 *
 * Receives compute requests with TRANSFERRED typed-array buffers (zero-copy),
 * runs the pure indicator math off the main thread, and posts plots back.
 * Falls back gracefully: if worker construction fails (unsupported bundler
 * context), the scheduler computes inline on the main thread.
 */

import { getDefinition } from './builtin';
import type { IndicatorInput, IndicatorOutput } from './plugin-api';

export interface WorkerRequest {
  kind: 'compute';
  id: number;
  definitionId: string;
  params: Record<string, number>;
  input: IndicatorInput;
}

export interface WorkerResponse {
  kind: 'result';
  id: number;
  plots: Record<string, Float64Array>;
  error?: string;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.kind !== 'compute') return;
  try {
    const def = getDefinition(msg.definitionId);
    if (!def) throw new Error(`Unknown indicator: ${msg.definitionId}`);
    const output: IndicatorOutput = def.compute(msg.input, msg.params);
    const transfer: ArrayBuffer[] = [];
    for (const key of Object.keys(output.plots)) {
      const buf = output.plots[key].buffer as ArrayBuffer;
      if (!transfer.includes(buf)) transfer.push(buf);
    }
    (self as unknown as Worker).postMessage(
      { kind: 'result', id: msg.id, plots: output.plots } satisfies WorkerResponse,
      transfer,
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      kind: 'result',
      id: msg.id,
      plots: {},
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
