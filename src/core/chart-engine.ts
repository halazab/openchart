/**
 * chart-core — ChartEngine: the composition root and public facade.
 *
 * Wires the renderer, data engine, indicator engine, drawing engine and the
 * pluggable market-data provider into a single lifecycle. The UI layer talks
 * ONLY to this class (plus its sub-controllers where needed).
 *
 * Framework-agnostic: no React/DOM-framework imports (plain DOM only).
 */

import type { LogicalRange } from 'lightweight-charts';

import {
  TypedEmitter,
} from './events';
import {
  DEFAULT_DISPLAY_SETTINGS,
  TIMEFRAME_SECONDS,
  type ChartType,
  type ConnectionStatus,
  type DisplaySettings,
  type DisplaySettingKey,
  type DrawingToolId,
  type EngineEvents,
  type ScaleMode,
  type Timeframe,
} from './types';

import type { MarketDataProvider, SymbolInfo } from '../provider-sdk/types';
import { BatchingIngestor, TradeAggregator } from '../provider-sdk/batching';

import { BarStore } from '../data/bar-store';

import { LwcChartAdapter, type CrosshairParam } from '../render/lwc-adapter';
import { OverlayCanvas } from '../render/overlay/overlay-canvas';
import { SessionBreaksLayer } from '../render/overlay/session-layer';
import { VolumeProfileLayer } from '../render/overlay/volume-profile-layer';
import { BandFillLayer, type BandFillSpec } from '../render/overlay/band-fill-layer';
import { LegendController } from '../render/legend-controller';

import { IndicatorEngine } from '../indicators/engine';
import { IndicatorScheduler } from '../indicators/scheduler';

import { DrawingManager } from '../drawings/manager';

import { formatUtcTime } from './math';

const INITIAL_BARS = 3000;
const PAGE_BARS = 5000;
const PAGINATION_EDGE = 60;
const VP_RECOMPUTE_DEBOUNCE_MS = 120;
const STATS_INTERVAL_MS = 500;

export interface ChartEngineOptions {
  container: HTMLElement;
  provider: MarketDataProvider;
  symbol?: string;
  timeframe?: Timeframe;
  chartType?: ChartType;
}

export class ChartEngine {
  readonly events = new TypedEmitter<EngineEvents>();
  readonly store = new BarStore();

  private container: HTMLElement;
  private provider: MarketDataProvider;
  private adapter: LwcChartAdapter | null = null;
  private overlay: OverlayCanvas | null = null;
  private sessionLayer: SessionBreaksLayer | null = null;
  private vpLayer: VolumeProfileLayer | null = null;
  private bandFillLayer: BandFillLayer | null = null;
  private legend: LegendController | null = null;
  private drawings: DrawingManager | null = null;
  private indicators: IndicatorEngine | null = null;
  private scheduler = new IndicatorScheduler();
  private ingestor = new BatchingIngestor({ flushIntervalMs: 50 });

  private symbol = 'BTCUSD';
  private symbolInfo: SymbolInfo | null = null;
  private timeframe: Timeframe = '1m';
  private chartType: ChartType = 'candles';
  private scaleMode: ScaleMode = 'normal';
  private settings: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
  private watchlist: string[] = [];

  private hasMoreHistory = false;
  private loadingHistory = false;
  private loadSeq = 0;
  private realtimeUnsubs: Array<() => void> = [];
  private aggregator: TradeAggregator | null = null;
  private lastRealtimeBar: number | null = null;

  private vpDebounce: ReturnType<typeof setTimeout> | null = null;
  private indicatorRecomputeDebounce: ReturnType<typeof setTimeout> | null = null;

  // Perf counters.
  private frameCount = 0;
  private tickCount = 0;
  private fps = 0;
  private ticksPerSec = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  private mounted = false;

