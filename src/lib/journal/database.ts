import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { JournalConflictError } from "./errors";
import type {
  CreateFillInput,
  CreateTradeInput,
  ImportJournalTradeInput,
  ImportJournalTradesInput,
  JournalTrade,
  PaperSettings,
  TradeFill,
} from "./types";

type FillRow = {
  id: string;
  kind: "entry" | "exit";
  quantity: number;
  price: number;
  fee: number;
  risk_amount: number | null;
  filled_at: string;
};

type TradeRow = {
  id: string;
  instrument: JournalTrade["instrument"];
  side: JournalTrade["side"];
  mode: JournalTrade["mode"];
  status: JournalTrade["status"];
  setup: string;
  market_condition: string;
  thesis: string;
  notes: string;
  risk_amount: number | null;
  funding: number;
  created_at: string;
  updated_at: string;
};

type SettingsRow = {
  starting_balance_usd: number;
  starting_balance_usdt: number;
  risk_per_trade_percent: number;
  daily_loss_limit_usd: number;
  daily_loss_limit_usdt: number;
  max_open_positions: number;
  max_leverage: number;
};

declare global {
  var tctJournalDatabase: Database.Database | undefined;
}

function getDatabase() {
  if (globalThis.tctJournalDatabase) {
    return globalThis.tctJournalDatabase;
  }

  const filename =
    process.env.JOURNAL_DATABASE_PATH ??
    path.join(process.cwd(), ".data", "journal.sqlite");
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  chmodSync(filename, 0o600);
  database.exec(`
    CREATE TABLE IF NOT EXISTS journal_trades (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      instrument TEXT NOT NULL CHECK (instrument IN ('MNQ', 'NQ', 'BTCUSDT')),
      side TEXT NOT NULL CHECK (side IN ('long', 'short')),
      mode TEXT NOT NULL CHECK (mode IN ('journal', 'paper')),
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      setup TEXT NOT NULL DEFAULT '',
      market_condition TEXT NOT NULL DEFAULT '',
      thesis TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      risk_amount REAL,
      funding REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS journal_trades_owner_updated
      ON journal_trades (owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS journal_fills (
      id TEXT PRIMARY KEY,
      trade_id TEXT NOT NULL REFERENCES journal_trades(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('entry', 'exit')),
      quantity REAL NOT NULL CHECK (quantity > 0),
      price REAL NOT NULL CHECK (price > 0),
      fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
      risk_amount REAL,
      filled_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS journal_fills_owner_trade
      ON journal_fills (owner_id, trade_id, filled_at);

    CREATE TABLE IF NOT EXISTS paper_settings (
      owner_id TEXT PRIMARY KEY,
      starting_balance_usd REAL NOT NULL DEFAULT 0 CHECK (starting_balance_usd >= 0),
      starting_balance_usdt REAL NOT NULL DEFAULT 0 CHECK (starting_balance_usdt >= 0),
      risk_per_trade_percent REAL NOT NULL DEFAULT 1 CHECK (risk_per_trade_percent > 0),
      daily_loss_limit_usd REAL NOT NULL DEFAULT 0 CHECK (daily_loss_limit_usd >= 0),
      daily_loss_limit_usdt REAL NOT NULL DEFAULT 0 CHECK (daily_loss_limit_usdt >= 0),
      max_open_positions INTEGER NOT NULL DEFAULT 3 CHECK (max_open_positions > 0),
      max_leverage REAL NOT NULL DEFAULT 2 CHECK (max_leverage >= 1)
    ) STRICT;
  `);
  const columns = database
    .prepare("PRAGMA table_info(journal_trades)")
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "funding")) {
    database.exec(
      "ALTER TABLE journal_trades ADD COLUMN funding REAL NOT NULL DEFAULT 0",
    );
  }
  const fillColumns = database
    .prepare("PRAGMA table_info(journal_fills)")
    .all() as Array<{ name: string }>;
  if (!fillColumns.some((column) => column.name === "risk_amount")) {
    database.exec("ALTER TABLE journal_fills ADD COLUMN risk_amount REAL");
  }

  globalThis.tctJournalDatabase = database;
  return database;
}

