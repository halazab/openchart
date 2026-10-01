/**
 * drawing-engine — object model.
 *
 * Drawings are stored in TIME/PRICE space (never pixels), so they survive
 * pan, zoom, timeframe switches and data reloads. Rendering and hit-testing
 * project anchors through the CoordinateSpace abstraction — this package
 * has ZERO imports from any chart library.
 */

import type { DrawingToolId } from '../core/types';

export interface DrawingAnchor {
  time: number; // UTC seconds
  price: number;
}

export type LineStyleKind = 'solid' | 'dashed' | 'dotted';

export interface DrawingStyle {
  color: string;
  lineWidth: number;
  lineStyle: LineStyleKind;
  /** Fill the body (rectangle / price range / date range / fib). */
  fill?: boolean;
}

export type DrawingKind = Exclude<DrawingToolId, 'cursor'>;

/**
 * Anchor semantics per kind:
 *  - trendline: [start, end]
 *  - ray: [origin, second point → direction]
 *  - hline: [point] (price used; time ignored)
 *  - vline: [point] (time used; price ignored)
 *  - rectangle: [corner1, corner2]
 *  - pricerange: [upper, lower] (prices used; times ignored)
 *  - daterange: [start, end] (times used; prices ignored)
 *  - fib: [start, end] — levels span price between the two anchors
 *  - channel: [p1, p2, offsetPoint] — line p1→p2 shifted by p1→p3 vector
 */
export interface DrawingObject {
  id: string;
  symbol: string;
  kind: DrawingKind;
  points: DrawingAnchor[];
  style: DrawingStyle;
  createdAt: number;
  updatedAt: number;
}

/** Number of anchors each tool needs to be complete. */
export const TOOL_POINT_COUNT: Record<DrawingKind, number> = {
  trendline: 2,
  ray: 2,
  hline: 1,
  vline: 1,
  rectangle: 2,
  pricerange: 2,
  daterange: 2,
  fib: 2,
  channel: 3,
};

export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  color: '#e3b341',
  lineWidth: 2,
  lineStyle: 'solid',
  fill: true,
};

// ---------------------------------------------------------------------------
// Serialization (versioned schema — see README "Drawing persistence")
// ---------------------------------------------------------------------------

export interface SerializedDrawing {
  id: string;
  symbol: string;
  kind: DrawingKind;
  points: DrawingAnchor[];
  style: DrawingStyle;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingStoreSchema {
  version: 1;
  drawings: SerializedDrawing[];
}

export function serializeDrawings(drawings: DrawingObject[]): DrawingStoreSchema {
  return {
    version: 1,
    drawings: drawings.map((d) => ({
      id: d.id,
      symbol: d.symbol,
      kind: d.kind,
      points: d.points.map((p) => ({ time: p.time, price: p.price })),
      style: { ...d.style },
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  };
}

export function deserializeDrawings(schema: DrawingStoreSchema): DrawingObject[] {
  if (schema.version !== 1 || !Array.isArray(schema.drawings)) return [];
  return schema.drawings
    .filter((d) => d && typeof d.id === 'string' && Array.isArray(d.points))
    .map((d) => ({
      id: d.id,
      symbol: d.symbol,
      kind: d.kind,
      points: d.points.map((p) => ({ time: Number(p.time), price: Number(p.price) })),
      style: {
        color: d.style?.color ?? DEFAULT_DRAWING_STYLE.color,
        lineWidth: d.style?.lineWidth ?? DEFAULT_DRAWING_STYLE.lineWidth,
        lineStyle: d.style?.lineStyle ?? DEFAULT_DRAWING_STYLE.lineStyle,
        fill: d.style?.fill ?? DEFAULT_DRAWING_STYLE.fill,
      },
      createdAt: d.createdAt ?? Date.now(),
      updatedAt: d.updatedAt ?? Date.now(),
    }));
}
