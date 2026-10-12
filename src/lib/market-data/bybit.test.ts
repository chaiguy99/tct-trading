import assert from "node:assert/strict";
import test from "node:test";
import { getBybitSnapshot, MarketDataError } from "./bybit";

const ticker = {
  retCode: 0,
  retMsg: "OK",
  result: {
    list: [
      {
        symbol: "BTCUSDT",
        lastPrice: "65000.00",
        price24hPcnt: "0.025",
        highPrice24h: "66000.00",
        lowPrice24h: "63000.00",
        fundingRate: "0.0001",
        nextFundingTime: "1730000000000",
      },
    ],
  },
};

const klines = {
  retCode: 0,
  retMsg: "OK",
  result: {
    list: [
      ["1730000300000", "65000", "65100", "64900", "65050", "3", "195000"],
      ["1730000000000", "64900", "65100", "64800", "65000", "2", "130000"],
    ],
  },
};

test("normalizes Bybit linear ticker and sorts candles oldest first", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    return Response.json(url.includes("/tickers") ? ticker : klines);
  };

  const snapshot = await getBybitSnapshot("5");

  assert.equal(snapshot.symbol, "BTCUSDT");
  assert.equal(snapshot.lastPrice, 65000);
  assert.equal(snapshot.change24hPercent, 2.5);
  assert.deepEqual(
    snapshot.candles.map((candle) => candle.time),
    [1730000000000, 1730000300000],
  );
  assert.equal(snapshot.fundingRate, 0.0001);
});

test("rejects malformed ticker values instead of returning fake-looking data", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) =>
    Response.json(
      String(input).includes("/tickers")
        ? {
            ...ticker,
            result: {
              list: [{ ...ticker.result.list[0], lastPrice: "not-a-price" }],
            },
          }
        : klines,
    );

  await assert.rejects(
    getBybitSnapshot("5"),
    (error: unknown) =>
      error instanceof MarketDataError &&
      error.message.includes("malformed BTCUSDT ticker"),
  );
});

test("uses the default candle interval for unsupported values", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requestedUrls: string[] = [];

  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return Response.json(String(input).includes("/tickers") ? ticker : klines);
  };

  await getBybitSnapshot("1000");

  assert.ok(requestedUrls.some((url) => url.includes("interval=5")));
});
