import postgres, { type Sql, type TransactionSql } from "postgres";
import { randomUUID } from "node:crypto";
import type {
  CreateFillInput,
  CreateTradeInput,
  ImportJournalTradeInput,
  ImportJournalTradesInput,
  JournalTrade,
  PaperSettings,
  TradeFill,
} from "./types";
import { JournalConflictError } from "./errors";

type Db = Sql | TransactionSql;

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
  created_at: Date | string;
  updated_at: Date | string;
};

type FillRow = {
  id: string;
  kind: "entry" | "exit";
  quantity: number;
  price: number;
  fee: number;
  risk_amount: number | null;
  filled_at: Date | string;
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
  var tctPostgres: Sql | undefined;
}

function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for hosted journal storage.");
  }
  if (!globalThis.tctPostgres) {
    globalThis.tctPostgres = postgres(connectionString, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: "require",
    });
  }
  return globalThis.tctPostgres;
}

function asNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTrade(row: TradeRow, rows: FillRow[]): JournalTrade {
  const fills: TradeFill[] = rows.map((fill) => ({
    id: fill.id,
    kind: fill.kind,
    quantity: asNumber(fill.quantity),
    price: asNumber(fill.price),
    fee: asNumber(fill.fee),
    riskAmount: fill.risk_amount === null ? null : asNumber(fill.risk_amount),
    filledAt: asIso(fill.filled_at),
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
        direction * (fill.price - averageCost) * fill.quantity * pointValue;
      const allocatedEntryFees =
        positionEntryFees * (fill.quantity / positionQuantity);
      realizedFees += fill.fee + allocatedEntryFees;
      positionEntryFees -= allocatedEntryFees;
      positionQuantity -= fill.quantity;
      positionCost = Math.max(0, positionCost - averageCost * fill.quantity);
    }
  }
  const fees = fills.reduce((sum, fill) => sum + fill.fee, 0);
  const funding = asNumber(row.funding);
  const riskAmount =
    row.risk_amount === null ? null : asNumber(row.risk_amount);
  const realizedFunding =
    row.status === "closed"
      ? funding
      : enteredQuantity > 0
        ? funding * (exitedQuantity / enteredQuantity)
        : 0;
  const netRealizedPnl = grossRealizedPnl - realizedFees + realizedFunding;

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
    riskAmount,
    funding,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
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
      riskAmount && row.status === "closed" ? netRealizedPnl / riskAmount : null,
  };
}

async function queryTrade(
  db: Db,
  ownerId: string,
  tradeId: string,
): Promise<JournalTrade | null> {
  const [row] = (await db`
    SELECT id, instrument, side, mode, status, setup, market_condition,
           thesis, notes, risk_amount, funding, created_at, updated_at
      FROM journal_trades WHERE owner_id = ${ownerId} AND id = ${tradeId}
  `) as unknown as TradeRow[];
  if (!row) return null;
  const fills = (await db`
    SELECT id, kind, quantity, price, fee, risk_amount, filled_at
      FROM journal_fills
     WHERE owner_id = ${ownerId} AND trade_id = ${tradeId}
     ORDER BY filled_at, CASE kind WHEN 'entry' THEN 0 ELSE 1 END, id
  `) as unknown as FillRow[];
  return mapTrade(row, fills);
}

async function listTradesWithDb(db: Db, ownerId: string): Promise<JournalTrade[]> {
  const rows = (await db`
    SELECT id, instrument, side, mode, status, setup, market_condition,
           thesis, notes, risk_amount, funding, created_at, updated_at
      FROM journal_trades WHERE owner_id = ${ownerId}
     ORDER BY updated_at DESC, id
  `) as unknown as TradeRow[];
  const trades: JournalTrade[] = [];
  for (const row of rows) {
    const fills = (await db`
      SELECT id, kind, quantity, price, fee, risk_amount, filled_at
        FROM journal_fills
       WHERE owner_id = ${ownerId} AND trade_id = ${row.id}
       ORDER BY filled_at, CASE kind WHEN 'entry' THEN 0 ELSE 1 END, id
    `) as unknown as FillRow[];
    trades.push(mapTrade(row, fills));
  }
  return trades;
}

