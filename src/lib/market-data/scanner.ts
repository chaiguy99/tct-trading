import type { BybitInterval, Candle } from "./bybit";

export type ScannerDirection = "long" | "short";

export type ScannerSignal = {
  direction: ScannerDirection;
  breakoutClose: number;
  rangeLevel: number;
  signalTime: number;
  trendAverage: number;
};

export type ScannerAnalysis = {
  signal: ScannerSignal | null;
  trend: "bullish" | "bearish" | "neutral";
  mediumBreakout: "up" | "down" | null;
  mediumInterval: BybitInterval;
  higherInterval: BybitInterval;
};

const lookback = 20;

function completedCandles(candles: Candle[]): Candle[] {
  if (candles.length < lookback + 2) return [];
  return candles.slice(0, -1);
}

export function analyzeBreakoutAlignment(
  mediumCandles: Candle[],
  higherCandles: Candle[],
  mediumInterval: BybitInterval,
  higherInterval: BybitInterval,
): ScannerAnalysis {
  const medium = completedCandles(mediumCandles);
  const higher = completedCandles(higherCandles);
  if (medium.length < lookback + 1 || higher.length < lookback) {
    return {
      signal: null,
      trend: "neutral",
      mediumBreakout: null,
      mediumInterval,
      higherInterval,
    };
  }

  const htfWindow = higher.slice(-lookback);
  const trendAverage =
    htfWindow.reduce((total, candle) => total + candle.close, 0) / lookback;
  const higherClose = htfWindow.at(-1)!.close;
  const trend =
    higherClose > trendAverage
      ? "bullish"
      : higherClose < trendAverage
        ? "bearish"
        : "neutral";

  const breakoutCandle = medium.at(-1)!;
  const priorRange = medium.slice(-(lookback + 1), -1);
  const rangeHigh = Math.max(...priorRange.map((candle) => candle.high));
  const rangeLow = Math.min(...priorRange.map((candle) => candle.low));
  const mediumBreakout =
    breakoutCandle.close > rangeHigh
      ? "up"
      : breakoutCandle.close < rangeLow
        ? "down"
        : null;
  const direction =
    trend === "bullish" && mediumBreakout === "up"
      ? "long"
      : trend === "bearish" && mediumBreakout === "down"
        ? "short"
        : null;

  return {
    signal:
      direction === null
        ? null
        : {
            direction,
            breakoutClose: breakoutCandle.close,
            rangeLevel: direction === "long" ? rangeHigh : rangeLow,
            signalTime: breakoutCandle.time,
            trendAverage,
          },
    trend,
    mediumBreakout,
    mediumInterval,
    higherInterval,
  };
}
