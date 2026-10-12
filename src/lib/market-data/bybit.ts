import { z } from "zod";

const BybitTickerResponse = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  result: z.object({
    list: z
      .array(
        z.object({
          symbol: z.string(),
          lastPrice: z.string(),
          price24hPcnt: z.string(),
          highPrice24h: z.string(),
          lowPrice24h: z.string(),
          fundingRate: z.string().optional(),
          nextFundingTime: z.string().optional(),
        }),
      )
      .min(1),
  }),
});

const BybitKlineResponse = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  result: z.object({
    list: z.array(z.tuple([z.string(), z.string(), z.string(), z.string(), z.string(), z.string(), z.string()])),
  }),
});

const intervals = ["1", "5", "15", "60", "240", "D"] as const;
export type BybitInterval = (typeof intervals)[number];

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BybitSnapshot = {
  symbol: "BTCUSDT";
  lastPrice: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  fundingRate: number | null;
  nextFundingTime: number | null;
  candles: Candle[];
  asOf: number;
};

export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}

function parseInterval(value: string | null): BybitInterval {
  if (value && intervals.includes(value as BybitInterval)) {
    return value as BybitInterval;
  }
  return "5";
}

async function fetchJson(url: URL): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new MarketDataError(
      error instanceof Error && error.name === "TimeoutError"
        ? "Bybit market data request timed out."
        : "Could not reach the Bybit public market-data API.",
    );
  }

  if (!response.ok) {
    throw new MarketDataError(
      `Bybit market data request failed with HTTP ${response.status}.`,
    );
  }

  return response.json();
}

export async function getBybitSnapshot(
  requestedInterval: string | null,
): Promise<BybitSnapshot> {
  const interval = parseInterval(requestedInterval);
  const tickerUrl = new URL("https://api.bybit.com/v5/market/tickers");
  tickerUrl.search = new URLSearchParams({
    category: "linear",
    symbol: "BTCUSDT",
  }).toString();

  const klineUrl = new URL("https://api.bybit.com/v5/market/kline");
  klineUrl.search = new URLSearchParams({
    category: "linear",
    symbol: "BTCUSDT",
    interval,
    limit: "120",
  }).toString();

  const [tickerData, klineData] = await Promise.all([
    fetchJson(tickerUrl),
    fetchJson(klineUrl),
  ]);
  const tickerParsed = BybitTickerResponse.safeParse(tickerData);
  const klineParsed = BybitKlineResponse.safeParse(klineData);

  if (!tickerParsed.success || !klineParsed.success) {
    throw new MarketDataError("Bybit returned an invalid market-data response.");
  }

  const tickerResult = tickerParsed.data;
  const klineResult = klineParsed.data;

  if (tickerResult.retCode !== 0 || klineResult.retCode !== 0) {
    throw new MarketDataError("Bybit did not return market data successfully.");
  }

  const ticker = tickerResult.result.list[0];
  const candles = klineResult.result.list
    .map(([start, open, high, low, close, volume]) => ({
      time: Number(start),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }))
    .filter((candle) =>
      [
        candle.time,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
      ].every(Number.isFinite),
    )
    .sort((left, right) => left.time - right.time);

  if (candles.length === 0) {
    throw new MarketDataError("Bybit returned no usable BTCUSDT candles.");
  }

  const lastPrice = Number(ticker.lastPrice);
  const change24hPercent = Number(ticker.price24hPcnt) * 100;
  const high24h = Number(ticker.highPrice24h);
  const low24h = Number(ticker.lowPrice24h);
  const fundingRate =
    ticker.fundingRate !== undefined ? Number(ticker.fundingRate) : null;
  const nextFundingTime =
    ticker.nextFundingTime !== undefined
      ? Number(ticker.nextFundingTime)
      : null;

  if (
    ![lastPrice, change24hPercent, high24h, low24h].every(Number.isFinite) ||
    (fundingRate !== null && !Number.isFinite(fundingRate)) ||
    (nextFundingTime !== null && !Number.isFinite(nextFundingTime))
  ) {
    throw new MarketDataError("Bybit returned malformed BTCUSDT ticker values.");
  }

  return {
    symbol: "BTCUSDT",
    lastPrice,
    change24hPercent,
    high24h,
    low24h,
    fundingRate,
    nextFundingTime,
    candles,
    asOf: Date.now(),
  };
}