  constructor(options: ChartEngineOptions) {
    this.container = options.container;
    this.provider = options.provider;
    if (options.symbol) this.symbol = options.symbol;
    if (options.timeframe) this.timeframe = options.timeframe;
    if (options.chartType) this.chartType = options.chartType;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async mount(): Promise<void> {
    if (this.mounted) return;
    this.mounted = true;

    this.adapter = new LwcChartAdapter(this.container, this.store, {
      onVisibleRangeChange: (range) => this.handleVisibleRangeChange(range),
    });
    this.overlay = new OverlayCanvas(
      this.container,
      this.adapter.coordinateSpace(),
      this.adapter.view,
    );

    this.sessionLayer = new SessionBreaksLayer();
    this.bandFillLayer = new BandFillLayer(() => this.collectBandFills());
    this.vpLayer = new VolumeProfileLayer(() =>
      this.indicators?.getVolumeProfileResult() ?? null,
    );
    this.overlay.addLayer(this.bandFillLayer);
    this.overlay.addLayer(this.sessionLayer);
    this.overlay.addLayer(this.vpLayer);

    this.drawings = new DrawingManager({
      coords: this.adapter.coordinateSpace(),
      view: this.adapter.view,
      container: this.container,
      markDirty: () => this.overlay?.markDirty(),
      onSelectionChanged: (id) =>
        this.events.emit('selection-changed', { drawingId: id }),
      onToolChanged: (tool) => this.events.emit('tool-changed', { tool }),
      onHistoryChanged: () => this.events.emit('drawings-changed', { source: 'history' }),
      onDrawingsChanged: () => this.events.emit('drawings-changed', { source: 'change' }),
    });
    // Register drawings as the top overlay layer.
    this.overlay.addLayer({
      id: this.drawings.id,
      z: this.drawings.z,
      draw: (ctx) => this.drawings?.draw(ctx),
    });

    this.indicators = new IndicatorEngine({
      scheduler: this.scheduler,
      host: this.adapter,
      getInput: () => ({
        times: this.store.times(),
        open: this.store.open(),
        high: this.store.high(),
        low: this.store.low(),
        close: this.store.close(),
        volume: this.store.volume(),
        flags: this.store.flags(),
        length: this.store.length,
      }),
      timeAt: (i) => this.store.timeAt(i),
      barCount: () => this.store.length,
      getVisibleRange: () => this.adapter?.getVisibleRange() ?? { start: 0, end: 0 },
      onOverlayResult: () => this.overlay?.markDirty(),
    });
    this.indicators.onChange = (reason) => {
      this.events.emit('indicators-changed', { reason });
      this.legend?.rebuildIndicatorChips();
      this.vpLayer?.setEnabled(this.indicators?.isOverlayActive() ?? false);
      this.overlay?.markDirty();
    };

    this.legend = new LegendController(this.adapter, this.store, () => this.indicators ?? null);
    this.legend.setDisplay(this.chartType, this.timeframe);

    this.ingestor.setConsumer((batch) => this.handleBatch(batch));
    this.applyDisplaySettings();

    // Provider status.
    this.provider.onStatus((status) =>
      this.events.emit('status-changed', { status, providerId: this.provider.id }),
    );

    this.startPerfLoop();
    // Dev/debug hook (harmless in production, invaluable for diagnostics).
    (globalThis as Record<string, unknown>).__openchart = this;
    await this.setProvider(this.provider);
    await this.load();
  }

  destroy(): void {
    this.mounted = false;
    this.clearRealtime();
    this.ingestor.dispose();
    this.scheduler.dispose();
    this.stopPerfLoop();
    this.drawings?.dispose();
    this.indicators?.dispose();
    this.legend?.dispose();
    this.overlay?.dispose();
    this.adapter?.destroy();
    this.adapter = null;
    this.overlay = null;
    this.legend = null;
    this.drawings = null;
    this.indicators = null;
  }

  // -------------------------------------------------------------------------
  // Public facade
  // -------------------------------------------------------------------------

  getSymbol(): string {
    return this.symbol;
  }

  getSymbolInfo(): SymbolInfo | null {
    return this.symbolInfo;
  }

  getTimeframe(): Timeframe {
    return this.timeframe;
  }

  getChartType(): ChartType {
    return this.chartType;
  }

  getScaleMode(): ScaleMode {
    return this.scaleMode;
  }

  getSettings(): DisplaySettings {
    return { ...this.settings };
  }

  getProviderId(): string {
    return this.provider.id;
  }

  getWatchlist(): string[] {
    return this.watchlist.slice();
  }

  getIndicatorEngine(): IndicatorEngine | null {
    return this.indicators;
  }

  getDrawingManager(): DrawingManager | null {
    return this.drawings;
  }

  getAdapter(): LwcChartAdapter | null {
    return this.adapter;
  }

  async searchSymbols(query: string, limit = 20): Promise<SymbolInfo[]> {
    return this.provider.searchSymbols(query, limit);
  }

  async setProvider(provider: MarketDataProvider): Promise<void> {
    this.clearRealtime();
    this.provider = provider;
    this.provider.onStatus((status) =>
      this.events.emit('status-changed', { status, providerId: provider.id }),
    );
    await provider.connect?.();
    this.events.emit('status-changed', { status: provider.status(), providerId: provider.id });
    if (this.mounted) await this.load();
  }

  async setSymbol(symbol: string): Promise<void> {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    await this.load('symbol');
  }

  async setTimeframe(timeframe: Timeframe): Promise<void> {
    if (timeframe === this.timeframe) return;
    this.timeframe = timeframe;
    await this.load('timeframe');
  }

  setChartType(type: ChartType): void {
    if (type === this.chartType) return;
    this.chartType = type;
    const range = this.adapter?.getVisibleLogicalRange() ?? null;
    this.adapter?.setChartType(type);
    if (range) this.adapter?.setVisibleLogicalRange(range);
    this.legend?.setDisplay(type, this.timeframe);
    this.events.emit('chart-type-changed', { type });
    this.overlay?.markDirty();
  }

  setScaleMode(mode: ScaleMode): void {
    if (mode === this.scaleMode) return;
    this.scaleMode = mode;
    this.adapter?.setScaleMode(mode);
    this.events.emit('scale-changed', { mode, leftScaleVisible: this.settings.leftScale });
  }

  setSetting(key: DisplaySettingKey, value: boolean | number): void {
    this.settings = { ...this.settings, [key]: value as never };
    this.applyDisplaySettings();
    this.events.emit('settings-changed', { key, value });
    if (key === 'extendedHours') {
      void this.load('symbol');
    }
  }

  setWatchlist(symbols: string[]): void {
    this.watchlist = symbols.slice();
    this.subscribeQuotes();
  }

  setActiveTool(tool: DrawingToolId): void {
    this.drawings?.setTool(tool);
  }

  getActiveTool(): DrawingToolId {
    return this.drawings?.getTool() ?? 'cursor';
  }

  undo(): void {
    this.drawings?.undo();
  }

  redo(): void {
    this.drawings?.redo();
  }

  resetView(): void {
    const n = this.store.length;
    this.adapter?.setVisibleLogicalRange({ from: Math.max(0, n - 180), to: n + 10 });
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  private async load(reason: 'symbol' | 'timeframe' | 'provider' = 'symbol'): Promise<void> {
    const seq = ++this.loadSeq;
    this.clearRealtime();
    this.events.emit('loading-changed', { loading: true, reason });
    try {
      await this.provider.connect?.();
      this.symbolInfo = await this.provider.getSymbol(this.symbol);
      if (seq !== this.loadSeq) return;

      const page = await this.provider.history().fetchBars({
        symbol: this.symbol,
        timeframe: this.timeframe,
        limit: INITIAL_BARS,
      });
      if (seq !== this.loadSeq) return;

      const bars = this.filterExtended(
        ChartEngine.normalizeAscending(page.bars),
      );
      this.hasMoreHistory = page.hasMore;
      this.store.reset(bars);
      this.lastRealtimeBar = bars.length > 0 ? bars[bars.length - 1].time : null;

      this.adapter?.setSymbolMeta({
        pricePrecision: this.symbolInfo.pricePrecision,
        minMove: this.symbolInfo.minMove,
      });
      if (this.adapter) {
        const type = this.chartType;
        this.adapter.setChartType(type); // recreates main+volume and sets full data
        const n = this.store.length;
        this.adapter.setVisibleLogicalRange({ from: Math.max(0, n - 180), to: n + 10 });
      }

      this.drawings?.setSymbol(this.symbol);
      this.legend?.setSymbolInfo(this.symbolInfo);
      this.legend?.setDisplay(this.chartType, this.timeframe);
      this.legend?.renderValues(null);

      this.setupAggregator();
      await this.indicators?.recomputeAll();
      this.overlay?.notifyVisibleRangeChanged();
      this.subscribeRealtime();
      this.subscribeQuotes();

      this.events.emit('symbol-changed', { symbol: this.symbol, info: this.symbolInfo });
      this.events.emit('timeframe-changed', { timeframe: this.timeframe });
      this.events.emit('data-loaded', {
        symbol: this.symbol,
        timeframe: this.timeframe,
        bars: this.store.length,
      });
    } catch (err) {
      console.error('[engine] load failed', err);
      this.events.emit('error', {
        message: err instanceof Error ? err.message : 'Failed to load market data',
      });
    } finally {
      if (seq === this.loadSeq) {
        this.events.emit('loading-changed', { loading: false, reason });
      }
    }
  }

  private filterExtended(bars: import('../provider-sdk/types').Bar[]): import('../provider-sdk/types').Bar[] {
    if (this.settings.extendedHours) return bars;
    // Keep regular-session bars only; preserve sessionStart flags.
    return bars.filter((b) => !b.extended);
  }

  /**
   * Defensive normalization: a provider returning unsorted/duplicated data
   * must never corrupt the chart. Sorts ascending by time and dedupes.
   */
  private static normalizeAscending(bars: import('../provider-sdk/types').Bar[]): import('../provider-sdk/types').Bar[] {
    if (bars.length < 2) return bars;
    let sorted = true;
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].time <= bars[i - 1].time) {
        sorted = false;
        break;
      }
    }
    if (sorted) return bars;
    const copy = bars.slice().sort((a, b) => a.time - b.time);
    const out: import('../provider-sdk/types').Bar[] = [copy[0]];
    for (let i = 1; i < copy.length; i++) {
      if (copy[i].time > out[out.length - 1].time) out.push(copy[i]);
      else out[out.length - 1] = copy[i]; // dedupe: keep latest write
    }
    return out;
  }

  private setupAggregator(): void {
    if (this.provider.trades()) {
      this.aggregator = new TradeAggregator({
        timeframeSeconds: TIMEFRAME_SECONDS[this.timeframe],
      });
      const last = this.store.lastBar();
      if (last) this.aggregator.seed(last);
    } else {
      this.aggregator = null;
    }
  }

  // -------------------------------------------------------------------------
  // Realtime wiring
  // -------------------------------------------------------------------------

  private clearRealtime(): void {
    for (const unsub of this.realtimeUnsubs) {
      try {
        unsub();
      } catch {
        /* provider may already be torn down */
      }
    }
    this.realtimeUnsubs = [];
  }

  private subscribeRealtime(): void {
    this.clearRealtime();
    const symbol = this.symbol;
    const tf = this.timeframe;

    const barsProvider = this.provider.bars();
    if (barsProvider) {
      this.realtimeUnsubs.push(
        barsProvider.subscribeBars(symbol, tf, (bar) => this.ingestor.pushBar(bar, tf)),
      );
    }
    const tradesProvider = this.provider.trades();
    if (tradesProvider) {
      this.realtimeUnsubs.push(
        tradesProvider.subscribeTrades(symbol, (trade) => this.ingestor.pushTrade(trade)),
      );
    }
  }

  private quotesUnsub: (() => void) | null = null;

  private subscribeQuotes(): void {
    this.quotesUnsub?.();
    this.quotesUnsub = null;
    const quotesProvider = this.provider.quotes();
    if (!quotesProvider) return;
    const symbols = Array.from(new Set([this.symbol, ...this.watchlist]));
    this.quotesUnsub = quotesProvider.subscribeQuotes(symbols, (quote) => {
      this.ingestor.pushQuote(quote);
    });
    this.realtimeUnsubs.push(() => {
      this.quotesUnsub?.();
      this.quotesUnsub = null;
    });
  }

  private handleBatch(batch: import('../provider-sdk/types').MarketBatch): void {
    if (!this.mounted) return;
    let touched = false;
    this.tickCount += batch.trades.length + batch.barUpdates.length;

    // Trades → aggregator → bars (provider without native bar stream).
    if (batch.trades.length > 0 && this.aggregator) {
      const { closed, current, isNewBucket } = this.aggregator.apply(batch.trades);
      for (const bar of closed) {
        if (this.store.appendOrUpdate(bar) !== 'ignored') touched = true;
      }
      if (current) {
        const action = this.store.appendOrUpdate(current);
        if (action !== 'ignored') {
          touched = true;
          this.adapter?.updateLastBar(this.store.barAt(this.store.length - 1) ?? current);
        }
      }
      if (isNewBucket) this.onNewBar();
    }

    // Native bar stream.
    for (const update of batch.barUpdates) {
      if (update.timeframe !== this.timeframe) continue;
      const action = this.store.appendOrUpdate(update.bar);
      if (action !== 'ignored') {
        touched = true;
        this.adapter?.updateLastBar(update.bar);
      }
      if (update.isNew || action === 'appended') this.onNewBar();
    }

    if (touched) {
      this.lastRealtimeBar = this.store.lastTime();
      this.indicators?.onRealtimeUpdate();
      this.legend?.renderValues(null);
      this.overlay?.notifyBarUpdate();
    }

    if (batch.quotes.length > 0) {
      this.events.emit('quotes', { updates: batch.quotes });
    }
  }

  /** Called when a bar rollover happens (new bucket). */
  private onNewBar(): void {
    this.scheduleVpRecompute(0);
  }

  // -------------------------------------------------------------------------
  // Pagination + overlay reactions
  // -------------------------------------------------------------------------

  private handleVisibleRangeChange(range: LogicalRange | null): void {
    this.overlay?.notifyVisibleRangeChanged();
    if (!range || !this.mounted) return;
    this.scheduleVpRecompute(VP_RECOMPUTE_DEBOUNCE_MS);

    const nearEdge =
      range.from <= PAGINATION_EDGE && this.store.length > 0;
    if (nearEdge && this.hasMoreHistory && !this.loadingHistory && !this.isLoading) {
      void this.loadOlderPage();
    }
  }

  private isLoading = false;

  private async loadOlderPage(): Promise<void> {
    if (this.loadingHistory || this.store.isEmpty) return;
    this.loadingHistory = true;
    const seq = this.loadSeq;
    try {
      const firstTime = this.store.firstTime();
      const page = await this.provider.history().fetchBars({
        symbol: this.symbol,
        timeframe: this.timeframe,
        end: firstTime,
        limit: PAGE_BARS,
      });
      if (seq !== this.loadSeq || page.bars.length === 0) {
        this.hasMoreHistory = page.hasMore;
        return;
      }
      const bars = this.filterExtended(
        ChartEngine.normalizeAscending(page.bars),
      );
      const range = this.adapter?.getVisibleLogicalRange() ?? null;
      const prevLength = this.store.length;
      this.store.prepend(bars);
      this.hasMoreHistory = page.hasMore;
      this.adapter?.applyFullData();
      if (range) {
        const delta = this.store.length - prevLength;
        this.adapter?.setVisibleLogicalRange({
          from: range.from + delta,
          to: range.to + delta,
        });
      }
      this.scheduleIndicatorRecompute();
      this.events.emit('history-paged', { bars: this.store.length });
    } catch (err) {
      console.error('[engine] history page failed', err);
    } finally {
      this.loadingHistory = false;
    }
  }

  private scheduleIndicatorRecompute(): void {
    if (this.indicatorRecomputeDebounce) clearTimeout(this.indicatorRecomputeDebounce);
    this.indicatorRecomputeDebounce = setTimeout(() => {
      this.indicatorRecomputeDebounce = null;
      void this.indicators?.recomputeAll();
    }, 150);
  }

  private scheduleVpRecompute(delay: number): void {
    if (this.vpDebounce) clearTimeout(this.vpDebounce);
    this.vpDebounce = setTimeout(() => {
      this.vpDebounce = null;
      this.indicators?.recomputeVolumeProfile();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Settings application
  // -------------------------------------------------------------------------

  private applyDisplaySettings(): void {
    this.adapter?.setGridVisible(this.settings.grid);
    this.adapter?.setLeftScale(this.settings.leftScale);
    this.adapter?.setCrosshairMode(this.settings.magnet);
    this.sessionLayer?.setEnabled(this.settings.sessionBreaks);
    this.vpLayer?.setEnabled(this.indicators?.isOverlayActive() ?? false);
    this.drawings?.setMagnet(this.settings.magnet);
    this.drawings?.setHidden(this.settings.hideDrawings);
    this.legend?.setShowOhlc(this.settings.crosshairOhlc);
    if (this.settings.volume !== undefined) {
      // Volume visibility applied without a full reload when possible.
      if (this.adapter && this.store.length > 0) {
        // Only rebuild when the state actually changed.
        if (this.volumeApplied !== this.settings.volume) {
          this.volumeApplied = this.settings.volume;
          this.adapter.setVolumeVisible(this.settings.volume);
        }
      }
    }
    this.overlay?.markDirty();
  }

  private volumeApplied: boolean | null = null;

  private collectBandFills(): BandFillSpec[] {
    const engine = this.indicators;
    const adapter = this.adapter;
    if (!engine || !adapter) return [];
    const out: BandFillSpec[] = [];
    for (const instance of engine.listInstances()) {
      if (!instance.visible) continue;
      const def = engine.getDefinition(instance.definitionId);
      if (!def?.bandFill) continue;
      const upper = instance.lastPlots.get(def.bandFill.upper);
      const lower = instance.lastPlots.get(def.bandFill.lower);
      if (upper && lower) {
        out.push({ upper, lower, color: def.bandFill.color });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Perf loop (fps + tick rate)
  // -------------------------------------------------------------------------

  private startPerfLoop(): void {
    const loop = () => {
      this.frameCount++;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
    this.statsTimer = setInterval(() => {
      this.fps = Math.round((this.frameCount * 1000) / STATS_INTERVAL_MS);
      this.ticksPerSec = Math.round((this.tickCount * 1000) / STATS_INTERVAL_MS);
      this.frameCount = 0;
      this.tickCount = 0;
      this.events.emit('stats', {
        fps: this.fps,
        ticksPerSec: this.ticksPerSec,
        bars: this.store.length,
        hasMoreHistory: this.hasMoreHistory,
      });
    }, STATS_INTERVAL_MS);
  }

  private stopPerfLoop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  /** Crosshair position forwarded by the adapter (for future extensions). */
  private lastCrosshair: CrosshairParam | null = null;
  getCrosshair(): CrosshairParam | null {
    return this.lastCrosshair;
  }

  /** Current realtime bar time (status bar). */
  getLastRealtimeBarTime(): number | null {
    return this.lastRealtimeBar;
  }

  /** Format helper used by the UI status bar. */
  static formatBarTime(time: number | null): string {
    if (time === null || Number.isNaN(time)) return '—';
    return formatUtcTime(time, false);
  }

  getConnectionStatus(): ConnectionStatus {
    return this.provider.status();
  }
}
