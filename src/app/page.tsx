import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Dashboard from "@/components/dashboard";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  return <Dashboard email={session.user.email ?? ""} />;
}
