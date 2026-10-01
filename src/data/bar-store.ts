/**
 * data-engine — BarStore.
 *
 * Column-oriented OHLCV storage over pre-allocated typed arrays:
 *
 *   times[]  open[]  high[]  low[]  close[]  volume[]  flags[]
 *
 * Design goals:
 *  - O(1) amortized append (realtime bar updates, bucket rollovers)
 *  - O(n) prepends for historical pagination, WITHOUT copying the live
 *    columns on every page: a head cursor reserves headroom at the front
 *  - zero garbage during indicator computation (columns are passed as
 *    subarray views straight into Web Workers)
 *  - binary-search time indexing for the renderer and drawing engine
 *
 * Heikin-Ashi columns are maintained in parallel and updated incrementally.
 */

import type { Bar } from '../provider-sdk/types';
import { timeLowerBound } from '../core/math';

export const BAR_FLAG_SESSION_START = 1;
export const BAR_FLAG_EXTENDED = 2;

export interface BarColumnData {
  times: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  flags: Uint8Array;
  length: number;
}

const GROW_FACTOR = 2;
const MIN_CAPACITY = 4096;

export class BarStore {
  private timesBuf!: Float64Array;
  private openBuf!: Float64Array;
  private highBuf!: Float64Array;
  private lowBuf!: Float64Array;
  private closeBuf!: Float64Array;
  private volumeBuf!: Float64Array;
  private flagsBuf!: Uint8Array;

  // Heikin-Ashi mirror columns (same indexing as the raw columns).
  private haOpenBuf!: Float64Array;
  private haHighBuf!: Float64Array;
  private haLowBuf!: Float64Array;
  private haCloseBuf!: Float64Array;

  private _length = 0;
  private _head = 0; // buffer offset of the first logical bar
  private capacity = 0;

  constructor(initialCapacity = MIN_CAPACITY) {
    this.allocate(Math.max(initialCapacity, MIN_CAPACITY));
  }

  get length(): number {
    return this._length;
  }

  /** True when the store holds no bars at all. */
  get isEmpty(): boolean {
    return this._length === 0;
  }

  // -- Column views (offset-aware) -----------------------------------------

  times(): Float64Array {
    return this.timesBuf.subarray(this._head, this._head + this._length);
  }

  open(): Float64Array {
    return this.openBuf.subarray(this._head, this._head + this._length);
  }

  high(): Float64Array {
    return this.highBuf.subarray(this._head, this._head + this._length);
  }

  low(): Float64Array {
    return this.lowBuf.subarray(this._head, this._head + this._length);
  }

  close(): Float64Array {
    return this.closeBuf.subarray(this._head, this._head + this._length);
  }

  volume(): Float64Array {
    return this.volumeBuf.subarray(this._head, this._head + this._length);
  }

  flags(): Uint8Array {
    return this.flagsBuf.subarray(this._head, this._head + this._length);
  }

  haOpen(): Float64Array {
    return this.haOpenBuf.subarray(this._head, this._head + this._length);
  }

  haHigh(): Float64Array {
    return this.haHighBuf.subarray(this._head, this._head + this._length);
  }

  haLow(): Float64Array {
    return this.haLowBuf.subarray(this._head, this._head + this._length);
  }

  haClose(): Float64Array {
    return this.haCloseBuf.subarray(this._head, this._head + this._length);
  }

  /** Snapshot of raw column data for worker transfer (copies buffers). */
  toColumnData(): BarColumnData {
    const len = this._length;
    return {
      times: this.times().slice(),
      open: this.open().slice(),
      high: this.high().slice(),
      low: this.low().slice(),
      close: this.close().slice(),
      volume: this.volume().slice(),
      flags: this.flags().slice(),
      length: len,
    };
  }

  // -- Accessors ------------------------------------------------------------

  barAt(index: number): Bar | null {
    if (index < 0 || index >= this._length) return null;
    const i = this._head + index;
    return {
      time: this.timesBuf[i],
      open: this.openBuf[i],
      high: this.highBuf[i],
      low: this.lowBuf[i],
      close: this.closeBuf[i],
      volume: this.volumeBuf[i],
      sessionStart: (this.flagsBuf[i] & BAR_FLAG_SESSION_START) !== 0 || undefined,
      extended: (this.flagsBuf[i] & BAR_FLAG_EXTENDED) !== 0 || undefined,
    };
  }

