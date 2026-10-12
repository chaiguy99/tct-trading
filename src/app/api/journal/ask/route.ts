import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  askJournalAi,
  createJournalAiContext,
  getJournalAiConfig,
  journalAiRequestSchema,
} from "@/lib/journal/ai";
import { listTrades } from "@/lib/journal/storage";
import { calculateJournalMetrics } from "@/lib/journal/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return privateJson({ error: "Unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "Invalid JSON request body." }, 400);
  }
  const parsed = journalAiRequestSchema.safeParse(body);
  if (!parsed.success) {
    return privateJson(
      {
        error: "A question and explicit data-sharing consent are required.",
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  let configured = false;
  try {
    configured = getJournalAiConfig() !== null;
  } catch (error) {
    console.error("Journal AI configuration is invalid", error);
    return privateJson({ error: "Journal AI is misconfigured." }, 503);
  }
  if (!configured) {
    return privateJson(
      { error: "Journal AI is not configured on this server." },
      503,
    );
  }

  try {
    const trades = await listTrades(session.user.id);
    const context = createJournalAiContext(
      trades,
      calculateJournalMetrics(trades),
    );
    const answer = await askJournalAi(parsed.data.question, context);
    return privateJson({ answer, analyzedTrades: context.trades.length });
  } catch (error) {
    console.error("Journal AI request failed", error);
    return privateJson(
      { error: "The AI service could not answer this question." },
      502,
    );
  }
}
