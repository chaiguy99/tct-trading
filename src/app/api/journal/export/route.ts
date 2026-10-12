import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createJournalBackup } from "@/lib/journal/backup";
import { getPaperSettings, listTrades } from "@/lib/journal/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const backup = createJournalBackup(
      new Date().toISOString(),
      await listTrades(session.user.id),
      await getPaperSettings(session.user.id),
    );
    const date = backup.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="tct-journal-backup-${date}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Could not export journal backup", error);
    return NextResponse.json(
      { error: "Journal backup could not be created." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
