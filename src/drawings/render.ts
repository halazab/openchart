/**
 * drawing-engine — canvas rendering.
 *
 * Pure Canvas2D drawing of projected shapes. Receives a projection context;
 * no chart-library types appear here.
 */

import { formatDuration, formatPrice, formatUtcTime } from '../core/math';
import type { CoordinateSpace } from '../render/coordinate-space';
import type { OverlayDrawContext } from '../render/overlay/overlay-canvas';
import { CHART_THEME } from '../render/theme';
import { FIB_LEVELS, handlePositions, project, type Projection } from './geometry';
import { TOOL_POINT_COUNT, type DrawingObject } from './types';

const HANDLE_SIZE = 7;

function applyStroke(ctx: CanvasRenderingContext2D, obj: DrawingObject, selected: boolean): void {
  ctx.strokeStyle = selected ? CHART_THEME.drawingSelected : obj.style.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = obj.style.lineWidth;
  switch (obj.style.lineStyle) {
    case 'dashed':
      ctx.setLineDash([8, 5]);
      break;
    case 'dotted':
      ctx.setLineDash([2, 3]);
      break;
    default:
      ctx.setLineDash([]);
  }
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = CHART_THEME.drawingHandleFill;
  ctx.strokeStyle = CHART_THEME.drawingHandle;
  ctx.lineWidth = 1.5;
  const half = HANDLE_SIZE / 2;
  ctx.beginPath();
  ctx.rect(x - half, y - half, HANDLE_SIZE, HANDLE_SIZE);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawDrawings(
  context: OverlayDrawContext,
  drawings: readonly DrawingObject[],
  selectedId: string | null,
  preview: DrawingObject | null,
  hidden: boolean,
): void {
  if (hidden) return;
  const { ctx, coords } = context;
  const paneRect = coords.mainPaneRect();
  if (!paneRect) return;

  for (const drawing of drawings) {
    const proj = project(drawing, coords);
    if (!proj.complete) continue;
    ctx.save();
    // Clip to main pane.
    ctx.beginPath();
    ctx.rect(paneRect.x, paneRect.y, paneRect.width, paneRect.height);
    ctx.clip();
    drawShape(ctx, drawing, proj, drawing.id === selectedId);
    ctx.restore();
    if (drawing.id === selectedId) {
      for (const h of handlePositions(drawing, proj, paneRect)) {
        drawHandle(ctx, h.x, h.y);
      }
    }
  }

  if (preview) {
    // Only render once the preview has all anchors its shape requires —
    // partial previews (e.g. one trendline point) would index undefined.
    const required = TOOL_POINT_COUNT[preview.kind] ?? 2;
    if (preview.points.length >= required) {
      const proj = project(preview, coords);
      if (proj.complete) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        drawShape(ctx, preview, proj, false);
        ctx.restore();
      }
    }
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  obj: DrawingObject,
  proj: Projection,
  selected: boolean,
): void {
  const pts = proj.pts;
  switch (obj.kind) {
    case 'trendline': {
      applyStroke(ctx, obj, selected);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      break;
    }
    case 'ray': {
      applyStroke(ctx, obj, selected);
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const big = 5000;
      const len = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[0].x + (dx / len) * big, pts[0].y + (dy / len) * big);
      ctx.stroke();
      break;
    }
    case 'channel': {
      applyStroke(ctx, obj, selected);
      const off = { x: pts[2].x - pts[0].x, y: pts[2].y - pts[0].y };
      // Baseline.
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      // Parallel line.
      ctx.beginPath();
      ctx.moveTo(pts[0].x + off.x, pts[0].y + off.y);
      ctx.lineTo(pts[1].x + off.x, pts[1].y + off.y);
      ctx.stroke();
      // Fill between.
      if (obj.style.fill) {
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = obj.style.color;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[1].x + off.x, pts[1].y + off.y);
        ctx.lineTo(pts[0].x + off.x, pts[0].y + off.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'hline': {
      applyStroke(ctx, obj, selected);
      ctx.beginPath();
      ctx.moveTo(0, pts[0].y);
      ctx.lineTo(ctx.canvas.width, pts[0].y);
      ctx.stroke();
      // Price tag.
      drawLabel(ctx, ctx.canvas.width - 4, pts[0].y, formatPrice(obj.points[0].price, 2), obj.style.color);
      break;
    }
    case 'vline': {
      applyStroke(ctx, obj, selected);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, 0);
      ctx.lineTo(pts[0].x, ctx.canvas.height);
      ctx.stroke();
      break;
    }
    case 'rectangle': {
      const left = Math.min(pts[0].x, pts[1].x);
      const right = Math.max(pts[0].x, pts[1].x);
      const top = Math.min(pts[0].y, pts[1].y);
      const bottom = Math.max(pts[0].y, pts[1].y);
      if (obj.style.fill) {
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = obj.style.color;
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.restore();
      }
      applyStroke(ctx, obj, selected);
      ctx.strokeRect(left, top, right - left, bottom - top);
      break;
    }
    case 'pricerange': {
      const y0 = pts[0].y;
      const y1 = pts[1].y;
      const top = Math.min(y0, y1);
      const bottom = Math.max(y0, y1);
      if (obj.style.fill) {
        ctx.save();
        ctx.fillStyle = CHART_THEME.priceRangeFill;
        ctx.fillRect(0, top, ctx.canvas.width, bottom - top);
        ctx.restore();
      }
      applyStroke(ctx, obj, selected);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(ctx.canvas.width, y0);
      ctx.moveTo(0, y1);
      ctx.lineTo(ctx.canvas.width, y1);
      ctx.stroke();
      const p0 = obj.points[0].price;
      const p1 = obj.points[1].price;
      const diff = p1 - p0;
      const pct = p0 !== 0 ? (diff / p0) * 100 : 0;
      const sign = diff >= 0 ? '+' : '';
      const midY = (y0 + y1) / 2;
      drawLabel(
        ctx,
        ctx.canvas.width / 2,
        midY,
        `${sign}${formatPrice(diff, 2)}  (${sign}${pct.toFixed(2)}%)`,
        obj.style.color,
        'center',
      );
      break;
    }
    case 'daterange': {
      const x0 = pts[0].x;
      const x1 = pts[1].x;
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      if (obj.style.fill) {
        ctx.save();
        ctx.fillStyle = CHART_THEME.dateRangeFill;
        ctx.fillRect(left, 0, right - left, ctx.canvas.height);
        ctx.restore();
      }
      applyStroke(ctx, obj, selected);
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, ctx.canvas.height);
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, ctx.canvas.height);
      ctx.stroke();
      const dt = obj.points[1].time - obj.points[0].time;
      drawLabel(
        ctx,
        (x0 + x1) / 2,
        20,
        formatDuration(Math.abs(dt)),
        obj.style.color,
        'center',
      );
      break;
    }
    case 'fib': {
      const p0 = obj.points[0];
      const p1 = obj.points[1];
      const x0 = Math.min(pts[0].x, pts[1].x);
      const x1 = Math.max(pts[0].x, pts[1].x);
      const priceStep = p1.price - p0.price;
      applyStroke(ctx, obj, selected);
      let li = 0;
      for (const level of FIB_LEVELS) {
        const price = p1.price + (p0.price - p1.price) * level;
        const y = proj.pts[1].y + (proj.pts[0].y - proj.pts[1].y) * level;
        ctx.strokeStyle = selected
          ? CHART_THEME.drawingSelected
          : CHART_THEME.fib[li % CHART_THEME.fib.length];
        ctx.setLineDash(level === 0 || level === 1 ? [] : [4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        drawLabel(
          ctx,
          x1 + 4,
          y,
          `${level.toFixed(3)}  ${formatPrice(price, 2)}`,
          ctx.strokeStyle as string,
          'left',
          9,
        );
        li++;
      }
      void priceStep;
      break;
    }
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  align: CanvasTextAlign = 'right',
  fontSize = 10,
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const padding = 3;
  const metrics = ctx.measureText(text);
  const w = metrics.width + padding * 2;
  const h = fontSize + padding * 2;
  let bgX = x;
  if (align === 'right') bgX = x - w + padding;
  else if (align === 'center') bgX = x - w / 2 + padding;
  ctx.fillStyle = 'rgba(17, 20, 26, 0.9)';
  ctx.fillRect(bgX - padding, y - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Snap helper used by interactions for magnet mode. */
export function magnetSnap(
  coords: CoordinateSpace,
  time: number,
  price: number,
  view: { length(): number; indexOfTime(t: number): number; openAt(i: number): number; highAt(i: number): number; lowAt(i: number): number; closeAt(i: number): number },
  tolerancePx = 8,
): { time: number; price: number } {
  const idx = view.indexOfTime(time);
  if (idx < 0 || idx >= view.length()) return { time, price };
  const candidates = [
    view.openAt(idx),
    view.highAt(idx),
    view.lowAt(idx),
    view.closeAt(idx),
  ];
  let best = price;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const y = coords.priceToY(candidate);
    const py = coords.priceToY(price);
    if (y === null || py === null) continue;
    const d = Math.abs(y - py);
    if (d < bestDist && d <= tolerancePx) {
      bestDist = d;
      best = candidate;
    }
  }
  void formatUtcTime;
  return { time, price: best };
}
