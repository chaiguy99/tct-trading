import assert from "node:assert/strict";
import test from "node:test";
import { parseJournalCsv } from "./csv";
import { importJournalTradesSchema } from "./types";

test("CSV parser handles escaped quotes, multiline text, and optional fields", () => {
  const preview = parseJournalCsv(
    [
      "instrument,side,quantity,price,setup,thesis,filledAt",
      'MNQ,long,2,20000,"NYOP, rejection","waited ""for close""',
      'then entered",2026-10-12T09:30:00-04:00',
    ].join("\n"),
  );

  assert.equal(preview.rowCount, 1);
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.trades[0].instrument, "MNQ");
  assert.equal(preview.trades[0].setup, "NYOP, rejection");
  assert.equal(preview.trades[0].thesis, 'waited "for close"\nthen entered');
  assert.equal(preview.trades[0].mode, "journal");
  assert.equal(preview.trades[0].fee, 0);
});

test("CSV parser reads semicolon-separated setup and confluence tags", () => {
  const preview = parseJournalCsv(
    "instrument,side,quantity,price,setups,confluences\nMNQ,long,1,20000,RBR; KOC,SMT divergence; liquidity sweep",
  );
  assert.deepEqual(preview.trades[0].setups, ["RBR", "KOC"]);
  assert.deepEqual(preview.trades[0].confluences, [
    "SMT divergence",
    "liquidity sweep",
  ]);
});

test("CSV parser validates optional exits and whole-number futures quantities", () => {
  const preview = parseJournalCsv(
    [
      "instrument,side,quantity,price,filledAt,exitQuantity,exitPrice,exitFee,exitAt",
      "MNQ,long,2,20000,2026-10-12T09:30:00-04:00,1,20010,1,2026-10-12T09:35:00-04:00",
      "NQ,short,2,20000,,0.5,19990,1,",
      "BTCUSDT,long,0.01,65000,,,0,,",
    ].join("\n"),
  );
  assert.equal(preview.trades.length, 1);
  assert.equal(preview.trades[0].exit?.quantity, 1);
  assert.equal(preview.trades[0].exit?.price, 20_010);
  assert.deepEqual(preview.issues.map((issue) => issue.row), [3, 4]);
});

test("CSV parser reports invalid rows without dropping them silently", () => {
  const preview = parseJournalCsv(
    [
      "instrument,side,quantity,price",
      "MNQ,long,1,20000",
      "BTCUSDT,sideways,0,0",
      "NQ,short,1,20001,unexpected",
    ].join("\n"),
  );
  assert.equal(preview.rowCount, 3);
  assert.equal(preview.trades.length, 1);
  assert.deepEqual(preview.issues.map((issue) => issue.row), [3, 4]);
});

test("CSV parser rejects malformed, unsupported, oversized, and empty files", () => {
  assert.throws(
    () => parseJournalCsv("instrument,side,quantity,price"),
    /at least one trade row/,
  );
  assert.throws(
    () => parseJournalCsv("instrument,side,quantity,price,unknown\nMNQ,long,1,20000,x"),
    /unsupported "unknown" column/,
  );
  assert.throws(
    () => parseJournalCsv('instrument,side,quantity,price\nMNQ,long,1,"20000'),
    /unterminated quoted field/,
  );
  assert.throws(
    () => parseJournalCsv(`instrument,side,quantity,price\n${"x".repeat(1_000_001)}`),
    /1 MB or smaller/,
  );
});

test("bulk import schema rejects paper-mode records", () => {
  const result = importJournalTradesSchema.safeParse([
    {
      instrument: "MNQ",
      side: "long",
      mode: "paper",
      quantity: 1,
      price: 20_000,
    },
  ]);
  assert.equal(result.success, false);
});