  timeAt(index: number): number {
    return this.timesBuf[this._head + index];
  }

  firstTime(): number {
    return this._length > 0 ? this.timesBuf[this._head] : NaN;
  }

  lastTime(): number {
    return this._length > 0 ? this.timesBuf[this._head + this._length - 1] : NaN;
  }

  lastBar(): Bar | null {
    return this.barAt(this._length - 1);
  }

  /** Index of the last bar with time <= t, or -1. */
  indexOfTime(t: number): number {
    return timeLowerBound(this.times(), this._length, t);
  }

  /**
   * Fractional index for an arbitrary time (for the drawing engine):
   * interpolates between bars; extrapolates beyond the edges using the
   * spacing of the nearest two bars.
   */
  fractionalIndexForTime(t: number): number {
    const n = this._length;
    if (n === 0) return 0;
    const times = this.times();
    if (t <= times[0]) {
      const spacing = n > 1 ? times[1] - times[0] : 60;
      return spacing > 0 ? (t - times[0]) / spacing : 0;
    }
    if (t >= times[n - 1]) {
      const spacing = n > 1 ? times[n - 1] - times[n - 2] : 60;
      return n - 1 + (spacing > 0 ? (t - times[n - 1]) / spacing : 0);
    }
    const right = timeLowerBound(times, n, t); // times[right] <= t
    if (times[right] === t) return right;
    const left = right - 1;
    const span = times[right] - times[left];
    return left + (span > 0 ? (t - times[left]) / span : 0);
  }

  /** Inverse of `fractionalIndexForTime`. */
  timeForFractionalIndex(index: number): number {
    const n = this._length;
    if (n === 0) return 0;
    const times = this.times();
    if (index <= 0) {
      const spacing = n > 1 ? times[1] - times[0] : 60;
      return times[0] + index * spacing;
    }
    if (index >= n - 1) {
      const spacing = n > 1 ? times[n - 1] - times[n - 2] : 60;
      return times[n - 1] + (index - (n - 1)) * spacing;
    }
    const i0 = Math.floor(index);
    const frac = index - i0;
    return times[i0] + frac * (times[i0 + 1] - times[i0]);
  }

  // -- Mutations ------------------------------------------------------------

  /** Replace the entire content (symbol / timeframe switch). */
  reset(bars: Bar[]): void {
    const need = Math.max(bars.length, MIN_CAPACITY);
    if (need > this.capacity) this.allocate(need);
    this._head = 0;
    this._length = 0;
    for (let i = 0; i < bars.length; i++) {
      this.writeRaw(i, bars[i]);
    }
    this._length = bars.length;
    this.recomputeHeikinAshiFull();
    // Reserve tail headroom for realtime appends.
    if (this._head + this._length + MIN_CAPACITY > this.capacity) {
      this.grow(Math.max(this.capacity, (this._length + MIN_CAPACITY) * GROW_FACTOR));
    }
  }

  /** Append or update the LAST bar (realtime path). Returns action taken. */
  appendOrUpdate(bar: Bar): 'updated' | 'appended' | 'ignored' {
    if (this._length === 0) {
      this.pushBarInternal(bar);
      return 'appended';
    }
    const lastIdx = this._head + this._length - 1;
    const lastTime = this.timesBuf[lastIdx];
    if (bar.time === lastTime) {
      this.writeRaw(this._length - 1, bar);
      this.updateHeikinAshiLast();
      return 'updated';
    }
    if (bar.time < lastTime) return 'ignored';
    // Out-of-order-but-newer (small gap): append only if contiguous-ish,
    // otherwise ignore — the engine replaces history on any gap.
    this.ensureTailCapacity(1);
    this.writeRaw(this._length, bar);
    this._length++;
    this.updateHeikinAshiLast();
    return 'appended';
  }

