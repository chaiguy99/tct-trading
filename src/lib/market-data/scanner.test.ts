import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "./bybit";
import { analyzeBreakoutAlignment } from "./scanner";

function candles(count: number, close: number): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: index * 60_000,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1,
  }));
}

test("signals an up breakout only when the higher timeframe trend agrees", () => {
  const medium = candles(24, 100);
  medium[21] = { ...medium[21], close: 104, high: 105 };
  medium[22] = { ...medium[22], close: 110, high: 111 };
  const higher = candles(24, 100);
  higher[22] = { ...higher[22], close: 103 };

  const analysis = analyzeBreakoutAlignment(medium, higher, "15", "60");
  assert.equal(analysis.trend, "bullish");
  assert.equal(analysis.mediumBreakout, "up");
  assert.deepEqual(analysis.signal, {
    direction: "long",
    breakoutClose: 110,
    rangeLevel: 105,
    signalTime: 22 * 60_000,
    trendAverage: 100.15,
  });
});

test("does not signal when the breakout opposes the higher timeframe trend", () => {
  const medium = candles(24, 100);
  medium[22] = { ...medium[22], close: 110, high: 111 };
  const higher = candles(24, 100);
  higher[22] = { ...higher[22], close: 99 };

  const analysis = analyzeBreakoutAlignment(medium, higher, "15", "60");
  assert.equal(analysis.trend, "bearish");
  assert.equal(analysis.mediumBreakout, "up");
  assert.equal(analysis.signal, null);
});

test("does not signal on the currently-forming candle or insufficient history", () => {
  const medium = candles(24, 100);
  medium[23] = { ...medium[23], close: 1000, high: 1001 };
  const analysis = analyzeBreakoutAlignment(medium, candles(24, 100), "15", "60");
  assert.equal(analysis.signal, null);
  assert.equal(analysis.mediumBreakout, null);

  const insufficient = analyzeBreakoutAlignment(
    candles(21, 100),
    candles(21, 100),
    "15",
    "60",
  );
  assert.equal(insufficient.signal, null);
  assert.equal(insufficient.mediumBreakout, null);
});

test("signals a down breakout only when the higher timeframe trend agrees", () => {
  const medium = candles(24, 100);
  medium[22] = { ...medium[22], close: 97, low: 96 };
  const higher = candles(24, 100);
  higher[22] = { ...higher[22], close: 97 };

  const analysis = analyzeBreakoutAlignment(medium, higher, "15", "60");
  assert.equal(analysis.trend, "bearish");
  assert.equal(analysis.mediumBreakout, "down");
  assert.equal(analysis.signal?.direction, "short");
  assert.equal(analysis.signal?.rangeLevel, 98);
});
