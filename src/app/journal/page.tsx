import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Journal from "@/components/journal";
import { authOptions } from "@/lib/auth";
import { getJournalAiConfig } from "@/lib/journal/ai";

export default async function JournalPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }

  const aiConfig = getJournalAiConfig();
  return (
    <Journal
      aiProviderLabel={aiConfig?.providerLabel ?? null}
      email={session.user.email ?? ""}
      storageLabel={process.env.DATABASE_URL ? "Hosted Postgres" : "Local SQLite"}
    />
  );
}