export async function listTrades(ownerId: string): Promise<JournalTrade[]> {
  return listTradesWithDb(getDatabase(), ownerId);
}

async function getPaperSettingsWithDb(
  db: Db,
  ownerId: string,
): Promise<PaperSettings> {
  await db`
    INSERT INTO paper_settings (owner_id) VALUES (${ownerId})
    ON CONFLICT (owner_id) DO NOTHING
  `;
  const [row] = (await db`
    SELECT starting_balance_usd, starting_balance_usdt,
           risk_per_trade_percent, daily_loss_limit_usd,
           daily_loss_limit_usdt, max_open_positions, max_leverage
      FROM paper_settings WHERE owner_id = ${ownerId}
  `) as unknown as SettingsRow[];
  if (!row) throw new Error("Paper settings could not be loaded.");
  return {
    startingBalanceUsd: asNumber(row.starting_balance_usd),
    startingBalanceUsdt: asNumber(row.starting_balance_usdt),
    riskPerTradePercent: asNumber(row.risk_per_trade_percent),
    dailyLossLimitUsd: asNumber(row.daily_loss_limit_usd),
    dailyLossLimitUsdt: asNumber(row.daily_loss_limit_usdt),
    maxOpenPositions: asNumber(row.max_open_positions),
    maxLeverage: asNumber(row.max_leverage),
  };
}

export async function getPaperSettings(ownerId: string): Promise<PaperSettings> {
  return getPaperSettingsWithDb(getDatabase(), ownerId);
}

export async function savePaperSettings(
  ownerId: string,
  settings: PaperSettings,
): Promise<PaperSettings> {
  const db = getDatabase();
  await db`
    INSERT INTO paper_settings (
      owner_id, starting_balance_usd, starting_balance_usdt,
      risk_per_trade_percent, daily_loss_limit_usd,
      daily_loss_limit_usdt, max_open_positions, max_leverage
    ) VALUES (
      ${ownerId}, ${settings.startingBalanceUsd}, ${settings.startingBalanceUsdt},
      ${settings.riskPerTradePercent}, ${settings.dailyLossLimitUsd},
      ${settings.dailyLossLimitUsdt}, ${settings.maxOpenPositions}, ${settings.maxLeverage}
    )
    ON CONFLICT (owner_id) DO UPDATE SET
      starting_balance_usd = EXCLUDED.starting_balance_usd,
      starting_balance_usdt = EXCLUDED.starting_balance_usdt,
      risk_per_trade_percent = EXCLUDED.risk_per_trade_percent,
      daily_loss_limit_usd = EXCLUDED.daily_loss_limit_usd,
      daily_loss_limit_usdt = EXCLUDED.daily_loss_limit_usdt,
      max_open_positions = EXCLUDED.max_open_positions,
      max_leverage = EXCLUDED.max_leverage
  `;
  return getPaperSettingsWithDb(db, ownerId);
}

