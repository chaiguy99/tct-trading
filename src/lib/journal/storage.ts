import type {
  CreateFillInput,
  CreateTradeInput,
  ImportJournalTradesInput,
  JournalTrade,
  PaperSettings,
} from "./types";
import { JournalConflictError } from "./errors";

export { JournalConflictError };

function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function listTrades(ownerId: string): Promise<JournalTrade[]> {
  if (isPostgresConfigured()) {
    return (await import("./postgres")).listTrades(ownerId);
  }
  return (await import("./database")).listTrades(ownerId);
}

export async function createTrade(
  ownerId: string,
  input: CreateTradeInput,
): Promise<JournalTrade> {
  if (isPostgresConfigured()) {
    return (await import("./postgres")).createTrade(ownerId, input);
  }
  return (await import("./database")).createTrade(ownerId, input);
}

export async function importJournalTrades(
  ownerId: string,
  input: ImportJournalTradesInput,
): Promise<JournalTrade[]> {
  if (isPostgresConfigured()) {
    return (await import("./postgres")).importJournalTrades(ownerId, input);
  }
  return (await import("./database")).importJournalTrades(ownerId, input);
}

export async function addFill(
  ownerId: string,
  tradeId: string,
  input: CreateFillInput,
): Promise<JournalTrade | null> {
  if (isPostgresConfigured()) {
    return (await import("./postgres")).addFill(ownerId, tradeId, input);
  }
  return (await import("./database")).addFill(ownerId, tradeId, input);
}

export async function getPaperSettings(
  ownerId: string,
): Promise<PaperSettings> {
  if (isPostgresConfigured()) {
    return (await import("./postgres")).getPaperSettings(ownerId);
  }
  return (await import("./database")).getPaperSettings(ownerId);
}

export async function savePaperSettings(
  ownerId: string,
  settings: PaperSettings,
): Promise<PaperSettings> {
  if (isPostgresConfigured()) {
    return (await import("./postgres")).savePaperSettings(ownerId, settings);
  }
  return (await import("./database")).savePaperSettings(ownerId, settings);
}
