import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  addFill,
  JournalConflictError,
} from "@/lib/journal/storage";
import { createFillSchema } from "@/lib/journal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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
  const parsed = createFillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Fill details are invalid.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { id } = await context.params;
    const trade = await addFill(session.user.id, id, parsed.data);
    if (!trade) {
      return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    }
    return NextResponse.json({ trade });
  } catch (error) {
    if (error instanceof JournalConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Could not record journal fill", error);
    return NextResponse.json(
      { error: "Fill could not be saved." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
