import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getPaperSettings,
  savePaperSettings,
} from "@/lib/journal/storage";
import { paperSettingsSchema } from "@/lib/journal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(
      { settings: await getPaperSettings(session.user.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Could not load paper settings", error);
    return NextResponse.json(
      { error: "Paper settings could not be loaded." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
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
  const parsed = paperSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Paper settings are invalid.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      settings: await savePaperSettings(session.user.id, parsed.data),
    });
  } catch (error) {
    console.error("Could not save paper settings", error);
    return NextResponse.json(
      { error: "Paper settings could not be saved." },
      { status: 500 },
    );
  }
}