function mapTrade(row: TradeRow, fillRows: FillRow[]): JournalTrade {
  const fills: TradeFill[] = fillRows.map((fill) => ({
    id: fill.id,
    kind: fill.kind,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    riskAmount: fill.risk_amount,
    filledAt: fill.filled_at,
  }));
  const entries = fills.filter((fill) => fill.kind === "entry");
  const exits = fills.filter((fill) => fill.kind === "exit");
  const enteredQuantity = entries.reduce((sum, fill) => sum + fill.quantity, 0);
  const exitedQuantity = exits.reduce((sum, fill) => sum + fill.quantity, 0);
  const averageEntryPrice =
    enteredQuantity > 0
      ? entries.reduce((sum, fill) => sum + fill.quantity * fill.price, 0) /
        enteredQuantity
      : 0;
  let positionQuantity = 0;
  let positionCost = 0;
  let positionEntryFees = 0;
  let grossRealizedPnl = 0;
  let realizedFees = 0;
  const direction = row.side === "long" ? 1 : -1;
  const pointValue =
    row.instrument === "NQ" ? 20 : row.instrument === "MNQ" ? 2 : 1;
  for (const fill of fills) {
    if (fill.kind === "entry") {
      positionQuantity += fill.quantity;
      positionCost += fill.quantity * fill.price;
      positionEntryFees += fill.fee;
      continue;
    }

    if (positionQuantity > 0) {
      const averageCost = positionCost / positionQuantity;
      grossRealizedPnl +=
        direction *
        (fill.price - averageCost) *
        fill.quantity *
        pointValue;
      const allocatedEntryFees =
        positionEntryFees * (fill.quantity / positionQuantity);
      realizedFees += fill.fee + allocatedEntryFees;
      positionEntryFees -= allocatedEntryFees;
      positionQuantity -= fill.quantity;
      positionCost = Math.max(0, positionCost - averageCost * fill.quantity);
    }
  }
  const fees = fills.reduce((sum, fill) => sum + fill.fee, 0);
  const realizedFunding =
    row.status === "closed"
      ? row.funding
      : enteredQuantity > 0
        ? row.funding * (exitedQuantity / enteredQuantity)
        : 0;
  const netRealizedPnl =
    grossRealizedPnl - realizedFees + realizedFunding;

  return {
    id: row.id,
    instrument: row.instrument,
    side: row.side,
    mode: row.mode,
    status: row.status,
    setup: row.setup,
    marketCondition: row.market_condition,
    thesis: row.thesis,
    notes: row.notes,
    riskAmount: row.risk_amount,
    funding: row.funding,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fills,
    enteredQuantity,
    exitedQuantity,
    openQuantity: Math.max(0, enteredQuantity - exitedQuantity),
    averageEntryPrice,
    openAverageEntryPrice:
      positionQuantity > 0 ? positionCost / positionQuantity : 0,
    grossRealizedPnl,
    fees,
    netRealizedPnl,
    rMultiple:
      row.risk_amount && row.status === "closed"
        ? netRealizedPnl / row.risk_amount
        : null,
  };
}

function queryTrade(ownerId: string, tradeId: string): JournalTrade | null {
  const database = getDatabase();
  const row = database
    .prepare(
      `SELECT id, instrument, side, mode, status, setup, market_condition,
              thesis, notes, risk_amount, funding, created_at, updated_at
         FROM journal_trades WHERE owner_id = ? AND id = ?`,
    )
    .get(ownerId, tradeId) as TradeRow | undefined;
  if (!row) return null;

  const fills = database
    .prepare(
      `SELECT id, kind, quantity, price, fee, risk_amount, filled_at
         FROM journal_fills WHERE owner_id = ? AND trade_id = ?
         ORDER BY filled_at, CASE kind WHEN 'entry' THEN 0 ELSE 1 END, id`,
    )
    .all(ownerId, tradeId) as FillRow[];
  return mapTrade(row, fills);
}

export function listTrades(ownerId: string): JournalTrade[] {
  const database = getDatabase();
  const trades = database
    .prepare(
      `SELECT id, instrument, side, mode, status, setup, market_condition,
              thesis, notes, risk_amount, funding, created_at, updated_at
         FROM journal_trades WHERE owner_id = ?
         ORDER BY updated_at DESC, id`,
    )
    .all(ownerId) as TradeRow[];
  const fillQuery = database.prepare(
    `SELECT id, kind, quantity, price, fee, risk_amount, filled_at
       FROM journal_fills WHERE owner_id = ? AND trade_id = ?
       ORDER BY filled_at, CASE kind WHEN 'entry' THEN 0 ELSE 1 END, id`,
  );

  return trades.map((trade) =>
    mapTrade(
      trade,
      fillQuery.all(ownerId, trade.id) as FillRow[],
    ),
  );
}

