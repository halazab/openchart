/**
 * drawing-engine — pointer interaction controller.
 *
 * Routes pointer events between the chart library and the drawing system:
 *
 *  - tool active (creating): ALL pointerdowns are captured (capture phase +
 *    stopPropagation) so the chart never pans mid-creation; each click adds
 *    a magnet-aware anchor; completing the required count commits the object.
 *  - cursor tool: hit-testing on pointerdown. Hits select + start a drag
 *    (captured so the chart doesn't pan); misses deselect and fall through
 *    to the chart's native pan/zoom.
 *
 * Drag deltas are computed in TIME/PRICE space so they are invariant to
 * zoom level. Escape cancels creation; Delete removes the selection
 * (wired by the engine).
 */

import type { CoordinateSpace, StoreView } from '../render/coordinate-space';
import type { DrawingToolId } from '../core/types';
import type { DrawingAnchor, DrawingObject } from './types';
import { handlePositions, project } from './geometry';
import type { DrawingManager } from './manager';

type Phase =
  | { type: 'idle' }
  | { type: 'creating'; kind: Exclude<DrawingToolId, 'cursor'>; points: DrawingAnchor[]; required: number }
  | {
      type: 'dragging';
      id: string;
      handle: number;
      startX: number;
      startY: number;
      startPointer: { time: number; price: number };
      before: DrawingAnchor[];
      moved: boolean;
    };

export class DrawingInteractions {
  private mgr: DrawingManager;
  private container: HTMLElement;
  private coords: CoordinateSpace;
  private view: StoreView;
  private phase: Phase = { type: 'idle' };
  private liveAnchor: DrawingAnchor | null = null;
  private disposed = false;

  private onPointerDownCapture = (event: PointerEvent) => {
    if (this.disposed || event.button !== 0) return;
    const { x, y } = this.relative(event);
    const tool = this.mgr.getTool();

    if (tool !== 'cursor') {
      event.stopPropagation();
      event.preventDefault();
      this.beginCreation(tool, x, y);
      return;
    }

    const hit = this.mgr.hitTest(x, y);
    if (hit) {
      event.stopPropagation();
      this.mgr.select(hit.drawing.id);
      const before = this.mgr.capturePoints(hit.drawing.id);
      if (before) {
        this.phase = {
          type: 'dragging',
          id: hit.drawing.id,
          handle: hit.handle,
          startX: x,
          startY: y,
          startPointer: this.screenToAnchorCoords(x, y),
          before,
          moved: false,
        };
        this.container.style.cursor = 'move';
      }
    } else {
      // Fall through: deselect, allow the chart to pan natively.
      this.mgr.select(null);
    }
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.disposed) return;
    const { x, y } = this.relative(event);

    if (this.phase.type === 'creating') {
      this.liveAnchor = this.anchorAt(x, y);
      const preview = [...this.phase.points];
      if (preview.length < this.phase.required && this.liveAnchor) {
        preview.push(this.liveAnchor);
      }
      this.mgr.setPreview(this.phase.kind, preview);
      return;
    }

    if (this.phase.type === 'dragging') {
      const drag = this.phase;
      const moved = drag.moved || Math.hypot(x - drag.startX, y - drag.startY) > 2;
      drag.moved = moved;
      if (!moved) return;
      const pointerAnchor = this.screenToAnchorCoords(x, y);
      const dt = pointerAnchor.time - drag.startPointer.time;
      const dp = pointerAnchor.price - drag.startPointer.price;
      const obj = this.currentDrawing(drag.id);
      if (!obj) return;
      const next = this.applyDrag(obj, drag.handle, drag.before, dt, dp, pointerAnchor);
      this.mgr.applyLivePoints(drag.id, next);
      return;
    }

