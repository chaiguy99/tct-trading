import assert from "node:assert/strict";
import test from "node:test";
import type { JournalTrade } from "./types";
import { calculateJournalMetrics } from "./metrics";

function trade(
  id: string,
  instrument: JournalTrade["instrument"],
  netRealizedPnl: number,
  updatedAt: string,
): JournalTrade {
  return {
    id,
    instrument,
    side: "long",
    mode: "journal",
    status: "closed",
    setup: "",
    setups: [],
    confluences: [],
    marketCondition: "",
    thesis: "",
    notes: "",
    riskAmount: null,
    funding: 0,
    createdAt: updatedAt,
    updatedAt,
    fills: [],
    enteredQuantity: 1,
    exitedQuantity: 1,
    openQuantity: 0,
    averageEntryPrice: 1,
    openAverageEntryPrice: 0,
    grossRealizedPnl: netRealizedPnl,
    fees: 0,
    netRealizedPnl,
    rMultiple: null,
  };
}

test("keeps USD futures and USDT crypto performance separate", () => {
  const metrics = calculateJournalMetrics([
    trade("mnq-win", "MNQ", 100, "2026-01-01T10:00:00.000Z"),
    trade("nq-loss", "NQ", -50, "2026-01-02T10:00:00.000Z"),
    trade("btc-win", "BTCUSDT", 20, "2026-01-03T10:00:00.000Z"),
  ]);

  assert.equal(metrics.closedTrades, 3);
  assert.equal(metrics.winRate, 2 / 3);
  assert.equal(metrics.byCurrency.USD.netRealizedPnl, 50);
  assert.equal(metrics.byCurrency.USD.expectancy, 25);
  assert.equal(metrics.byCurrency.USD.profitFactor, 2);
  assert.equal(metrics.byCurrency.USD.maxDrawdown, 50);
  assert.equal(metrics.byCurrency.USDT.netRealizedPnl, 20);
  assert.equal(metrics.byCurrency.USDT.expectancy, 20);
});