export function createTrade(
  ownerId: string,
  input: CreateTradeInput,
): JournalTrade {
  const database = getDatabase();
  const tradeId = database.transaction(() =>
    insertTrade(database, ownerId, input),
  )();
  const trade = queryTrade(ownerId, tradeId);
  if (!trade) throw new Error("Created trade could not be read back.");
  return trade;
}

export function importJournalTrades(
  ownerId: string,
  inputs: ImportJournalTradesInput,
): JournalTrade[] {
  const database = getDatabase();
  const tradeIds = database.transaction(() =>
    inputs.map((input) => {
      if (input.mode !== "journal") {
        throw new Error("CSV imports may only create journal records.");
      }
      return insertTrade(database, ownerId, input);
    }),
  )();

  return tradeIds.map((tradeId) => {
    const trade = queryTrade(ownerId, tradeId);
    if (!trade) throw new Error("Imported trade could not be read back.");
    return trade;
  });
}

function insertTrade(
  database: Database.Database,
  ownerId: string,
  input: CreateTradeInput | ImportJournalTradeInput,
): string {
  if (input.mode === "paper") {
    assertPaperTradeAllowed(database, ownerId, input);
  }
  const now = new Date().toISOString();
  const tradeId = randomUUID();
  const fillId = randomUUID();
  database
    .prepare(
      `INSERT INTO journal_trades
        (id, owner_id, instrument, side, mode, status, setup,
         market_condition, thesis, notes, risk_amount, funding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tradeId,
      ownerId,
      input.instrument,
      input.side,
      input.mode,
      input.setup,
      input.marketCondition,
      input.thesis,
      input.notes,
      input.riskAmount,
      input.funding,
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO journal_fills
        (id, trade_id, owner_id, kind, quantity, price, fee, risk_amount, filled_at)
       VALUES (?, ?, ?, 'entry', ?, ?, ?, ?, ?)`,
    )
    .run(
      fillId,
      tradeId,
      ownerId,
      input.quantity,
      input.price,
      input.fee,
      input.riskAmount,
      input.filledAt ?? now,
    );
  if ("exit" in input && input.exit) {
    const entryTime = input.filledAt ?? now;
    const exitTime = input.exit.filledAt
      ? new Date(input.exit.filledAt).toISOString()
      : new Date(Date.parse(entryTime) + 1).toISOString();
    database
      .prepare(
        `INSERT INTO journal_fills
          (id, trade_id, owner_id, kind, quantity, price, fee, risk_amount, filled_at)
         VALUES (?, ?, ?, 'exit', ?, ?, ?, NULL, ?)`,
      )
      .run(
        randomUUID(),
        tradeId,
        ownerId,
        input.exit.quantity,
        input.exit.price,
        input.exit.fee,
        exitTime,
      );
    if (input.exit.quantity >= input.quantity - 1e-9) {
      database
        .prepare(
          "UPDATE journal_trades SET status = 'closed', updated_at = ? WHERE owner_id = ? AND id = ?",
        )
        .run(now, ownerId, tradeId);
    }
  }
  return tradeId;
}

export function getPaperSettings(ownerId: string): PaperSettings {
  const database = getDatabase();
  database
    .prepare("INSERT OR IGNORE INTO paper_settings (owner_id) VALUES (?)")
    .run(ownerId);
  const row = database
    .prepare(
      `SELECT starting_balance_usd, starting_balance_usdt,
              risk_per_trade_percent, daily_loss_limit_usd,
              daily_loss_limit_usdt, max_open_positions, max_leverage
         FROM paper_settings WHERE owner_id = ?`,
    )
    .get(ownerId) as SettingsRow;

  return {
    startingBalanceUsd: row.starting_balance_usd,
    startingBalanceUsdt: row.starting_balance_usdt,
    riskPerTradePercent: row.risk_per_trade_percent,
    dailyLossLimitUsd: row.daily_loss_limit_usd,
    dailyLossLimitUsdt: row.daily_loss_limit_usdt,
    maxOpenPositions: row.max_open_positions,
    maxLeverage: row.max_leverage,
  };
}

