/**
 * chart-renderer — session breaks & extended-hours shading.
 *
 * Equity markets trade bounded sessions. This layer visualizes them:
 *  - a subtle vertical break at each regular-session start
 *  - a slightly lighter shade over pre/post-market regions
 * Driven entirely by per-bar flags produced by the data provider.
 */

import { BAR_FLAG_EXTENDED, BAR_FLAG_SESSION_START } from '../../data/bar-store';
import type { OverlayDrawContext, OverlayLayer } from './overlay-canvas';
import { CHART_THEME } from '../theme';

export class SessionBreaksLayer implements OverlayLayer {
  readonly id = 'session-breaks';
  readonly z = 0;
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  draw(context: OverlayDrawContext): void {
    if (!this.enabled) return;
    const { ctx, coords, view } = context;
    const rect = coords.mainPaneRect();
    if (!rect) return;
    const n = view.length();
    if (n === 0) return;

    const leftTime = coords.xToTime(rect.x);
    const rightTime = coords.xToTime(rect.x + rect.width);
    if (leftTime === null || rightTime === null) return;

    let from = view.indexOfTime(leftTime) - 1;
    let to = view.indexOfTime(rightTime) + 1;
    from = Math.max(0, from);
    to = Math.min(n - 1, Math.max(to, from));

    // Extended-hours shading runs.
    let runStart = -1;
    for (let i = from; i <= to + 1; i++) {
      const isExt = i <= to && (view.flagAt(i) & BAR_FLAG_EXTENDED) !== 0;
      if (isExt && runStart < 0) runStart = i;
      if (!isExt && runStart >= 0) {
        const x0 = coords.timeToX(view.timeAt(runStart) - 30);
        const x1 = coords.timeToX(view.timeAt(i - 1) + 30);
        if (x0 !== null && x1 !== null && x1 > x0) {
          ctx.fillStyle = CHART_THEME.extendedShade;
          ctx.fillRect(x0, rect.y, x1 - x0, rect.height);
        }
        runStart = -1;
      }
    }

    // Session break lines.
    ctx.strokeStyle = CHART_THEME.sessionBreak;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = Math.max(1, from); i <= to; i++) {
      if ((view.flagAt(i) & BAR_FLAG_SESSION_START) !== 0) {
        const x = coords.timeToX(view.timeAt(i));
        if (x === null) continue;
        ctx.moveTo(Math.round(x) + 0.5, rect.y);
        ctx.lineTo(Math.round(x) + 0.5, rect.y + rect.height);
      }
    }
    ctx.stroke();
  }
}
