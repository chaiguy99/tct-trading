"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BybitSnapshot } from "@/lib/market-data/bybit";

type MarketState =
  | { status: "loading" }
  | { status: "ready"; data: BybitSnapshot }
  | { status: "stale"; data: BybitSnapshot; message: string }
  | { status: "error"; message: string };

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatLocalTime(value: number, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(value);
}

function formatLocalDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
    .format(value)
    .toUpperCase();
}

function MiniChart({ data }: { data: BybitSnapshot }) {
  const points = useMemo(() => {
    const candles = data.candles.slice(-48);
    if (candles.length < 2) return "";
    const low = Math.min(...candles.map((candle) => candle.low));
    const high = Math.max(...candles.map((candle) => candle.high));
    const range = high - low || 1;
    return candles
      .map((candle, index) => {
        const x = (index / (candles.length - 1)) * 100;
        const y = 92 - ((candle.close - low) / range) * 84;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data.candles]);

  const positive = data.candles.at(-1)!.close >= data.candles[0].close;

  return (
    <svg
      aria-label={`BTCUSDT ${positive ? "rising" : "falling"} price chart`}
      className={`mini-chart ${positive ? "chart-positive" : "chart-negative"}`}
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 100 100"
    >
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${points} 100,100`} fill="url(#chartFill)" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function useBybitMarket() {
  const [state, setState] = useState<MarketState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/market/bybit?interval=5", {
          cache: "no-store",
        });
        const body = (await response.json()) as
          | BybitSnapshot
          | { error: string };

        if (!response.ok || "error" in body) {
          throw new Error(
            "error" in body ? body.error : "Market data is unavailable.",
          );
        }

        if (active) setState({ status: "ready", data: body });
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : "Market data is unavailable.";
          setState((current) =>
            current.status === "ready" || current.status === "stale"
              ? { status: "stale", data: current.data, message }
              : { status: "error", message },
          );
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}

export default function Dashboard({ email }: { email: string }) {
  const market = useBybitMarket();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="TCT Research home">
          <span className="brand-mark">T</span>
          <span className="brand-name">
            TCT<span>RESEARCH</span>
          </span>
        </Link>
        <p className="nav-label">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-link nav-link-active" href="#overview">
            <span className="nav-icon">◫</span> Overview
          </a>
          <a className="nav-link" href="#markets">
            <span className="nav-icon">⌁</span> Markets
          </a>
          <Link className="nav-link" href="/journal">
            <span className="nav-icon">▤</span> Journal
          </Link>
          <a className="nav-link nav-link-muted" href="#research">
            <span className="nav-icon">⌕</span> Research
            <span className="soon-tag">NEXT</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="execution-note">
            <span className="execution-icon">◉</span>
            <div>
              <strong>Paper mode only</strong>
              <span>No live order routing</span>
            </div>
          </div>
          <div className="account-row">
            <span className="avatar">{email.slice(0, 1).toUpperCase()}</span>
            <span className="account-email">{email}</span>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              title="Sign out"
              type="button"
            >
              ↗
            </button>
          </div>
        </div>
      </aside>

      <section className="main-panel" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>Overview</strong>
          </div>
          <div className="topbar-right">
            <span className="live-indicator">
              <span className="status-dot" />
              READ-ONLY DATA
            </span>
            <span className="topbar-date">
              {now ? formatLocalTime(now) : "Local time"}
            </span>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {now ? formatLocalDate(now) : "LOCAL DATE"}
              </p>
              <h1>Good to see you.</h1>
              <p className="page-subtitle">
                A clear view of your market data and research workspace.
              </p>
            </div>
            <div className="timezone-chip">
              <span className="timezone-marker">◎</span>
              <span>
                <strong>New York session</strong>
                <small>
                  {now ? formatLocalTime(now, "America/New_York") : "—"}
                </small>
              </span>
            </div>
          </div>

          <section aria-label="Market status" className="market-status-grid">
            <article className="status-card status-card-featured">
              <div className="card-heading">
                <span className="instrument-label">
                  <span className="coin-mark">₿</span>
                  CRYPTO · LINEAR PERPETUAL
                </span>
                <span
                  className={`connection-pill ${
                    market.status === "ready" ? "pill-live" : "pill-neutral"
                  }`}
                >
                  <span className="status-dot" />
                  {market.status === "ready"
                    ? "CONNECTED"
                    : market.status === "error"
                      ? "UNAVAILABLE"
                      : "CONNECTING"}
                </span>
              </div>
              <div className="market-price-row">
                <div>
                  <p className="symbol-name">BTCUSDT</p>
                  {market.status === "ready" || market.status === "stale" ? (
                    <>
                      <p className="market-price">
                        {formatPrice(market.data.lastPrice)}
                      </p>
                      <span
                        className={`price-change ${
                          market.data.change24hPercent >= 0
                            ? "text-positive"
                            : "text-negative"
                        }`}
                      >
                        {formatPercent(market.data.change24hPercent)}
                        <span className="muted-inline"> 24h</span>
                      </span>
                    </>
                  ) : market.status === "error" ? (
                    <p className="market-error" role="status">
                      {market.message}
                    </p>
                  ) : (
                    <p className="market-price market-loading">Loading…</p>
                  )}
                </div>
                {market.status === "ready" || market.status === "stale" ? (
                  <MiniChart data={market.data} />
                ) : (
                  <div className="chart-placeholder" aria-hidden="true">
                    &nbsp;
                  </div>
                )}
              </div>
              <div className="market-detail-row">
                <span>
                  24h high{" "}
                  <strong>
                    {market.status === "ready" || market.status === "stale"
                      ? formatPrice(market.data.high24h)
                      : "—"}
                  </strong>
                </span>
                <span>
                  24h low{" "}
                  <strong>
                    {market.status === "ready" || market.status === "stale"
                      ? formatPrice(market.data.low24h)
                      : "—"}
                  </strong>
                </span>
                <span>
                  Funding{" "}
                  <strong>
                    {(market.status === "ready" || market.status === "stale") &&
                    market.data.fundingRate !== null
                      ? `${(market.data.fundingRate * 100).toFixed(4)}%`
                      : "—"}
                  </strong>
                </span>
              </div>
              <p className="data-attribution">
                Public Bybit market data · 5-minute candles · refreshed every
                30 seconds
                {market.status === "ready" || market.status === "stale"
                  ? ` · updated ${formatLocalTime(market.data.asOf)}`
                  : ""}
                {market.status === "stale" ? ` · ${market.message}` : ""}
              </p>
            </article>

            <article className="status-card futures-card">
              <div className="card-heading">
                <span className="instrument-label">
                  <span className="futures-mark">N</span>
                  CME · INDEX FUTURES
                </span>
                <span className="connection-pill pill-pending">
                  <span className="status-dot" />
                  NOT CONNECTED
                </span>
              </div>
              <div className="futures-body">
                <div>
                  <p className="symbol-name">MNQ / NQ</p>
                  <p className="provider-name">Tradovate</p>
                </div>
                <span className="futures-line" aria-hidden="true">
                  <span />
                </span>
              </div>
              <p className="provider-note">
                Connection is held until read-only API access, market-data
                entitlement, and Australian availability are verified. No
                broker login is requested here.
              </p>
            </article>
          </section>

          <div className="section-heading" id="markets">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h2>Research at a glance</h2>
            </div>
            <span className="scope-tag">FOUNDATION MILESTONE</span>
          </div>

          <section className="workspace-grid" aria-label="Workspace modules">
            <Link className="module-card module-card-link" href="/journal" id="journal">
              <div className="module-icon journal-icon">▤</div>
              <div className="module-topline">
                <span>TRADE JOURNAL</span>
                <span className="module-status">PLANNED</span>
              </div>
              <h3>Build your process record.</h3>
              <p>
                Manual entries, CSV import, screenshots, execution notes, and
                risk-aware performance tracking.
              </p>
              <div className="module-footer">
                <span>No trades recorded</span>
                <span aria-hidden="true">↗</span>
              </div>
            </Link>
            <article className="module-card" id="research">
              <div className="module-icon research-icon">⌕</div>
              <div className="module-topline">
                <span>SCANNER &amp; RESEARCH</span>
                <span className="module-status">PLANNED</span>
              </div>
              <h3>Test ideas. Keep context honest.</h3>
              <p>
                Objective signals and transparent backtests, with discretionary
                context recorded separately.
              </p>
              <div className="module-footer">
                <span>No strategy claims</span>
                <span aria-hidden="true">↗</span>
              </div>
            </article>
          </section>

          <section className="integration-panel" aria-labelledby="integrations-title">
            <div className="integration-heading">
              <div>
                <p className="eyebrow">DATA SOURCES</p>
                <h2 id="integrations-title">Connection checklist</h2>
              </div>
              <span className="checklist-count">1 LIVE · 2 REVIEW NEEDED</span>
            </div>
            <div className="integration-row">
              <span className="integration-logo bybit-logo">B</span>
              <div className="integration-description">
                <strong>Bybit public market data</strong>
                <span>BTCUSDT linear · no API key required for public candles</span>
              </div>
              <span
                className={`integration-state ${
                  market.status === "ready"
                    ? "state-connected"
                    : market.status === "stale"
                      ? "state-review"
                      : "state-error"
                }`}
              >
                {market.status === "ready"
                  ? "LIVE DATA"
                  : market.status === "stale"
                    ? "STALE DATA"
                    : "CHECK CONNECTION"}
              </span>
            </div>
            <div className="integration-row">
              <span className="integration-logo tradovate-logo">T</span>
              <div className="integration-description">
                <strong>Tradovate API</strong>
                <span>MNQ / NQ · access scope and market-data entitlement need verification</span>
              </div>
              <span className="integration-state state-review">REVIEW NEEDED</span>
            </div>
            <div className="integration-row">
              <span className="integration-logo tradingview-logo">TV</span>
              <div className="integration-description">
                <strong>TradingView Premium</strong>
                <span>Official charting, alert, API, and data-use options to be checked</span>
              </div>
              <span className="integration-state state-review">REVIEW NEEDED</span>
            </div>
            <p className="integration-footnote">
              No provider credentials are requested or stored by this
              foundation milestone. TradingView Premium is not assumed to
              provide an app-accessible market-data API. Australian service
              availability and market-data reuse rights still need provider
              confirmation.
            </p>
          </section>

          <footer className="app-footer">
            <span>
              <span className="footer-shield">◆</span> PRIVATE WORKSPACE
            </span>
            <span>Market data for research only · Paper mode only</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
