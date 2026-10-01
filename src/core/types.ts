/**
 * chart-core — shared kernel types.
 *
 * This module is intentionally dependency-free: every other engine package
 * (data, indicators, drawings, renderer, ui) may import from it, it imports
 * from none of them.
 */

/** Supported bar intervals. Values are provider-agnostic. */
export type Timeframe =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '1d'
  | '1w';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

export const TIMEFRAMES: Timeframe[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '1d',
  '1w',
];

/** Rendering style of the main price series. */
export type ChartType = 'candles' | 'bars' | 'line' | 'area' | 'heikin-ashi';

export type ScaleMode = 'normal' | 'logarithmic' | 'percentage';

/**
 * How sessions are modelled for a symbol.
 * - `equity`     — bounded trading sessions (regular / pre / post), gaps between.
 * - `continuous` — 24/7 trading (crypto-style), no session boundaries.
 */
export type SessionModel = 'equity' | 'continuous';

/** Connection lifecycle of a realtime provider. */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/** Tool id for the drawing toolbar. `cursor` means "select/pan" mode. */
export type DrawingToolId =
  | 'cursor'
  | 'trendline'
  | 'ray'
  | 'hline'
  | 'vline'
  | 'rectangle'
  | 'pricerange'
  | 'daterange'
  | 'fib'
  | 'channel';

/** Monotonic engine event names used by `TypedEmitter`. */
import type { SymbolInfo, Quote } from '../provider-sdk/types';

/** Type alias (not interface) so it satisfies TypedEmitter's constraint. */
export type EngineEvents = {
  /** Fired once data for symbol/timeframe finished (re)loading. */
  'data-loaded': { symbol: string; timeframe: Timeframe; bars: number };
  /** Fired when a historical page was prepended. */
  'history-paged': { bars: number };
  /** Loading state for symbol/TF switches and pagination. */
  'loading-changed': { loading: boolean; reason: 'symbol' | 'timeframe' | 'history' | 'provider' };
  /** Provider connection status changed. */
  'status-changed': { status: ConnectionStatus; providerId: string };
  /** High-level error surfaced to the UI (toasts). */
  'error': { message: string };
  /** Symbol changed (drawings restored, legends refreshed). */
  'symbol-changed': { symbol: string; info: SymbolInfo };
  /** Timeframe changed. */
  'timeframe-changed': { timeframe: Timeframe };
  /** Chart type changed. */
  'chart-type-changed': { type: ChartType };
  /** Scale settings changed. */
  'scale-changed': { mode: ScaleMode; leftScaleVisible: boolean };
  /** Display settings changed. */
  'settings-changed': { key: string; value: boolean | number };
  /** Active drawing tool changed. */
  'tool-changed': { tool: DrawingToolId };
  /** Drawings mutated (add/remove/update/undo/redo). */
  'drawings-changed': { source: string };
  /** Selection state of a drawing changed. */
  'selection-changed': { drawingId: string | null };
  /** Indicator instances changed. */
  'indicators-changed': { reason: 'add' | 'remove' | 'toggle' };
  /** Watchlist quote snapshot (throttled by the batching layer). */
  'quotes': { updates: Quote[] };
  /** Perf stats, emitted ~2×/second (status bar). */
  'stats': { fps: number; ticksPerSec: number; bars: number; hasMoreHistory: boolean };
  /** Bar replay state changed (enter/exit/step/play/speed). */
  'replay-changed': { active: boolean; index: number; total: number; playing: boolean; speed: number };
}

export type DisplaySettingKey =
  | 'grid'
  | 'sessionBreaks'
  | 'extendedHours'
  | 'volume'
  | 'magnet'
  | 'hideDrawings'
  | 'leftScale'
  | 'crosshairOhlc';

/** Misc engine settings. */
export interface DisplaySettings {
  grid: boolean;
  sessionBreaks: boolean;
  extendedHours: boolean;
  volume: boolean;
  magnet: boolean;
  hideDrawings: boolean;
  leftScale: boolean;
  crosshairOhlc: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  grid: true,
  sessionBreaks: true,
  extendedHours: true,
  volume: true,
  magnet: false,
  hideDrawings: false,
  leftScale: false,
  crosshairOhlc: true,
};