async function assertPaperTradeAllowed(
  db: Db,
  ownerId: string,
  input: CreateTradeInput,
): Promise<void> {
  const settings = await getPaperSettingsWithDb(db, ownerId);
  const crypto = input.instrument === "BTCUSDT";
  const balance = crypto
    ? settings.startingBalanceUsdt
    : settings.startingBalanceUsd;
  const dailyLossLimit = crypto
    ? settings.dailyLossLimitUsdt
    : settings.dailyLossLimitUsd;
  if (balance <= 0 || dailyLossLimit <= 0) {
    throw new JournalConflictError(
      `Set a positive ${crypto ? "USDT" : "USD"} paper balance and daily loss limit before paper trading this instrument.`,
    );
  }
  if (input.riskAmount === null) {
    throw new JournalConflictError("Set a planned risk amount for every paper position.");
  }
  const riskCap = (balance * settings.riskPerTradePercent) / 100;
  if (input.riskAmount > riskCap + 1e-9) {
    throw new JournalConflictError(
      `Planned risk exceeds the configured ${settings.riskPerTradePercent}% per-trade limit.`,
    );
  }
  const existing = await listTradesWithDb(db, ownerId);
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
        (crypto
          ? trade.instrument === "BTCUSDT"
          : trade.instrument !== "BTCUSDT") &&
        trade.updatedAt.slice(0, 10) === today,
    )
    .reduce((total, trade) => total + Math.min(0, trade.netRealizedPnl), 0);
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
  const exposure = paperTrades
    .filter((trade) =>
      crypto
        ? trade.instrument === "BTCUSDT"
        : trade.instrument !== "BTCUSDT",
    )
    .reduce(
      (sum, trade) =>
        sum +
        trade.openQuantity *
          trade.openAverageEntryPrice *
          (trade.instrument === "NQ" ? 20 : trade.instrument === "MNQ" ? 2 : 1),
      0,
    );
  const multiplier =
    input.instrument === "NQ" ? 20 : input.instrument === "MNQ" ? 2 : 1;
  if (exposure + input.quantity * input.price * multiplier > balance * settings.maxLeverage + 1e-9) {
    throw new JournalConflictError(
      "The paper position would exceed the configured maximum leverage.",
    );
  }
}

async function insertTrade(
  db: Db,
  ownerId: string,
  input: CreateTradeInput | ImportJournalTradeInput,
): Promise<string> {
  if (input.mode === "paper") {
    await assertPaperTradeAllowed(db, ownerId, input);
  }
  const tradeId = randomUUID();
  const now = new Date();
  const entryAt = input.filledAt ? new Date(input.filledAt) : now;
  await db`
    INSERT INTO journal_trades (
      id, owner_id, instrument, side, mode, status, setup, market_condition,
      thesis, notes, risk_amount, funding, created_at, updated_at
    ) VALUES (
      ${tradeId}, ${ownerId}, ${input.instrument}, ${input.side}, ${input.mode},
      'open', ${input.setup}, ${input.marketCondition}, ${input.thesis}, ${input.notes},
      ${input.riskAmount}, ${input.funding}, ${now}, ${now}
    )
  `;
  await db`
    INSERT INTO journal_fills
      (id, trade_id, owner_id, kind, quantity, price, fee, risk_amount, filled_at)
    VALUES (
      ${randomUUID()}, ${tradeId}, ${ownerId}, 'entry', ${input.quantity},
      ${input.price}, ${input.fee}, ${input.riskAmount}, ${entryAt}
    )
  `;
  if ("exit" in input && input.exit) {
    const exitAt = input.exit.filledAt
      ? new Date(input.exit.filledAt)
      : new Date(entryAt.getTime() + 1);
    await db`
      INSERT INTO journal_fills
        (id, trade_id, owner_id, kind, quantity, price, fee, risk_amount, filled_at)
      VALUES (
        ${randomUUID()}, ${tradeId}, ${ownerId}, 'exit', ${input.exit.quantity},
        ${input.exit.price}, ${input.exit.fee}, NULL, ${exitAt}
      )
    `;
    if (input.exit.quantity >= input.quantity - 1e-9) {
      await db`
        UPDATE journal_trades SET status = 'closed'
         WHERE owner_id = ${ownerId} AND id = ${tradeId}
      `;
    }
  }
  return tradeId;
}

export async function createTrade(
  ownerId: string,
  input: CreateTradeInput,
): Promise<JournalTrade> {
  const db = getDatabase();
  const tradeId = await db.begin(async (tx) => {
    if (input.mode === "paper") {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
    }
    return insertTrade(tx, ownerId, input);
  });
  const trade = await queryTrade(db, ownerId, tradeId);
  if (!trade) throw new Error("Created trade could not be read back.");
  return trade;
}