    // Idle hover: cursor affordance.
    if (this.mgr.getTool() === 'cursor') {
      const hit = this.mgr.hitTest(x, y);
      if (hit) {
        const proj = project(hit.drawing, this.coords);
        const paneRect = this.coords.mainPaneRect();
        const handles =
          proj.complete && paneRect
            ? handlePositions(hit.drawing, proj, paneRect)
            : [];
        this.container.style.cursor =
          hit.handle >= 0 && hit.handle < handles.length ? 'pointer' : 'move';
      } else {
        this.container.style.cursor = '';
      }
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.disposed) return;
    if (this.phase.type === 'dragging') {
      const drag = this.phase;
      if (drag.moved) {
        this.mgr.commitPoints(drag.id, drag.before);
      }
      this.container.style.cursor = '';
      this.phase = { type: 'idle' };
      void event;
    }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.disposed) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (event.key === 'Escape') {
      if (this.phase.type === 'creating') {
        this.phase = { type: 'idle' };
        this.mgr.setPreview(null, []);
      } else {
        this.mgr.select(null);
      }
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.mgr.isSelected()) {
      event.preventDefault();
      const id = this.mgr.isSelected();
      if (id) this.mgr.remove(id);
    }
  };

  constructor(mgr: DrawingManager, container: HTMLElement, coords: CoordinateSpace, view: StoreView) {
    this.mgr = mgr;
    this.container = container;
    this.coords = coords;
    this.view = view;
    container.addEventListener('pointerdown', this.onPointerDownCapture, true);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  dispose(): void {
    this.disposed = true;
    this.container.removeEventListener('pointerdown', this.onPointerDownCapture, true);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // -- helpers ----------------------------------------------------------------

  private relative(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Screen point → time/price anchor (magnet applied). */
  private anchorAt(x: number, y: number): DrawingAnchor | null {
    const time = this.coords.xToTime(x);
    const price = this.coords.yToPrice(y);
    if (time === null || price === null) return null;
    return this.mgr.magnetSnapAnchor(time, price);
  }

  /** Screen point → time/price WITHOUT magnet (raw deltas for dragging). */
  private screenToAnchorCoords(x: number, y: number): { time: number; price: number } {
    const time = this.coords.xToTime(x) ?? 0;
    const price = this.coords.yToPrice(y) ?? 0;
    return { time, price };
  }

  private beginCreation(tool: Exclude<DrawingToolId, 'cursor'>, x: number, y: number): void {
    if (this.phase.type !== 'creating') {
      this.phase = {
        type: 'creating',
        kind: tool,
        points: [],
        required: this.mgr.pointCountFor(tool),
      };
    }
    const anchor = this.anchorAt(x, y);
    if (!anchor) return;
    const creation = this.phase as { type: 'creating'; kind: Exclude<DrawingToolId, 'cursor'>; points: DrawingAnchor[]; required: number };
    creation.points.push(anchor);
    if (creation.points.length >= creation.required) {
      const kind = creation.kind;
      const points = creation.points.slice();
      this.phase = { type: 'idle' };
      this.mgr.commitCreation(kind, points);
      this.container.style.cursor = '';
    } else {
      this.mgr.setPreview(creation.kind, [...creation.points]);
    }
  }

  private currentDrawing(id: string): DrawingObject | null {
    for (const d of this.mgr.list()) {
      if (d.id === id) return d;
    }
    return null;
  }

  private applyDrag(
    obj: DrawingObject,
    handle: number,
    before: DrawingAnchor[],
    dt: number,
    dp: number,
    pointer: { time: number; price: number },
  ): DrawingAnchor[] {
    const next = before.map((p) => ({ ...p }));
    const body = handle < 0;

    if (body) {
      switch (obj.kind) {
        case 'hline':
          next[0] = { time: before[0].time, price: before[0].price + dp };
          break;
        case 'vline':
          next[0] = { time: before[0].time + dt, price: before[0].price };
          break;
        case 'pricerange':
          next[0] = { ...next[0], price: before[0].price + dp };
          next[1] = { ...next[1], price: before[1].price + dp };
          break;
        case 'daterange':
          next[0] = { ...next[0], time: before[0].time + dt };
          next[1] = { ...next[1], time: before[1].time + dt };
          break;
        default:
          for (let i = 0; i < next.length; i++) {
            next[i] = { time: before[i].time + dt, price: before[i].price + dp };
          }
      }
      return next;
    }

    // Handle drag — move a single anchor.
    const i = handle;
    if (i < 0 || i >= next.length) return next;
    switch (obj.kind) {
      case 'hline':
        next[i] = { time: next[i].time, price: pointer.price };
        break;
      case 'vline':
        next[i] = { time: pointer.time, price: next[i].price };
        break;
      case 'pricerange':
        next[i] = { time: next[i].time, price: pointer.price };
        break;
      case 'daterange':
        next[i] = { time: pointer.time, price: next[i].price };
        break;
      default:
        next[i] = {
          time: pointer.time,
          price: pointer.price,
        };
    }
    return next;
  }
}
