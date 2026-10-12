import { z } from "zod";

export const instrumentSchema = z.enum(["MNQ", "NQ", "BTCUSDT"]);
export const sideSchema = z.enum(["long", "short"]);
export const modeSchema = z.enum(["journal", "paper"]);
export const fillKindSchema = z.enum(["entry", "exit"]);

export const createTradeSchema = z.object({
  instrument: instrumentSchema,
  side: sideSchema,
  mode: modeSchema,
  quantity: z.number().finite().positive().max(1_000_000),
  price: z.number().finite().positive().max(100_000_000),
  fee: z.number().finite().min(0).max(1_000_000).default(0),
  riskAmount: z.number().finite().positive().max(1_000_000_000).nullable().default(null),
  funding: z.number().finite().min(-1_000_000).max(1_000_000).default(0),
  setup: z.string().trim().max(120).default(""),
  marketCondition: z.string().trim().max(120).default(""),
  thesis: z.string().trim().max(4_000).default(""),
  notes: z.string().trim().max(4_000).default(""),
  filledAt: z.iso.datetime({ offset: true }).optional(),
}).superRefine((trade, context) => {
  if (trade.instrument !== "BTCUSDT" && !Number.isInteger(trade.quantity)) {
    context.addIssue({
      code: "custom",
      message: "MNQ and NQ contract quantities must be whole numbers.",
      path: ["quantity"],
    });
  }
});

export const importedJournalTradeSchema = createTradeSchema
  .extend({
    exit: z
      .object({
        quantity: z.number().finite().positive().max(1_000_000),
        price: z.number().finite().positive().max(100_000_000),
        fee: z.number().finite().min(0).max(1_000_000).default(0),
        filledAt: z.iso.datetime({ offset: true }).optional(),
      })
      .optional(),
  })
  .superRefine((trade, context) => {
    if (trade.mode !== "journal") {
      context.addIssue({
        code: "custom",
        message: "CSV imports are journal records only; paper mode is not allowed.",
        path: ["mode"],
      });
    }
    if (trade.exit && trade.exit.quantity > trade.quantity) {
      context.addIssue({
        code: "custom",
        message: "Exit quantity cannot exceed entry quantity.",
        path: ["exit", "quantity"],
      });
    }
    if (
      trade.instrument !== "BTCUSDT" &&
      trade.exit &&
      !Number.isInteger(trade.exit.quantity)
    ) {
      context.addIssue({
        code: "custom",
        message: "MNQ and NQ exit quantities must be whole numbers.",
        path: ["exit", "quantity"],
      });
    }
    if (trade.exit?.filledAt && !trade.filledAt) {
      context.addIssue({
        code: "custom",
        message: "Entry time is required when an exit time is provided.",
        path: ["filledAt"],
      });
    }
    if (
      trade.exit?.filledAt &&
      trade.filledAt &&
      Date.parse(trade.exit.filledAt) <= Date.parse(trade.filledAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Exit time must be after entry time.",
        path: ["exit", "filledAt"],
      });
    }
  });

export const importJournalTradesSchema = z
  .array(importedJournalTradeSchema)
  .min(1)
  .max(500);

export const createFillSchema = z.object({
  kind: fillKindSchema,
  quantity: z.number().finite().positive().max(1_000_000),
  price: z.number().finite().positive().max(100_000_000),
  fee: z.number().finite().min(0).max(1_000_000).default(0),
  riskAmount: z.number().finite().positive().max(1_000_000_000).nullable().default(null),
  filledAt: z.iso.datetime({ offset: true }).optional(),
});

export const paperSettingsSchema = z.object({
  startingBalanceUsd: z.number().finite().min(0).max(1_000_000_000),
  startingBalanceUsdt: z.number().finite().min(0).max(1_000_000_000),
  riskPerTradePercent: z.number().finite().min(0.01).max(5),
  dailyLossLimitUsd: z.number().finite().min(0).max(1_000_000_000),
  dailyLossLimitUsdt: z.number().finite().min(0).max(1_000_000_000),
  maxOpenPositions: z.number().int().min(1).max(50),
  maxLeverage: z.number().finite().min(1).max(100),
});

export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type ImportJournalTradeInput = z.infer<typeof importedJournalTradeSchema>;
export type ImportJournalTradesInput = z.infer<typeof importJournalTradesSchema>;
export type CreateFillInput = z.infer<typeof createFillSchema>;
export type PaperSettings = z.infer<typeof paperSettingsSchema>;

export type TradeFill = {
  id: string;
  kind: "entry" | "exit";
  quantity: number;
  price: number;
  fee: number;
  riskAmount: number | null;
  filledAt: string;
};

export type JournalTrade = {
  id: string;
  instrument: z.infer<typeof instrumentSchema>;
  side: z.infer<typeof sideSchema>;
  mode: z.infer<typeof modeSchema>;
  status: "open" | "closed";
  setup: string;
  marketCondition: string;
  thesis: string;
  notes: string;
  riskAmount: number | null;
  funding: number;
  createdAt: string;
  updatedAt: string;
  fills: TradeFill[];
  enteredQuantity: number;
  exitedQuantity: number;
  openQuantity: number;
  averageEntryPrice: number;
  openAverageEntryPrice: number;
  grossRealizedPnl: number;
  fees: number;
  netRealizedPnl: number;
  rMultiple: number | null;
};

export type JournalMetrics = {
  closedTrades: number;
  openTrades: number;
  winRate: number | null;
  byCurrency: Record<
    "USD" | "USDT",
    {
      netRealizedPnl: number;
      expectancy: number | null;
      profitFactor: number | null;
      maxDrawdown: number;
    }
  >;
};
