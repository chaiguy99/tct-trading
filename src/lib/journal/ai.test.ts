import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  askJournalAi,
  createJournalAiContext,
  getJournalAiConfig,
  journalAiRequestSchema,
} from "./ai";
import type { JournalMetrics, JournalTrade } from "./types";

const metrics: JournalMetrics = {
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
};

function trade(index: number): JournalTrade {
  return {
    id: `trade-${index}`,
    instrument: "MNQ",
    side: "long",
    mode: "journal",
    status: "closed",
    setup: "setup",
    marketCondition: "trend",
    thesis: "thesis",
    notes: "notes",
    riskAmount: 10,
    funding: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    fills: [{
      id: `fill-${index}`,
      kind: "entry",
      quantity: 1,
      price: 100,
      fee: 0,
      riskAmount: null,
      filledAt: new Date(0).toISOString(),
    }],
    enteredQuantity: 1,
    exitedQuantity: 1,
    openQuantity: 0,
    averageEntryPrice: 100,
    openAverageEntryPrice: 0,
    grossRealizedPnl: 10,
    fees: 0,
    netRealizedPnl: 10,
    rMultiple: 1,
  };
}

test("journal AI stays disabled without endpoint configuration", () => {
  const previous = {
    baseUrl: process.env.JOURNAL_AI_BASE_URL,
    model: process.env.JOURNAL_AI_MODEL,
    apiKey: process.env.JOURNAL_AI_API_KEY,
  };
  delete process.env.JOURNAL_AI_BASE_URL;
  delete process.env.JOURNAL_AI_MODEL;
  delete process.env.JOURNAL_AI_API_KEY;
  try {
    assert.equal(getJournalAiConfig(), null);
  } finally {
    if (previous.baseUrl === undefined) delete process.env.JOURNAL_AI_BASE_URL;
    else process.env.JOURNAL_AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.JOURNAL_AI_MODEL;
    else process.env.JOURNAL_AI_MODEL = previous.model;
    if (previous.apiKey === undefined) delete process.env.JOURNAL_AI_API_KEY;
    else process.env.JOURNAL_AI_API_KEY = previous.apiKey;
  }
});

test("journal AI requires explicit consent for each request", () => {
  assert.equal(
    journalAiRequestSchema.safeParse({
      question: "How did I do?",
      consent: false,
    }).success,
    false,
  );
  assert.equal(
    journalAiRequestSchema.safeParse({
      question: "How did I do?",
      consent: true,
    }).success,
    true,
  );
});

test("journal AI requires secure remote endpoints and supports loopback providers", () => {
  const previous = {
    baseUrl: process.env.JOURNAL_AI_BASE_URL,
    model: process.env.JOURNAL_AI_MODEL,
    apiKey: process.env.JOURNAL_AI_API_KEY,
  };
  try {
    process.env.JOURNAL_AI_BASE_URL = "https://example.test/v1";
    process.env.JOURNAL_AI_MODEL = "test-model";
    delete process.env.JOURNAL_AI_API_KEY;
    assert.throws(() => getJournalAiConfig(), /API_KEY is required/);
    process.env.JOURNAL_AI_BASE_URL = "http://example.test/v1";
    assert.throws(() => getJournalAiConfig(), /must use HTTPS/);
    process.env.JOURNAL_AI_BASE_URL = "http://localhost:11434/v1";
    assert.equal(getJournalAiConfig()?.providerLabel, "local model at localhost:11434");
  } finally {
    if (previous.baseUrl === undefined) delete process.env.JOURNAL_AI_BASE_URL;
    else process.env.JOURNAL_AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.JOURNAL_AI_MODEL;
    else process.env.JOURNAL_AI_MODEL = previous.model;
    if (previous.apiKey === undefined) delete process.env.JOURNAL_AI_API_KEY;
    else process.env.JOURNAL_AI_API_KEY = previous.apiKey;
  }
});

test("journal AI context bounds recent records and omits internal fill IDs", () => {
  const context = createJournalAiContext(
    Array.from({ length: 55 }, (_, index) => trade(index)),
    metrics,
  );
  assert.equal(context.trades.length, 50);
  assert.equal(context.trades[0].id, "trade-0");
  assert.match(context.coverage, /50 of 55 trades/);
  assert.equal("id" in context.trades[0].fills[0]!, false);
});

test("journal AI calls the configured OpenAI-compatible chat endpoint", async () => {
  const previous = {
    baseUrl: process.env.JOURNAL_AI_BASE_URL,
    model: process.env.JOURNAL_AI_MODEL,
    apiKey: process.env.JOURNAL_AI_API_KEY,
  };
  let receivedBody = "";
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      receivedBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: "Your journal answer." } }],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    process.env.JOURNAL_AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.JOURNAL_AI_MODEL = "test-model";
    delete process.env.JOURNAL_AI_API_KEY;
    const answer = await askJournalAi("How did I do?", { trades: [] });
    assert.equal(answer, "Your journal answer.");
    const payload = JSON.parse(receivedBody) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(payload.model, "test-model");
    assert.match(payload.messages[1].content, /How did I do/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    if (previous.baseUrl === undefined) delete process.env.JOURNAL_AI_BASE_URL;
    else process.env.JOURNAL_AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.JOURNAL_AI_MODEL;
    else process.env.JOURNAL_AI_MODEL = previous.model;
    if (previous.apiKey === undefined) delete process.env.JOURNAL_AI_API_KEY;
    else process.env.JOURNAL_AI_API_KEY = previous.apiKey;
  }
});
