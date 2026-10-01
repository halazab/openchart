/**
 * chart-renderer — band fill layer.
 *
 * Fills the area between two line plots (Bollinger-style) using cached
 * indicator output + the coordinate space. Rendered on the overlay canvas,
 * beneath drawings.
 */

import type { OverlayDrawContext, OverlayLayer } from './overlay-canvas';

export interface BandFillSpec {
  upper: Float64Array;
  lower: Float64Array;
  color: string;
}

export class BandFillLayer implements OverlayLayer {
  readonly id = 'band-fill';
  readonly z = 1; // above session shading, below volume profile / drawings
  private getFills: () => BandFillSpec[];

  constructor(getFills: () => BandFillSpec[]) {
    this.getFills = getFills;
  }

  draw(context: OverlayDrawContext): void {
    const fills = this.getFills();
    if (fills.length === 0) return;
    const { ctx, coords, view } = context;
    const rect = coords.mainPaneRect();
    if (!rect) return;
    const n = view.length();
    if (n === 0) return;

    const leftTime = coords.xToTime(rect.x);
    const rightTime = coords.xToTime(rect.x + rect.width);
    if (leftTime === null || rightTime === null) return;
    const from = Math.max(0, view.indexOfTime(leftTime) - 1);
    const to = Math.min(n - 1, view.indexOfTime(rightTime) + 1);
    if (to <= from) return;

    for (const fill of fills) {
      if (fill.upper.length < n || fill.lower.length < n) continue;
      ctx.beginPath();
      let started = false;
      // Upper curve, left → right.
      for (let i = from; i <= to; i++) {
        const v = fill.upper[i];
        if (Number.isNaN(v)) continue;
        const x = coords.timeToX(view.timeAt(i));
        const y = coords.priceToY(v);
        if (x === null || y === null) continue;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      // Lower curve, right → left.
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = to; i >= from; i--) {
        const v = fill.lower[i];
        if (Number.isNaN(v)) continue;
        const x = coords.timeToX(view.timeAt(i));
        const y = coords.priceToY(v);
        if (x === null || y === null) continue;
        xs.push(x);
        ys.push(y);
      }
      for (let k = 0; k < xs.length; k++) ctx.lineTo(xs[k], ys[k]);
      ctx.closePath();
      ctx.fillStyle = fill.color;
      ctx.fill();
    }
  }
}
