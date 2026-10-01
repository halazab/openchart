/**
 * BarStore pagination stress test — run with: bun scripts/test-bar-store.ts
 * Verifies append/prepend/relayout integrity across many pages.
 */

import { BarStore } from '../src/data/bar-store';
import type { Bar } from '../src/provider-sdk/types';

function makeBars(startTime: number, count: number): Bar[] {
  const out: Bar[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += (i % 7) - 3;
    out.push({
      time: startTime + i * 60,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price + 0.5,
      volume: 10 + i,
      sessionStart: i % 390 === 0,
    });
  }
  return out;
}

// Simulate: initial 3000 bars, then 6 pages of 5000 prepends (mixed growth paths).
const PAGE = 5000;
let newestStart = 1_700_000_000 - 3000 * 60;
const initial = makeBars(newestStart, 3000);
newestStart -= initial.length * 60;

const store = new BarStore(4096);
store.reset(initial);

let expectedFirstTime = initial[0].time;
let ok = true;

for (let page = 0; page < 6; page++) {
  const older = makeBars(newestStart - PAGE * 60, PAGE);
  newestStart -= PAGE * 60;
  store.prepend(older);
  expectedFirstTime = older[0].time;

  // Invariants:
  const n = store.length;
  const times = store.times();
  // 1. Strictly ascending.
  for (let i = 1; i < n; i++) {
    if (times[i] <= times[i - 1]) {
      console.error(`FAIL page ${page}: times not ascending at ${i} (${times[i - 1]} -> ${times[i]})`);
      ok = false;
      break;
    }
  }
  // 2. First/last times match expectation.
  if (store.firstTime() !== expectedFirstTime) {
    console.error(`FAIL page ${page}: firstTime ${store.firstTime()} != ${expectedFirstTime}`);
    ok = false;
  }
  // 3. No zero times.
  if (times[0] === 0 || times[n - 1] === 0) {
    console.error(`FAIL page ${page}: zero time present`);
    ok = false;
  }
  // 4. Spot-check content integrity (value written equals value read).
  const mid = older[1234];
  const idx = store.indexOfTime(mid.time);
  const got = store.barAt(idx);
  if (!got || got.close !== mid.close || got.volume !== mid.volume) {
    console.error(`FAIL page ${page}: content mismatch at mid`);
    ok = false;
  }
  console.log(`page ${page}: bars=${n} first=${store.firstTime()} last=${store.lastTime()} ok=${ok}`);
}

// Realtime appends after pagination.
const nextBar: Bar = {
  time: store.lastTime() + 60,
  open: 101,
  high: 102,
  low: 100,
  close: 101.5,
  volume: 5,
};
store.appendOrUpdate(nextBar);
if (store.lastTime() !== nextBar.time) {
  console.error('FAIL: realtime append after pagination');
  ok = false;
}
// Update the same bar.
store.appendOrUpdate({ ...nextBar, close: 102, volume: 9 });
if (store.barAt(store.length - 1)!.close !== 102) {
  console.error('FAIL: realtime update');
  ok = false;
}

console.log(ok ? 'ALL PASS' : 'FAILURES PRESENT');
process.exit(ok ? 0 : 1);