  /** Prepend a page of older bars (historical pagination). */
  prepend(bars: Bar[]): void {
    if (bars.length === 0) return;
    const need = bars.length;
    if (this._head < need) {
      this.relayout(need);
    }
    const start = this._head - need; // absolute buffer index
    for (let i = 0; i < need; i++) {
      this.writeAbsolute(start + i, bars[i]);
    }
    this._head = start;
    this._length += need;
    this.recomputeHeikinAshiFull();
  }

  // -- Internal helpers -----------------------------------------------------

  /** Write at a LOGICAL index (relative to head). */
  private writeRaw(logicalIndex: number, bar: Bar): void {
    this.writeAbsolute(this._head + logicalIndex, bar);
  }

  /** Write at an ABSOLUTE buffer index. */
  private writeAbsolute(bufferIndex: number, bar: Bar): void {
    const i = bufferIndex;
    this.timesBuf[i] = bar.time;
    this.openBuf[i] = bar.open;
    this.highBuf[i] = bar.high;
    this.lowBuf[i] = bar.low;
    this.closeBuf[i] = bar.close;
    this.volumeBuf[i] = bar.volume;
    this.flagsBuf[i] =
      (bar.sessionStart ? BAR_FLAG_SESSION_START : 0) |
      (bar.extended ? BAR_FLAG_EXTENDED : 0);
  }

  private pushBarInternal(bar: Bar): void {
    this.ensureTailCapacity(1);
    this.writeRaw(this._length, bar);
    this._length++;
    this.updateHeikinAshiLast();
  }

  private ensureTailCapacity(n: number): void {
    if (this._head + this._length + n <= this.capacity) return;
    const newCap = Math.max(
      this.capacity * GROW_FACTOR,
      (this._length + n) * GROW_FACTOR + MIN_CAPACITY,
    );
    this.reallocate(newCap);
  }

  /** Make room for `need` slots before the current head (for prepends). */
  private relayout(need: number): void {
    const required = this._length + need + MIN_CAPACITY;
    if (required > this.capacity) {
      this.reallocate(Math.max(required * GROW_FACTOR, this.capacity * GROW_FACTOR));
      // reallocate() recenters head at (newCap - len)/2 which is >= need.
      return;
    }
    // Enough capacity — shift content right, guaranteeing head >= need.
    const targetHead = Math.max(need, Math.floor((this.capacity - this._length) / 2));
    if (targetHead !== this._head) {
      this.shiftTo(targetHead);
    }
  }

  private shiftTo(newHead: number): void {
    if (newHead === this._head) return;
    const len = this._length;
    const src = this._head;
    if (newHead > src) {
      this.timesBuf.copyWithin(newHead, src, src + len);
      this.openBuf.copyWithin(newHead, src, src + len);
      this.highBuf.copyWithin(newHead, src, src + len);
      this.lowBuf.copyWithin(newHead, src, src + len);
      this.closeBuf.copyWithin(newHead, src, src + len);
      this.volumeBuf.copyWithin(newHead, src, src + len);
      this.flagsBuf.copyWithin(newHead, src, src + len);
      this.haOpenBuf.copyWithin(newHead, src, src + len);
      this.haHighBuf.copyWithin(newHead, src, src + len);
      this.haLowBuf.copyWithin(newHead, src, src + len);
      this.haCloseBuf.copyWithin(newHead, src, src + len);
    } else {
      // Shift left (rare path).
      for (let i = 0; i < len; i++) {
        const s = src + i;
        const d = newHead + i;
        this.timesBuf[d] = this.timesBuf[s];
        this.openBuf[d] = this.openBuf[s];
        this.highBuf[d] = this.highBuf[s];
        this.lowBuf[d] = this.lowBuf[s];
        this.closeBuf[d] = this.closeBuf[s];
        this.volumeBuf[d] = this.volumeBuf[s];
        this.flagsBuf[d] = this.flagsBuf[s];
        this.haOpenBuf[d] = this.haOpenBuf[s];
        this.haHighBuf[d] = this.haHighBuf[s];
        this.haLowBuf[d] = this.haLowBuf[s];
        this.haCloseBuf[d] = this.haCloseBuf[s];
      }
    }
    this._head = newHead;
  }

