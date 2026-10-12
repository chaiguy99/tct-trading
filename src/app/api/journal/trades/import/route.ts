import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { importJournalTrades } from "@/lib/journal/storage";
import { importJournalTradesSchema } from "@/lib/journal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_500_000) {
    return NextResponse.json(
      { error: "Import request is too large." },
      { status: 413, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let rawBody: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Request body is missing.");
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 1_500_000) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Import request is too large." },
          { status: 413, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    rawBody = new TextDecoder().decode(bytes);
  } catch {
    return NextResponse.json(
      { error: "Could not read the import request body." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const parsed = importJournalTradesSchema.safeParse(
    typeof body === "object" && body !== null && "trades" in body
      ? body.trades
      : null,
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Import rows are invalid or include non-journal records.",
        details: parsed.error.flatten(),
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const trades = await importJournalTrades(session.user.id, parsed.data);
    return NextResponse.json(
      { imported: trades.length },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Could not import journal trades", error);
    return NextResponse.json(
      { error: "CSV records could not be imported." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
