import assert from "node:assert/strict";
import test from "node:test";
import { createJournalBackup, journalBackupVersion } from "./backup";
import type { PaperSettings } from "./types";

const settings: PaperSettings = {
  startingBalanceUsd: 10_000,
  startingBalanceUsdt: 5_000,
  riskPerTradePercent: 1,
  dailyLossLimitUsd: 100,
  dailyLossLimitUsdt: 100,
  maxOpenPositions: 3,
  maxLeverage: 2,
};

test("journal backup includes version, owner data snapshot, settings, and recalculated metrics", () => {
  const backup = createJournalBackup("2026-10-12T00:00:00.000Z", [], settings);
  assert.deepEqual(backup, {
    format: "tct-journal-backup",
    version: journalBackupVersion,
    exportedAt: "2026-10-12T00:00:00.000Z",
    trades: [],
    settings,
    metrics: {
      closedTrades: 0,
      openTrades: 0,
      winRate: null,
      byCurrency: {
        USD: {
          netRealizedPnl: 0,
          expectancy: null,
          profitFactor: null,
          maxDrawdown: 0,
        },
        USDT: {
          netRealizedPnl: 0,
          expectancy: null,
          profitFactor: null,
          maxDrawdown: 0,
        },
      },
    },
  });
});
