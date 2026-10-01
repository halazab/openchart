/**
 * drawing-engine — geometry: projection, hit-testing, handle layout.
 * All math happens in screen space with a fixed tolerance; anchors are
 * projected through the CoordinateSpace on every call (cheap: O(points)).
 */

import { distanceToSegment } from '../core/math';
import type { CoordinateSpace, StoreView } from '../render/coordinate-space';
import type { DrawingKind, DrawingObject } from './types';

export const HIT_TOLERANCE_PX = 7;
export const HANDLE_HIT_PX = 10;

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface Projection {
  pts: ProjectedPoint[];
  /** False when one or more anchors could not be projected. */
  complete: boolean;
}

export interface HitResult {
  drawing: DrawingObject;
  /** Handle index, or -1 for a body hit. */
  handle: number;
}

/** Project all anchors of a drawing to screen space. */
export function project(drawing: DrawingObject, coords: CoordinateSpace): Projection {
  const pts: ProjectedPoint[] = [];
  let complete = true;
  for (const anchor of drawing.points) {
    const x = coords.timeToX(anchor.time);
    const y = coords.priceToY(anchor.price);
    if (x === null || y === null) {
      complete = false;
      break;
    }
    pts.push({ x, y });
  }
  return { pts, complete };
}

/**
 * Points of interest (screen space) exposed as resize handles.
 * hline/vline drag as whole bodies, so they expose one pseudo-handle
 * placed at the middle of the visible line for discoverability.
 */
export function handlePositions(
  drawing: DrawingObject,
  proj: Projection,
  rect: { x: number; y: number; width: number; height: number },
): ProjectedPoint[] {
  const pts = proj.pts;
  switch (drawing.kind) {
    case 'trendline':
    case 'ray':
    case 'channel':
    case 'rectangle':
    case 'fib':
    case 'pricerange':
    case 'daterange':
      return pts;
    case 'hline': {
      if (pts.length === 0) return [];
      return [{ x: rect.x + rect.width / 2, y: pts[0].y }];
    }
    case 'vline': {
      if (pts.length === 0) return [];
      return [{ x: pts[0].x, y: rect.y + rect.height / 2 }];
    }
    default:
      return pts;
  }
}

/** Distance from (x, y) to the drawable body of a projected drawing. */
function bodyDistance(
  drawing: DrawingObject,
  proj: Projection,
  x: number,
  y: number,
  coords: CoordinateSpace,
): number {
  const pts = proj.pts;
  const tol = HIT_TOLERANCE_PX;
  switch (drawing.kind) {
    case 'trendline': {
      return distanceToSegment(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    }
    case 'ray': {
      // Distance to the ray from pts[0] through pts[1] (infinite forward).
      return distanceToRay(x, y, pts[0], pts[1]);
    }
    case 'channel': {
      const d1 = distanceToSegment(x, y, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      const off = offsetVector(pts[0], pts[2]);
      const d2 = distanceToSegment(
        x,
        y,
        pts[0].x + off.x,
        pts[0].y + off.y,
        pts[1].x + off.x,
        pts[1].y + off.y,
      );
      // Also allow grabbing the body between the two lines.
      const dBody = Math.min(
        distanceToSegment(x, y, pts[0].x, pts[0].y, pts[0].x + off.x, pts[0].y + off.y),
        distanceToSegment(x, y, pts[1].x, pts[1].y, pts[1].x + off.x, pts[1].y + off.y),
      );
      return Math.min(d1, d2, dBody + 2);
    }
    case 'hline': {
      return Math.abs(y - pts[0].y);
    }
    case 'vline': {
      return Math.abs(x - pts[0].x);
    }
    case 'rectangle': {
      return distanceToRectEdges(x, y, pts[0], pts[1]);
    }
    case 'pricerange': {
      // Body = horizontal band between the two price lines.
      const top = Math.min(pts[0].y, pts[1].y);
      const bottom = Math.max(pts[0].y, pts[1].y);
      const inBand = y >= top && y <= bottom;
      const edge = Math.min(Math.abs(y - top), Math.abs(y - bottom));
      return inBand ? Math.min(0.5, edge) : edge;
    }
    case 'daterange': {
      const left = Math.min(pts[0].x, pts[1].x);
      const right = Math.max(pts[0].x, pts[1].x);
      const inBand = x >= left && x <= right;
      const edge = Math.min(Math.abs(x - left), Math.abs(x - right));
      return inBand ? Math.min(0.5, edge) : edge;
    }
    case 'fib': {
      // Levels between the anchors along x span.
      const x0 = Math.min(pts[0].x, pts[1].x);
      const x1 = Math.max(pts[0].x, pts[1].x);
      const levels = FIB_LEVELS;
      let best = Infinity;
      for (const level of levels) {
        const price = pts[1].y + (pts[0].y - pts[1].y) * level;
        const withinX = x >= x0 - tol && x <= x1 + tol;
        const d = Math.abs(y - price);
        if (withinX && d < best) best = d;
      }
      return best;
    }
    default:
      void coords;
      return Infinity;
  }
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function distanceToRay(px: number, py: number, a: ProjectedPoint, b: ProjectedPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distanceToSegment(px, py, a.x, a.y, b.x, b.y);
  const t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
  if (t <= 0) return Math.hypot(px - a.x, py - a.y);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function offsetVector(a: ProjectedPoint, c: ProjectedPoint): ProjectedPoint {
  return { x: c.x - a.x, y: c.y - a.y };
}

function distanceToRectEdges(
  x: number,
  y: number,
  p0: ProjectedPoint,
  p1: ProjectedPoint,
): number {
  const left = Math.min(p0.x, p1.x);
  const right = Math.max(p0.x, p1.x);
  const top = Math.min(p0.y, p1.y);
  const bottom = Math.max(p0.y, p1.y);
  if (x >= left && x <= right && y >= top && y <= bottom) {
    // Inside: distance to the nearest edge.
    return Math.min(x - left, right - x, y - top, bottom - y);
  }
  // Outside: clamp to rect and measure.
  const cx = Math.max(left, Math.min(right, x));
  const cy = Math.max(top, Math.min(bottom, y));
  return Math.hypot(x - cx, y - cy);
}

/**
 * Hit-test a drawing. Handles take precedence over the body.
 * `coords`/`view` are reserved for kinds needing data-space checks.
 */
export function hitTestDrawing(
  drawing: DrawingObject,
  coords: CoordinateSpace,
  view: StoreView,
  x: number,
  y: number,
  paneRect: { x: number; y: number; width: number; height: number } | null,
): HitResult | null {
  void view;
  const proj = project(drawing, coords);
  if (!proj.complete) return null;

  // Handles first.
  const handles = handlePositions(drawing, proj, paneRect ?? { x: 0, y: 0, width: 800, height: 400 });
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    if (Math.hypot(x - h.x, y - h.y) <= HANDLE_HIT_PX) {
      return { drawing, handle: i };
    }
  }

  const d = bodyDistance(drawing, proj, x, y, coords);
  if (d <= HIT_TOLERANCE_PX) return { drawing, handle: -1 };
  return null;
}

export { FIB_LEVELS };
export type { DrawingKind };
