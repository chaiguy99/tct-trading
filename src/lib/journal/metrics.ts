import type { JournalMetrics, JournalTrade } from "./types";

export function calculateJournalMetrics(trades: JournalTrade[]): JournalMetrics {
  const closed = trades
    .filter((trade) => trade.status === "closed")
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  function calculateCurrency(instruments: JournalTrade["instrument"][]) {
    const currencyTrades = closed.filter((trade) =>
      instruments.includes(trade.instrument),
    );
    const gains = currencyTrades
      .filter((trade) => trade.netRealizedPnl > 0)
      .reduce((total, trade) => total + trade.netRealizedPnl, 0);
    const losses = currencyTrades
      .filter((trade) => trade.netRealizedPnl < 0)
      .reduce((total, trade) => total + trade.netRealizedPnl, 0);
    const netRealizedPnl = currencyTrades.reduce(
      (total, trade) => total + trade.netRealizedPnl,
      0,
    );

    let runningPnl = 0;
    let peakPnl = 0;
    let maxDrawdown = 0;
    for (const trade of currencyTrades) {
      runningPnl += trade.netRealizedPnl;
      peakPnl = Math.max(peakPnl, runningPnl);
      maxDrawdown = Math.max(maxDrawdown, peakPnl - runningPnl);
    }

    return {
      netRealizedPnl,
      expectancy:
        currencyTrades.length > 0 ? netRealizedPnl / currencyTrades.length : null,
      profitFactor:
        losses < 0 ? gains / Math.abs(losses) : gains > 0 ? null : null,
      maxDrawdown,
    };
  }

  return {
    closedTrades: closed.length,
    openTrades: trades.filter((trade) => trade.status === "open").length,
    winRate:
      closed.length > 0
        ? closed.filter((trade) => trade.netRealizedPnl > 0).length /
          closed.length
        : null,
    byCurrency: {
      USD: calculateCurrency(["MNQ", "NQ"]),
      USDT: calculateCurrency(["BTCUSDT"]),
    },
  };
}
