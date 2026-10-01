/**
 * chart-core — minimal typed event emitter.
 *
 * Zero dependencies, allocation-light, safe against re-entrant dispatch
 * (handlers list is copied before iteration).
 */

type Handler<T> = (payload: T) => void;

export class TypedEmitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const wrapped: Handler<Events[K]> = (payload) => {
      off();
      handler(payload);
    };
    const off = this.on(event, wrapped);
    return off;
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler as Handler<never>);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    // Copy to keep dispatch safe against handlers that subscribe/unsubscribe.
    const snapshot = Array.from(set) as Array<Handler<Events[K]>>;
    for (const handler of snapshot) {
      try {
        handler(payload);
      } catch (err) {
        // A faulty listener must never break the engine loop.
        console.error(`[engine] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
