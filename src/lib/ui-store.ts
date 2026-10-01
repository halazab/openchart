/**
 * UI-level state (low-frequency only).
 *
 * High-frequency streams (ticks, quotes, crosshair) intentionally do NOT
 * flow through React — they are applied imperatively by the engine's
 * controllers. This store holds dialogs, active tool, and settings mirrors.
 */

import { create } from 'zustand';
import type { ChartType, ConnectionStatus, DrawingToolId, ScaleMode, Timeframe } from '@/core/types';
import type { SymbolInfo } from '@/provider-sdk/types';

export interface UiState {
  providerId: string;
  symbol: string;
  symbolInfo: SymbolInfo | null;
  timeframe: Timeframe;
  chartType: ChartType;
  scaleMode: ScaleMode;
  status: ConnectionStatus;
  loading: boolean;
  watchlist: string[];
  activeTool: DrawingToolId;
  selectedDrawingId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Mirror of engine display settings used by toolbar toggles. */
  settingsChanged: { magnet: boolean; hidden: boolean; extendedHours: boolean; sessionBreaks: boolean } | null;

  symbolSearchOpen: boolean;
  indicatorsOpen: boolean;
  settingsOpen: boolean;
  watchlistOpen: boolean;

  setProviderId: (id: string) => void;
  setSymbol: (symbol: string, info: SymbolInfo | null) => void;
  setTimeframe: (tf: Timeframe) => void;
  setChartType: (t: ChartType) => void;
  setScaleMode: (m: ScaleMode) => void;
  setStatus: (s: ConnectionStatus) => void;
  setLoading: (l: boolean) => void;
  setWatchlist: (symbols: string[]) => void;
  setActiveTool: (t: DrawingToolId) => void;
  setSelectedDrawing: (id: string | null) => void;
  setHistoryFlags: (canUndo: boolean, canRedo: boolean) => void;
  setSettingsChanged: (v: { magnet: boolean; hidden: boolean; extendedHours: boolean; sessionBreaks: boolean }) => void;
  setSymbolSearchOpen: (open: boolean) => void;
  setIndicatorsOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setWatchlistOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  providerId: 'synthetic',
  symbol: 'BTCUSD',
  symbolInfo: null,
  timeframe: '1m',
  chartType: 'candles',
  scaleMode: 'normal',
  status: 'idle',
  loading: true,
  watchlist: [],
  activeTool: 'cursor',
  selectedDrawingId: null,
  canUndo: false,
  canRedo: false,
  settingsChanged: null,

  symbolSearchOpen: false,
  indicatorsOpen: false,
  settingsOpen: false,
  watchlistOpen: true,

  setProviderId: (providerId) => set({ providerId }),
  setSymbol: (symbol, symbolInfo) => set({ symbol, symbolInfo }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setChartType: (chartType) => set({ chartType }),
  setScaleMode: (scaleMode) => set({ scaleMode }),
  setStatus: (status) => set({ status }),
  setLoading: (loading) => set({ loading }),
  setWatchlist: (watchlist) => set({ watchlist }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setSelectedDrawing: (selectedDrawingId) => set({ selectedDrawingId }),
  setHistoryFlags: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setSettingsChanged: (settingsChanged) => set({ settingsChanged }),
  setSymbolSearchOpen: (symbolSearchOpen) => set({ symbolSearchOpen }),
  setIndicatorsOpen: (indicatorsOpen) => set({ indicatorsOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setWatchlistOpen: (watchlistOpen) => set({ watchlistOpen }),
}));
