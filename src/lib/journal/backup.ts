import type {
  JournalMetrics,
  JournalTrade,
  PaperSettings,
} from "./types";
import { calculateJournalMetrics } from "./metrics";

export const journalBackupVersion = 1;

export function createJournalBackup(
  exportedAt: string,
  trades: JournalTrade[],
  settings: PaperSettings,
) {
  return {
    format: "tct-journal-backup",
    version: journalBackupVersion,
    exportedAt,
    trades,
    settings,
    metrics: calculateJournalMetrics(trades) satisfies JournalMetrics,
  };
}