export async function importJournalTrades(
  ownerId: string,
  inputs: ImportJournalTradesInput,
): Promise<JournalTrade[]> {
  const db = getDatabase();
  const ids = await db.begin(async (tx) => {
    const result: string[] = [];
    for (const input of inputs) {
      if (input.mode !== "journal") {
        throw new Error("CSV imports may only create journal records.");
      }
      result.push(await insertTrade(tx, ownerId, input));
    }
    return result;
  });
  const trades: JournalTrade[] = [];
  for (const id of ids) {
    const trade = await queryTrade(db, ownerId, id);
    if (!trade) throw new Error("Imported trade could not be read back.");
    trades.push(trade);
  }
  return trades;
}

export async function addFill(
  ownerId: string,
  tradeId: string,
  input: CreateFillInput,
): Promise<JournalTrade | null> {
  const db = getDatabase();
  const found = await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
    const trade = await queryTrade(tx, ownerId, tradeId);
    if (!trade) return false;
    if (trade.status === "closed") {
      throw new JournalConflictError("Closed trades cannot receive new fills.");
    }
    if (trade.instrument !== "BTCUSDT" && !Number.isInteger(input.quantity)) {
      throw new JournalConflictError("MNQ and NQ contract quantities must be whole numbers.");
    }
    if (input.kind === "exit" && input.quantity > trade.openQuantity + 1e-9) {
      throw new JournalConflictError(
        "Exit quantity cannot exceed the currently open quantity.",
      );
    }
    if (input.kind === "entry" && trade.mode === "paper") {
      const settings = await getPaperSettingsWithDb(tx, ownerId);
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
      const allTrades = await listTradesWithDb(tx, ownerId);
      const paperTrades = allTrades.filter(
        (candidate) =>
          candidate.mode === "paper" &&
          candidate.status === "open" &&
          (trade.instrument === "BTCUSDT"
            ? candidate.instrument === "BTCUSDT"
            : candidate.instrument !== "BTCUSDT"),
      );
      const exposure = paperTrades.reduce(
        (sum, candidate) =>
          sum +
          candidate.openQuantity *
            candidate.openAverageEntryPrice *
            (candidate.instrument === "NQ"
              ? 20
              : candidate.instrument === "MNQ"
                ? 2
                : 1),
        0,
      );
      const multiplier =
        trade.instrument === "NQ" ? 20 : trade.instrument === "MNQ" ? 2 : 1;
      if (exposure + input.quantity * input.price * multiplier > balance * settings.maxLeverage + 1e-9) {
        throw new JournalConflictError(
          "The additional paper entry would exceed the configured maximum leverage.",
        );
      }
    }
    const latest = trade.fills.reduce(
      (value, fill) => Math.max(value, Date.parse(fill.filledAt)),
      0,
    );
    const requestedAt = input.filledAt
      ? Date.parse(input.filledAt)
      : Math.max(Date.now(), latest + 1);
    if (!Number.isFinite(requestedAt)) {
      throw new JournalConflictError("Fill timestamp is invalid.");
    }
    if (input.filledAt && requestedAt <= latest) {
      throw new JournalConflictError(
        "A fill cannot be recorded before or at the time of the previous fill.",
      );
    }
    await tx`
      INSERT INTO journal_fills
        (id, trade_id, owner_id, kind, quantity, price, fee, risk_amount, filled_at)
      VALUES (
        ${randomUUID()}, ${tradeId}, ${ownerId}, ${input.kind}, ${input.quantity},
        ${input.price}, ${input.fee}, ${input.riskAmount}, ${new Date(requestedAt)}
      )
    `;
    if (input.kind === "entry" && trade.mode === "paper") {
      await tx`
        UPDATE journal_trades
           SET risk_amount = COALESCE(risk_amount, 0) + ${input.riskAmount}
         WHERE owner_id = ${ownerId} AND id = ${tradeId}
      `;
    }
    const updated = await queryTrade(tx, ownerId, tradeId);
    if (!updated) throw new Error("Updated trade could not be read back.");
    await tx`
      UPDATE journal_trades
         SET status = ${updated.openQuantity <= 1e-9 ? "closed" : "open"},
             updated_at = ${new Date()}
       WHERE owner_id = ${ownerId} AND id = ${tradeId}
    `;
    return true;
  });
  return found ? queryTrade(db, ownerId, tradeId) : null;
}
