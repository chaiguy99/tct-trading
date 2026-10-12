import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFillSchema,
  createTradeSchema,
  importedJournalTradeSchema,
} from "./types";

test("stores owner-isolated trades, calculates partial fills, and enforces paper risk limits", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tct-journal-test-"));
  process.env.JOURNAL_DATABASE_PATH = path.join(directory, "journal.sqlite");
  const {
    addFill,
    createTrade,
    getPaperSettings,
    importJournalTrades,
    listTrades,
    savePaperSettings,
  } =
    await import("./database");

  try {
    const manualTrade = createTrade(
      "owner-one",
      createTradeSchema.parse({
        instrument: "MNQ",
        side: "long",
        mode: "journal",
        quantity: 2,
        price: 20_000,
        fee: 2,
        riskAmount: 20,
        funding: 3.5,
        setup: "NYOP rejection",
        marketCondition: "trend",
        thesis: "Rejection confirmed.",
        notes: "Waited for confirmation.",
      }),
    );

    assert.equal(manualTrade.status, "open");
    assert.equal(manualTrade.fills.length, 1);
    addFill(
      "owner-one",
      manualTrade.id,
      createFillSchema.parse({
        kind: "exit",
        quantity: 1,
        price: 20_010,
        fee: 1,
      }),
    );
    addFill(
      "owner-one",
      manualTrade.id,
      createFillSchema.parse({
        kind: "entry",
        quantity: 1,
        price: 20_020,
        fee: 1,
      }),
    );
    const closed = addFill(
      "owner-one",
      manualTrade.id,
      createFillSchema.parse({
        kind: "exit",
        quantity: 2,
        price: 20_025,
        fee: 2,
      }),
    );

    assert.equal(closed?.status, "closed");
    assert.equal(closed?.enteredQuantity, 3);
    assert.equal(closed?.exitedQuantity, 3);
    assert.equal(closed?.openQuantity, 0);
    assert.equal(closed?.grossRealizedPnl, 80);
    assert.equal(closed?.fees, 6);
    assert.equal(closed?.netRealizedPnl, 77.5);
    assert.equal(closed?.rMultiple, 77.5 / 20);
    assert.equal(listTrades("owner-two").length, 0);
    const imported = importJournalTrades("owner-two", [
      importedJournalTradeSchema.parse({
        instrument: "BTCUSDT",
        side: "short",
        mode: "journal",
        quantity: 0.01,
        price: 65_000,
        fee: 1,
        exit: {
          quantity: 0.01,
          price: 64_000,
          fee: 1,
        },
      }),
    ]);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].mode, "journal");
    assert.equal(imported[0].status, "closed");
    assert.equal(imported[0].netRealizedPnl, 8);
    assert.equal(listTrades("owner-two").length, 1);

    assert.equal(
      addFill(
        "owner-two",
        manualTrade.id,
        createFillSchema.parse({
          kind: "exit",
          quantity: 1,
          price: 20_100,
        }),
      ),
      null,
    );

    const initialSettings = getPaperSettings("owner-one");
    assert.equal(initialSettings.startingBalanceUsd, 0);
    assert.throws(
      () =>
        createTrade(
          "owner-one",
          createTradeSchema.parse({
            instrument: "MNQ",
            side: "long",
            mode: "paper",
            quantity: 1,
            price: 20_000,
            riskAmount: 100,
          }),
        ),
      /paper balance and daily loss limit/,
    );

    savePaperSettings("owner-one", {
      startingBalanceUsd: 10_000,
      startingBalanceUsdt: 5_000,
      riskPerTradePercent: 1,
      dailyLossLimitUsd: 100,
      dailyLossLimitUsdt: 100,
      maxOpenPositions: 1,
      maxLeverage: 5,
    });
    const paperTrade = createTrade(
      "owner-one",
      createTradeSchema.parse({
        instrument: "MNQ",
        side: "long",
        mode: "paper",
        quantity: 1,
        price: 20_000,
        riskAmount: 100,
      }),
    );
    assert.equal(paperTrade.mode, "paper");

    assert.throws(
      () =>
        createTrade(
          "owner-one",
          createTradeSchema.parse({
            instrument: "MNQ",
            side: "long",
            mode: "paper",
            quantity: 1,
            price: 20_000,
            riskAmount: 100,
          }),
        ),
      /maximum number of open paper positions/,
    );

    addFill(
      "owner-one",
      paperTrade.id,
      createFillSchema.parse({
        kind: "exit",
        quantity: 1,
        price: 19_985,
      }),
    );
    assert.throws(
      () =>
        createTrade(
          "owner-one",
          createTradeSchema.parse({
            instrument: "MNQ",
            side: "long",
            mode: "paper",
            quantity: 1,
            price: 20_000,
            riskAmount: 100,
          }),
        ),
      /daily loss limit/,
    );
  } finally {
    const globalDatabase = globalThis as typeof globalThis & {
      tctJournalDatabase?: { close: () => void };
    };
    globalDatabase.tctJournalDatabase?.close();
    delete globalDatabase.tctJournalDatabase;
    delete process.env.JOURNAL_DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validates whole-number futures contracts and positive crypto quantities", () => {
  const fractionalFuture = createTradeSchema.safeParse({
    instrument: "NQ",
    side: "long",
    mode: "journal",
    quantity: 0.5,
    price: 20_000,
  });
  assert.equal(fractionalFuture.success, false);

  const fractionalCrypto = createTradeSchema.safeParse({
    instrument: "BTCUSDT",
    side: "long",
    mode: "journal",
    quantity: 0.001,
    price: 65_000,
  });
  assert.equal(fractionalCrypto.success, true);
});
