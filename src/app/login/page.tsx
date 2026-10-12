import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginForm from "@/components/login-form";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/");
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          T
        </div>
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1 id="login-title">Welcome back.</h1>
        <p className="login-copy">
          Sign in to your trading journal and research workspace.
        </p>
        <LoginForm />
        <p className="login-footnote">
          Access is restricted to the account configured by the workspace
          owner. There is no public sign-up.
        </p>
      </section>
      <aside className="login-aside" aria-label="Workspace principles">
        <div className="aside-topline">
          <span className="status-dot" />
          PRIVATE BY DESIGN
        </div>
        <div>
          <p className="eyebrow">MEASURE THE PROCESS</p>
          <h2>Research with discipline.</h2>
          <p>
            Read-only market data. Simulated execution only. No orders are sent
            to your broker or exchange.
          </p>
        </div>
        <div className="aside-meta">
          <span>MNQ / NQ</span>
          <span>BTCUSDT PERPETUAL</span>
        </div>
      </aside>
    </main>
  );
}
