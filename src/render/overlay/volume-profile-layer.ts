/**
 * chart-renderer — Volume Profile overlay layer.
 *
 * Renders the horizontal volume histogram produced by the indicator engine
 * (visible-range profile): right-anchored bars split by buy/sell dominance,
 * Point-of-Control line and value-area boundaries.
 */

import type { VolumeProfileResult } from '../../indicators/plugin-api';
import type { OverlayDrawContext, OverlayLayer } from './overlay-canvas';
import { CHART_THEME } from '../theme';

export class VolumeProfileLayer implements OverlayLayer {
  readonly id = 'volume-profile';
  readonly z = 2;
  private resultGetter: () => VolumeProfileResult | null;
  private enabled = true;

  constructor(resultGetter: () => VolumeProfileResult | null) {
    this.resultGetter = resultGetter;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  onVisibleRangeChanged(): void {
    // The engine recomputes the profile (debounced) on range change.
  }

  draw(context: OverlayDrawContext): void {
    if (!this.enabled) return;
    const result = this.resultGetter();
    if (!result || result.prices.length === 0) return;
    const { ctx, coords } = context;
    const rect = coords.mainPaneRect();
    if (!rect) return;

    const rows = result.prices.length;
    const maxVolume = Math.max(...Array.from(result.volumes));
    if (!(maxVolume > 0)) return;

    const maxBarPx = rect.width * 0.24;

    // Row pixel height from the price scale across the profile domain.
    const yHigh = coords.priceToY(result.rangeHigh);
    const yLow = coords.priceToY(result.rangeLow);
    if (yHigh === null || yLow === null || yHigh >= yLow) return;
    const rowH = Math.max(1, (yLow - yHigh) / rows);

    // Value area shading.
    const vaTop = coords.priceToY(result.valueAreaHigh);
    const vaBottom = coords.priceToY(result.valueAreaLow);
    if (vaTop !== null && vaBottom !== null && vaBottom > vaTop) {
      ctx.fillStyle = 'rgba(139, 147, 163, 0.06)';
      ctx.fillRect(rect.x, vaTop, rect.width, vaBottom - vaTop);
    }

    // Bars (right-anchored against the price axis).
    for (let i = 0; i < rows; i++) {
      const vol = result.volumes[i];
      if (vol <= 0) continue;
      const y0 = coords.priceToY(result.prices[i]);
      if (y0 === null) continue;
      const buy = result.buyVolumes[i] / vol;
      const w = (vol / maxVolume) * maxBarPx;
      const y = y0 - rowH / 2;
      const x0 = rect.x + rect.width - w;
      // Buy / sell split.
      const buyW = w * buy;
      ctx.fillStyle = CHART_THEME.vpUp;
      ctx.fillRect(x0, y, buyW, Math.max(1, rowH - 1));
      ctx.fillStyle = CHART_THEME.vpDown;
      ctx.fillRect(x0 + buyW, y, w - buyW, Math.max(1, rowH - 1));
    }

    // POC line.
    if (result.pocIndex >= 0 && result.pocIndex < rows) {
      const pocY = coords.priceToY(result.prices[result.pocIndex]);
      if (pocY !== null) {
        ctx.strokeStyle = CHART_THEME.vpPoc;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(rect.x, Math.round(pocY) + 0.5);
        ctx.lineTo(rect.x + rect.width, Math.round(pocY) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = CHART_THEME.vpPoc;
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('POC', rect.x + 6, Math.round(pocY) - 4);
      }
    }

    // VAH / VAL lines.
    ctx.strokeStyle = CHART_THEME.vpVa;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const price of [result.valueAreaHigh, result.valueAreaLow]) {
      const y = coords.priceToY(price);
      if (y === null) continue;
      ctx.beginPath();
      ctx.moveTo(rect.x, Math.round(y) + 0.5);
      ctx.lineTo(rect.x + rect.width, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}
