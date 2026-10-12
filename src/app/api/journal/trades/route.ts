import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  createTrade,
  JournalConflictError,
  listTrades,
} from "@/lib/journal/storage";
import { calculateJournalMetrics } from "@/lib/journal/metrics";
import { createTradeSchema } from "@/lib/journal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const trades = await listTrades(session.user.id);
    return NextResponse.json(
      { trades, metrics: calculateJournalMetrics(trades) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Could not load journal trades", error);
    return NextResponse.json(
      { error: "Journal data could not be loaded." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }
  const parsed = createTradeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Trade details are invalid.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const trade = await createTrade(session.user.id, parsed.data);
    return NextResponse.json({ trade }, { status: 201 });
  } catch (error) {
    if (error instanceof JournalConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Could not create journal trade", error);
    return NextResponse.json(
      { error: "Trade could not be saved." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
