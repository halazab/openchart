/**
 * indicator-engine — computation scheduler.
 *
 * Routes full indicator computations to a Web Worker (typed-array buffers
 * are transferred, not copied) and falls back to inline main-thread
 * computation when workers are unavailable (SSR, exotic bundlers, CSP).
 *
 * Realtime tick updates do NOT go through the scheduler — they use the
 * bounded-tail recompute path (see IndicatorEngine) which is O(window).
 */

import type { IndicatorInput, IndicatorOutput } from './plugin-api';
import { getDefinition } from './builtin';
import type { WorkerRequest, WorkerResponse } from './worker';

interface PendingRequest {
  resolve: (output: IndicatorOutput) => void;
  reject: (err: Error) => void;
}

export class IndicatorScheduler {
  private worker: Worker | null = null;
  private workerBroken = false;
  private seq = 0;
  private pending = new Map<number, PendingRequest>();

  private ensureWorker(): Worker | null {
    if (this.workerBroken) return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        name: 'indicator-engine',
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error));
        else entry.resolve({ plots: msg.plots });
      };
      worker.onerror = (event) => {
        // Worker failed to load/execute — mark broken, reject in-flight.
        this.workerBroken = true;
        this.disposeWorker();
        for (const [, entry] of this.pending) {
          entry.reject(new Error(`indicator worker error: ${event.message ?? 'unknown'}`));
        }
        this.pending.clear();
      };
      this.worker = worker;
      return worker;
    } catch {
      this.workerBroken = true;
      return null;
    }
  }

  async compute(
    definitionId: string,
    params: Record<string, number>,
    input: IndicatorInput,
  ): Promise<IndicatorOutput> {
    const worker = this.ensureWorker();
    if (!worker) return this.computeInline(definitionId, params, input);

    const id = ++this.seq;
    // Copy buffers — the originals stay attached to the BarStore.
    const copy: IndicatorInput = {
      times: input.times.slice(),
      open: input.open.slice(),
      high: input.high.slice(),
      low: input.low.slice(),
      close: input.close.slice(),
      volume: input.volume.slice(),
      flags: input.flags.slice(),
      length: input.length,
    };
    const message: WorkerRequest = {
      kind: 'compute',
      id,
      definitionId,
      params: { ...params },
      input: copy,
    };
    const transfer: ArrayBuffer[] = [
      copy.times.buffer as ArrayBuffer,
      copy.open.buffer as ArrayBuffer,
      copy.high.buffer as ArrayBuffer,
      copy.low.buffer as ArrayBuffer,
      copy.close.buffer as ArrayBuffer,
      copy.volume.buffer as ArrayBuffer,
      copy.flags.buffer as ArrayBuffer,
    ];

    return new Promise<IndicatorOutput>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage(message, transfer);
      } catch (err) {
        this.pending.delete(id);
        // postMessage can fail (e.g. detached buffers) — go inline.
        this.computeInline(definitionId, params, input).then(resolve, reject);
        void err;
      }
      // Safety valve: never leave the caller hanging forever.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          this.computeInline(definitionId, params, input).then(resolve, reject);
        }
      }, 4000);
    });
  }

  async computeInline(
    definitionId: string,
    params: Record<string, number>,
    input: IndicatorInput,
  ): Promise<IndicatorOutput> {
    const def = getDefinition(definitionId);
    if (!def) throw new Error(`Unknown indicator: ${definitionId}`);
    return def.compute(input, params);
  }

  private disposeWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  dispose(): void {
    this.disposeWorker();
    this.pending.clear();
  }
}
