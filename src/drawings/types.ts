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
 *  - extended-line: [two points → infinite in both directions]
 *  - arrow: [start, end] (arrowhead at end)
 *  - horizontal-ray: [origin] (extends right from origin)
 *  - hline: [point] (price used; time ignored)
 *  - vline: [point] (time used; price ignored)
 *  - cross-line: [point] (vertical + horizontal through the point)
 *  - rectangle: [corner1, corner2]
 *  - triangle: [p1, p2, p3]
 *  - ellipse: [corner1, corner2] of the bounding box
 *  - pricerange: [upper, lower] (prices used; times ignored)
 *  - daterange: [start, end] (times used; prices ignored)
 *  - fib: [start, end] — levels span price between the two anchors
 *  - pitchfork: [pivot, prongA, prongB] — median from pivot through midpoint
 *  - channel: [p1, p2, offsetPoint] — line p1→p2 shifted by p1→p3 vector
 *  - long/short-position: [entry(left edge), stop(right edge), target(right edge)]
 *  - text: [point] (anchor; text stored in `text`)
 */
export interface DrawingObject {
  id: string;
  symbol: string;
  kind: DrawingKind;
  points: DrawingAnchor[];
  style: DrawingStyle;
  /** Text content (text tool only). */
  text?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Number of anchors each tool needs to be complete.
 * Position tools commit from 2 clicks but expand to 3 anchors
 * ([entry, stop, target] — see normalizePoints).
 */
export const TOOL_POINT_COUNT: Record<DrawingKind, number> = {
  trendline: 2,
  ray: 2,
  'extended-line': 2,
  arrow: 2,
  'horizontal-ray': 1,
  hline: 1,
  vline: 1,
  'cross-line': 1,
  rectangle: 2,
  triangle: 3,
  ellipse: 2,
  pricerange: 2,
  daterange: 2,
  fib: 2,
  pitchfork: 3,
  channel: 3,
  'long-position': 2,
  'short-position': 2,
  text: 1,
};

/** Anchor semantics for the position kinds (after normalization). */
export type PositionKind = 'long-position' | 'short-position';

export const POSITION_KINDS: readonly PositionKind[] = ['long-position', 'short-position'];

export function isPositionKind(kind: DrawingKind): kind is PositionKind {
  return kind === 'long-position' || kind === 'short-position';
}

/** Default risk/reward sizing, matching TradingView's 1% risk / 2% reward. */
export const POSITION_DEFAULT_STOP_PCT = 0.01;
export const POSITION_DEFAULT_TARGET_PCT = 0.02;
/** Default plan width when the second click does not extend forward. */
export const POSITION_DEFAULT_WIDTH_BARS = 25;

/**
 * Expand a 2-click position placement into the full 3-anchor model:
 *  [0] entry  — left edge, entry price
 *  [1] stop   — right edge, stop price
 *  [2] target — right edge, target price
 * `barSpacingSec` derives the default width when the second click does not
 * extend to the right of the entry.
 */
export function expandPositionPoints(
  kind: PositionKind,
  points: DrawingAnchor[],
  barSpacingSec: number,
): DrawingAnchor[] {
  const entry = points[0];
  const second = points[1] ?? entry;
  const rightTime =
    second.time > entry.time
      ? second.time
      : entry.time + POSITION_DEFAULT_WIDTH_BARS * Math.max(barSpacingSec, 60);
  const dir = kind === 'long-position' ? 1 : -1;
  const stop = entry.price * (1 - dir * POSITION_DEFAULT_STOP_PCT);
  const target = entry.price * (1 + dir * POSITION_DEFAULT_TARGET_PCT);
  return [
    { time: entry.time, price: entry.price },
    { time: rightTime, price: stop },
    { time: rightTime, price: target },
  ];
}

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
  text?: string;
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
      text: d.text,
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
      text: typeof d.text === 'string' ? d.text : undefined,
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