export function savePaperSettings(
  ownerId: string,
  settings: PaperSettings,
): PaperSettings {
  const database = getDatabase();
  database
    .prepare(
      `INSERT INTO paper_settings (
         owner_id, starting_balance_usd, starting_balance_usdt,
         risk_per_trade_percent, daily_loss_limit_usd,
         daily_loss_limit_usdt, max_open_positions, max_leverage
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET
         starting_balance_usd = excluded.starting_balance_usd,
         starting_balance_usdt = excluded.starting_balance_usdt,
         risk_per_trade_percent = excluded.risk_per_trade_percent,
         daily_loss_limit_usd = excluded.daily_loss_limit_usd,
         daily_loss_limit_usdt = excluded.daily_loss_limit_usdt,
         max_open_positions = excluded.max_open_positions,
         max_leverage = excluded.max_leverage`,
    )
    .run(
      ownerId,
      settings.startingBalanceUsd,
      settings.startingBalanceUsdt,
      settings.riskPerTradePercent,
      settings.dailyLossLimitUsd,
      settings.dailyLossLimitUsdt,
      settings.maxOpenPositions,
      settings.maxLeverage,
    );
  return getPaperSettings(ownerId);
}

function assertPaperTradeAllowed(
  database: Database.Database,
  ownerId: string,
  input: CreateTradeInput,
) {
  const settings = getPaperSettings(ownerId);
  const isCrypto = input.instrument === "BTCUSDT";
  const balance = isCrypto
    ? settings.startingBalanceUsdt
    : settings.startingBalanceUsd;
  const dailyLossLimit = isCrypto
    ? settings.dailyLossLimitUsdt
    : settings.dailyLossLimitUsd;

  if (balance <= 0 || dailyLossLimit <= 0) {
    throw new JournalConflictError(
      `Set a positive ${isCrypto ? "USDT" : "USD"} paper balance and daily loss limit before paper trading this instrument.`,
    );
  }
  if (input.riskAmount === null) {
    throw new JournalConflictError(
      "Set a planned risk amount for every paper position.",
    );
  }
  const riskCap = (balance * settings.riskPerTradePercent) / 100;
  if (input.riskAmount > riskCap + 1e-9) {
    throw new JournalConflictError(
      `Planned risk exceeds the configured ${settings.riskPerTradePercent}% per-trade limit.`,
    );
  }

  const existing = listTrades(ownerId);
  const paperTrades = existing.filter(
    (trade) => trade.mode === "paper" && trade.status === "open",
  );
  if (paperTrades.length >= settings.maxOpenPositions) {
    throw new JournalConflictError(
      "The configured maximum number of open paper positions has been reached.",
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const todaysLoss = existing
    .filter(
      (trade) =>
        trade.mode === "paper" &&
        (isCrypto
          ? trade.instrument === "BTCUSDT"
          : trade.instrument !== "BTCUSDT") &&
        trade.updatedAt.slice(0, 10) === today,
    )
    .reduce(
      (total, trade) =>
        total + Math.min(0, trade.netRealizedPnl),
      0,
    );
  if (todaysLoss <= -dailyLossLimit) {
    throw new JournalConflictError(
      "The configured daily loss limit has been reached for this instrument's quote currency.",
    );
  }
  if (todaysLoss - input.riskAmount < -dailyLossLimit - 1e-9) {
    throw new JournalConflictError(
      "This paper trade's planned risk would exceed the remaining daily loss limit.",
    );
  }

  const multiplier =
    input.instrument === "NQ" ? 20 : input.instrument === "MNQ" ? 2 : 1;
  const existingExposure = paperTrades
    .filter((trade) =>
      isCrypto
        ? trade.instrument === "BTCUSDT"
        : trade.instrument !== "BTCUSDT",
    )
    .reduce(
      (total, trade) =>
        total +
        trade.openQuantity *
          trade.openAverageEntryPrice *
          (trade.instrument === "NQ" ? 20 : trade.instrument === "MNQ" ? 2 : 1),
      0,
    );
  const nextExposure = existingExposure + input.quantity * input.price * multiplier;
  if (nextExposure > balance * settings.maxLeverage + 1e-9) {
    throw new JournalConflictError(
      "The paper position would exceed the configured maximum leverage.",
    );
  }
}

export function addFill(
  ownerId: string,
  tradeId: string,
  input: CreateFillInput,
): JournalTrade | null {
  const database = getDatabase();
  const now = new Date().toISOString();
  const add = database.transaction(() => {
    const trade = queryTrade(ownerId, tradeId);
    if (!trade) return null;
    if (trade.status === "closed") {
      throw new JournalConflictError("Closed trades cannot receive new fills.");
    }
    if (
      trade.instrument !== "BTCUSDT" &&
      !Number.isInteger(input.quantity)
    ) {
      throw new JournalConflictError(
        "MNQ and NQ contract quantities must be whole numbers.",
      );
    }
    if (input.kind === "exit" && input.quantity > trade.openQuantity + 1e-9) {
      throw new JournalConflictError(
        "Exit quantity cannot exceed the currently open quantity.",
      );
    }
    if (input.kind === "entry" && trade.mode === "paper") {
      const settings = getPaperSettings(ownerId);
      const balance =
        trade.instrument === "BTCUSDT"
          ? settings.startingBalanceUsdt
          : settings.startingBalanceUsd;
      const riskCap = (balance * settings.riskPerTradePercent) / 100;
      if (input.riskAmount === null) {
        throw new JournalConflictError(
          "Set a planned risk amount for every additional paper entry.",
        );
      }
      if ((trade.riskAmount ?? 0) + input.riskAmount > riskCap + 1e-9) {
        throw new JournalConflictError(
          "The additional paper entry would exceed the configured per-trade risk limit.",
        );
      }
      const multiplier =
        trade.instrument === "NQ" ? 20 : trade.instrument === "MNQ" ? 2 : 1;
      const isCrypto = trade.instrument === "BTCUSDT";
      const paperTrades = listTrades(ownerId).filter(
        (candidate) =>
          candidate.mode === "paper" &&
          candidate.status === "open" &&
          (isCrypto
            ? candidate.instrument === "BTCUSDT"
            : candidate.instrument !== "BTCUSDT"),
      );
      const existingExposure = paperTrades.reduce(
        (total, candidate) =>
          total +
          candidate.openQuantity *
            candidate.openAverageEntryPrice *
            (candidate.instrument === "NQ"
              ? 20
              : candidate.instrument === "MNQ"
                ? 2
                : 1),
        0,
      );
      const nextExposure =
        existingExposure + input.quantity * input.price * multiplier;
      if (nextExposure > balance * settings.maxLeverage + 1e-9) {
        throw new JournalConflictError(
          "The additional paper entry would exceed the configured maximum leverage.",
        );
      }
    }

    const lastFillTime = trade.fills.reduce(
      (latest, fill) => Math.max(latest, Date.parse(fill.filledAt)),
      0,
    );
    const requestedFillAt = input.filledAt
      ? Date.parse(input.filledAt)
      : Date.now();
    if (!Number.isFinite(requestedFillAt)) {
      throw new JournalConflictError("Fill timestamp is invalid.");
    }
    if (input.filledAt && requestedFillAt <= lastFillTime) {
      throw new JournalConflictError(
        "A fill cannot be recorded before or at the time of the previous fill.",
      );
    }
    const filledAt = new Date(
      input.filledAt
        ? requestedFillAt
        : Math.max(requestedFillAt, lastFillTime + 1),
    ).toISOString();

    database
      .prepare(
        `INSERT INTO journal_fills
          (id, trade_id, owner_id, kind, quantity, price, fee, risk_amount, filled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        tradeId,
        ownerId,
        input.kind,
        input.quantity,
        input.price,
        input.fee,
        input.riskAmount,
        filledAt,
      );
    if (input.kind === "entry" && trade.mode === "paper") {
      database
        .prepare(
          "UPDATE journal_trades SET risk_amount = COALESCE(risk_amount, 0) + ? WHERE owner_id = ? AND id = ?",
        )
        .run(input.riskAmount, ownerId, tradeId);
    }

    const updated = queryTrade(ownerId, tradeId);
    if (!updated) throw new Error("Updated trade could not be read back.");
    const status = updated.openQuantity <= 1e-9 ? "closed" : "open";
    database
      .prepare(
        "UPDATE journal_trades SET status = ?, updated_at = ? WHERE owner_id = ? AND id = ?",
      )
      .run(status, now, ownerId, tradeId);
  });
  add();
  return queryTrade(ownerId, tradeId);
}
