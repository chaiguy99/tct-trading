import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getBybitSnapshot, MarketDataError } from "@/lib/market-data/bybit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await getBybitSnapshot(
      request.nextUrl.searchParams.get("interval"),
    );
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof MarketDataError) {
      return NextResponse.json(
        { error: error.message },
        { status: 502, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    console.error("Unexpected Bybit market-data failure", error);
    return NextResponse.json(
      { error: "Market data could not be loaded. Check server logs." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