  private grow(minCapacity: number): void {
    if (minCapacity <= this.capacity) return;
    this.reallocate(Math.max(minCapacity, this.capacity * GROW_FACTOR));
  }

  private reallocate(newCap: number): void {
    const old = {
      times: this.timesBuf,
      open: this.openBuf,
      high: this.highBuf,
      low: this.lowBuf,
      close: this.closeBuf,
      volume: this.volumeBuf,
      flags: this.flagsBuf,
      haOpen: this.haOpenBuf,
      haHigh: this.haHighBuf,
      haLow: this.haLowBuf,
      haClose: this.haCloseBuf,
    };
    const oldHead = this._head;
    const len = this._length;
    this.allocate(newCap);
    // Keep content roughly centered: room to prepend AND append.
    this._head = Math.max(0, Math.floor((newCap - len) / 2));
    for (let i = 0; i < len; i++) {
      const s = oldHead + i;
      const d = this._head + i;
      this.timesBuf[d] = old.times[s];
      this.openBuf[d] = old.open[s];
      this.highBuf[d] = old.high[s];
      this.lowBuf[d] = old.low[s];
      this.closeBuf[d] = old.close[s];
      this.volumeBuf[d] = old.volume[s];
      this.flagsBuf[d] = old.flags[s];
      this.haOpenBuf[d] = old.haOpen[s];
      this.haHighBuf[d] = old.haHigh[s];
      this.haLowBuf[d] = old.haLow[s];
      this.haCloseBuf[d] = old.haClose[s];
    }
  }

  private allocate(capacity: number): void {
    this.capacity = capacity;
    this.timesBuf = new Float64Array(capacity);
    this.openBuf = new Float64Array(capacity);
    this.highBuf = new Float64Array(capacity);
    this.lowBuf = new Float64Array(capacity);
    this.closeBuf = new Float64Array(capacity);
    this.volumeBuf = new Float64Array(capacity);
    this.flagsBuf = new Uint8Array(capacity);
    this.haOpenBuf = new Float64Array(capacity);
    this.haHighBuf = new Float64Array(capacity);
    this.haLowBuf = new Float64Array(capacity);
    this.haCloseBuf = new Float64Array(capacity);
    this._head = 0;
    // NOTE: _length preserved by callers.
  }

  // -- Heikin-Ashi ----------------------------------------------------------

  private recomputeHeikinAshiFull(): void {
    const n = this._length;
    for (let i = 0; i < n; i++) {
      const j = this._head + i;
      const o = this.openBuf[j];
      const h = this.highBuf[j];
      const l = this.lowBuf[j];
      const c = this.closeBuf[j];
      const haClose = (o + h + l + c) / 4;
      let haOpen: number;
      if (i === 0) {
        haOpen = (o + c) / 2;
      } else {
        const prev = j - 1;
        haOpen = (this.haOpenBuf[prev] + this.haCloseBuf[prev]) / 2;
      }
      this.haOpenBuf[j] = haOpen;
      this.haCloseBuf[j] = haClose;
      this.haHighBuf[j] = Math.max(h, haOpen, haClose);
      this.haLowBuf[j] = Math.min(l, haOpen, haClose);
    }
  }

  /** Incremental HA update — recomputes only the last bar (O(1)). */
  private updateHeikinAshiLast(): void {
    const n = this._length;
    if (n === 0) return;
    const j = this._head + n - 1;
    const o = this.openBuf[j];
    const h = this.highBuf[j];
    const l = this.lowBuf[j];
    const c = this.closeBuf[j];
    const haClose = (o + h + l + c) / 4;
    let haOpen: number;
    if (n === 1) {
      haOpen = (o + c) / 2;
    } else {
      const prev = j - 1;
      haOpen = (this.haOpenBuf[prev] + this.haCloseBuf[prev]) / 2;
    }
    this.haOpenBuf[j] = haOpen;
    this.haCloseBuf[j] = haClose;
    this.haHighBuf[j] = Math.max(h, haOpen, haClose);
    this.haLowBuf[j] = Math.min(l, haOpen, haClose);
  }
}
