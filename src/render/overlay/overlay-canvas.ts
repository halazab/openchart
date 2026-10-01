/**
 * chart-renderer — OverlayCanvas.
 *
 * A single transparent canvas stacked above the chart (pointer-events: none)
 * with rAF-coalesced, dirty-flag-driven redraws. All custom layers render
 * here: session breaks/shading, volume profile, indicator band fills, and
 * the drawing engine's shapes.
 *
 * The canvas never intercepts input; pointer routing for drawings is done
 * by the drawing interactions layer listening on the chart container.
 */

import type { CoordinateSpace, StoreView } from '../coordinate-space';

export interface OverlayDrawContext {
  ctx: CanvasRenderingContext2D;
  coords: CoordinateSpace;
  view: StoreView;
  /** CSS pixel size of the canvas. */
  width: number;
  height: number;
  dpr: number;
}

export interface OverlayLayer {
  id: string;
  /** Render order: lower runs first. */
  z: number;
  draw(context: OverlayDrawContext): void;
  /** Called when the visible logical range changed (pan/zoom/pagination). */
  onVisibleRangeChanged?(): void;
  /** Called when bar data updated (realtime). */
  onBarUpdate?(): void;
}

export class OverlayCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layers: OverlayLayer[] = [];
  private dirty = false;
  private rafId: number | null = null;
  private ro: ResizeObserver | null = null;
  private coords: CoordinateSpace;
  private view: StoreView;
  private cssWidth = 0;
  private cssHeight = 0;
  private disposed = false;

  constructor(container: HTMLElement, coords: CoordinateSpace, view: StoreView) {
    this.coords = coords;
    this.view = view;
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '20';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.markDirty();
  }

  addLayer(layer: OverlayLayer): void {
    this.layers.push(layer);
    this.layers.sort((a, b) => a.z - b.z);
    this.markDirty();
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
    this.markDirty();
  }

  markDirty(): void {
    if (this.disposed || this.dirty) return;
    this.dirty = true;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (this.dirty) {
          this.dirty = false;
          this.draw();
        }
      });
    }
  }

  notifyVisibleRangeChanged(): void {
    for (const layer of this.layers) layer.onVisibleRangeChanged?.();
    this.markDirty();
  }

  notifyBarUpdate(): void {
    for (const layer of this.layers) layer.onBarUpdate?.();
    this.markDirty();
  }

  private resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.markDirty();
  }

  private draw(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const context: OverlayDrawContext = {
      ctx: this.ctx,
      coords: this.coords,
      view: this.view,
      width: this.cssWidth,
      height: this.cssHeight,
      dpr,
    };
    for (const layer of this.layers) {
      try {
        layer.draw(context);
      } catch (err) {
        console.error(`[overlay] layer "${layer.id}" failed`, err);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.ro?.disconnect();
    this.canvas.remove();
  }
}
