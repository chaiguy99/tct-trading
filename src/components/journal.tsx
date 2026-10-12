"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  JournalMetrics,
  JournalTrade,
  PaperSettings,
} from "@/lib/journal/types";
import { parseJournalCsv, type CsvImportPreview } from "@/lib/journal/csv";

type JournalState =
  | { status: "loading" }
  | { status: "ready"; trades: JournalTrade[]; metrics: JournalMetrics }
  | { status: "error"; message: string };

const emptyMetrics: JournalMetrics = {
  closedTrades: 0,
  openTrades: 0,
  winRate: null,
  byCurrency: {
    USD: {
      netRealizedPnl: 0,
      expectancy: null,
      profitFactor: null,
      maxDrawdown: 0,
    },
    USDT: {
      netRealizedPnl: 0,
      expectancy: null,
      profitFactor: null,
      maxDrawdown: 0,
    },
  },
};

const emptySettings: PaperSettings = {
  startingBalanceUsd: 0,
  startingBalanceUsdt: 0,
  riskPerTradePercent: 1,
  dailyLossLimitUsd: 0,
  dailyLossLimitUsdt: 0,
  maxOpenPositions: 3,
  maxLeverage: 2,
};

function formatAmount(value: number, currency: "USD" | "USDT" = "USD") {
  if (currency === "USDT") {
    return `${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value)} USDT`;
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 6,
  }).format(value);
}

async function readResponse<T extends object>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error: string };
  if (!response.ok || "error" in body) {
    throw new Error(
      "error" in body ? body.error : "The request could not be completed.",
    );
  }
  return body as T;
}

export default function Journal({
  email,
  aiProviderLabel,
  storageLabel,
}: {
  email: string;
  aiProviderLabel: string | null;
  storageLabel: string;
}) {
  const [state, setState] = useState<JournalState>({ status: "loading" });
  const [settings, setSettings] = useState<PaperSettings>(emptySettings);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiAnalyzedTrades, setAiAnalyzedTrades] = useState<number | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvImportPreview | null>(null);
  const [csvError, setCsvError] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/journal/trades", {
        cache: "no-store",
      });
      const result = await readResponse<{
        trades: JournalTrade[];
        metrics: JournalMetrics;
      }>(response);
      setState({ status: "ready", ...result });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Journal data could not be loaded.",
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [tradeResponse, settingsResponse] = await Promise.all([
          fetch("/api/journal/trades", { cache: "no-store" }),
          fetch("/api/journal/settings", { cache: "no-store" }),
        ]);
        const [tradeData, settingsData] = await Promise.all([
          readResponse<{ trades: JournalTrade[]; metrics: JournalMetrics }>(
            tradeResponse,
          ),
          readResponse<{ settings: PaperSettings }>(settingsResponse),
        ]);
        if (active) {
          setState({ status: "ready", ...tradeData });
          setSettings(settingsData.settings);
        }
      } catch (error) {
        if (active) {
          const message =
            error instanceof Error ? error.message : "Journal data could not be loaded.";
          setState({ status: "error", message });
          setSettingsError(message);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setSettingsError("");
    const values = new FormData(event.currentTarget);
    try {
      const result = await readResponse<{ settings: PaperSettings }>(
        await fetch("/api/journal/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startingBalanceUsd: Number(values.get("startingBalanceUsd")),
            startingBalanceUsdt: Number(values.get("startingBalanceUsdt")),
            riskPerTradePercent: Number(values.get("riskPerTradePercent")),
            dailyLossLimitUsd: Number(values.get("dailyLossLimitUsd")),
            dailyLossLimitUsdt: Number(values.get("dailyLossLimitUsdt")),
            maxOpenPositions: Number(values.get("maxOpenPositions")),
            maxLeverage: Number(values.get("maxLeverage")),
          }),
        }),
      );
      setSettings(result.settings);
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Paper settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    const form = event.currentTarget;
    const values = new FormData(form);

    try {
      await readResponse(
        await fetch("/api/journal/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instrument: values.get("instrument"),
            side: values.get("side"),
            mode: values.get("mode"),
            quantity: Number(values.get("quantity")),
            price: Number(values.get("price")),
            fee: Number(values.get("fee") || 0),
            riskAmount: values.get("riskAmount")
              ? Number(values.get("riskAmount"))
              : null,
            funding: Number(values.get("funding") || 0),
            setup: values.get("setup"),
            marketCondition: values.get("marketCondition"),
            thesis: values.get("thesis"),
            notes: values.get("notes"),
          }),
        }),
      );
      form.reset();
      await refresh();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Trade could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function askJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiBusy(true);
    setAiAnswer("");
    setAiError("");
    setAiAnalyzedTrades(null);
    const values = new FormData(event.currentTarget);
    try {
      const result = await readResponse<{
        answer: string;
        analyzedTrades: number;
      }>(
        await fetch("/api/journal/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: values.get("question"),
            consent: values.get("consent") === "on",
          }),
        }),
      );
      setAiAnswer(result.answer);
      setAiAnalyzedTrades(result.analyzedTrades);
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : "The journal query failed.",
      );
    } finally {
      setAiBusy(false);
    }
  }

  function previewCsv(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setCsvPreview(null);
    setCsvError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsvError("Choose a .csv file.");
      return;
    }
    if (file.size > 1_000_000) {
      setCsvError("CSV file must be 1 MB or smaller.");
      return;
    }
    void file.text().then((source) => {
      try {
        setCsvPreview(parseJournalCsv(source));
      } catch (error) {
        setCsvError(
          error instanceof Error ? error.message : "CSV file could not be read.",
        );
      }
    }).catch(() => setCsvError("CSV file could not be read."));
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csvPreview || csvPreview.issues.length > 0) return;
    const form = event.currentTarget;
    setCsvBusy(true);
    setCsvError("");
    try {
      const result = await readResponse<{ imported: number }>(
        await fetch("/api/journal/trades/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trades: csvPreview.trades,
          }),
        }),
      );
      setCsvPreview(null);
      form.reset();
      await refresh();
      setCsvError(`${result.imported} journal records imported.`);
    } catch (error) {
      setCsvError(
        error instanceof Error ? error.message : "CSV records could not be imported.",
      );
    } finally {
      setCsvBusy(false);
    }
  }

  async function downloadBackup() {
    setBackupBusy(true);
    setBackupError("");
    try {
      const response = await fetch("/api/journal/export", {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Journal backup could not be created.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tct-journal-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "Journal backup could not be created.",
      );
    } finally {
      setBackupBusy(false);
    }
  }

  async function addFill(
    event: FormEvent<HTMLFormElement>,
    tradeId: string,
    kind: "entry" | "exit",
  ) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    const form = event.currentTarget;
    const values = new FormData(form);

    try {
      await readResponse(
        await fetch(`/api/journal/trades/${encodeURIComponent(tradeId)}/fills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            quantity: Number(values.get("quantity")),
            price: Number(values.get("price")),
            fee: Number(values.get("fee") || 0),
            riskAmount: values.get("riskAmount")
              ? Number(values.get("riskAmount"))
              : null,
          }),
        }),
      );
      form.reset();
      await refresh();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Fill could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const trades = state.status === "ready" ? state.trades : [];
  const metrics = state.status === "ready" ? state.metrics : emptyMetrics;

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
          <Link className="nav-link" href="/">
            <span className="nav-icon">◫</span> Overview
          </Link>
          <Link className="nav-link" href="/#markets">
            <span className="nav-icon">⌁</span> Markets
          </Link>
          <Link className="nav-link nav-link-active" href="/journal">
            <span className="nav-icon">▤</span> Journal
          </Link>
          <Link className="nav-link nav-link-muted" href="/#research">
            <span className="nav-icon">⌕</span> Research
            <span className="soon-tag">NEXT</span>
          </Link>
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

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <Link href="/">Workspace</Link>
            <span aria-hidden="true">/</span>
            <strong>Journal</strong>
          </div>
          <span className="live-indicator">
            <span className="status-dot" />
            PRIVATE JOURNAL
          </span>
        </header>

        <div className="content journal-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR PROCESS, RECORDED</p>
              <h1>Trade journal</h1>
              <p className="page-subtitle">
                Record manual trades and paper simulations. Entries stay on
                this server and are never sent to a broker or exchange.
              </p>
            </div>
          </div>

          <section className="journal-metrics" aria-label="Journal performance">
            <Metric
              label="NET P&L · USD FUTURES"
              value={formatAmount(metrics.byCurrency.USD.netRealizedPnl)}
              tone={metrics.byCurrency.USD.netRealizedPnl >= 0 ? "positive" : "negative"}
            />
            <Metric
              label="NET P&L · USDT"
              value={formatAmount(metrics.byCurrency.USDT.netRealizedPnl, "USDT")}
              tone={metrics.byCurrency.USDT.netRealizedPnl >= 0 ? "positive" : "negative"}
            />
            <Metric
              label="WIN RATE · ALL"
              value={
                metrics.winRate === null
                  ? "—"
                  : `${(metrics.winRate * 100).toFixed(1)}%`
              }
            />
            <Metric
              label="EXPECTANCY · USD"
              value={metrics.byCurrency.USD.expectancy === null ? "—" : formatAmount(metrics.byCurrency.USD.expectancy)}
              tone={metrics.byCurrency.USD.expectancy === null ? undefined : metrics.byCurrency.USD.expectancy >= 0 ? "positive" : "negative"}
            />
            <Metric
              label="EXPECTANCY · USDT"
              value={metrics.byCurrency.USDT.expectancy === null ? "—" : formatAmount(metrics.byCurrency.USDT.expectancy, "USDT")}
              tone={metrics.byCurrency.USDT.expectancy === null ? undefined : metrics.byCurrency.USDT.expectancy >= 0 ? "positive" : "negative"}
            />
            <Metric label="CLOSED / OPEN" value={`${metrics.closedTrades} / ${metrics.openTrades}`} />
            <Metric
              label="MAX DRAWDOWN · USD"
              value={formatAmount(metrics.byCurrency.USD.maxDrawdown)}
              tone="negative"
            />
            <Metric
              label="PROFIT FACTOR · USD"
              value={
                metrics.byCurrency.USD.profitFactor === null
                  ? "—"
                  : metrics.byCurrency.USD.profitFactor.toFixed(2)
              }
            />
            <Metric
              label="PROFIT FACTOR · USDT"
              value={
                metrics.byCurrency.USDT.profitFactor === null
                  ? "—"
                  : metrics.byCurrency.USDT.profitFactor.toFixed(2)
              }
            />
          </section>

          <section className="journal-form-panel" aria-labelledby="csv-import-title">
            <div className="integration-heading">
              <div>
                <p className="eyebrow">FRESH JOURNAL RECORDS</p>
                <h2 id="csv-import-title">Import CSV</h2>
              </div>
              <span className="scope-tag">JOURNAL ONLY</span>
            </div>
            <p className="risk-settings-copy">
              Upload up to 500 rows (1 MB). Each row creates one fresh journal
              position with an entry and optional partial/full exit. Review the
              preview before importing. Imports never create paper positions.
              Existing trades are not modified; importing the same file again
              creates duplicates.
            </p>
            <form className="csv-import-form" onSubmit={importCsv}>
              <label>
                CSV file
                <input
                  accept=".csv,text/csv"
                  name="csvFile"
                  onChange={previewCsv}
                  type="file"
                />
              </label>
              <a
                className="csv-template-link"
                download="journal-template.csv"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent("instrument,side,quantity,price,fee,riskAmount,funding,setup,marketCondition,thesis,notes,filledAt,exitQuantity,exitPrice,exitFee,exitAt\nMNQ,long,1,20000,2,100,0,NYOP rejection,trend,Setup thesis,Execution notes,2026-10-12T09:30:00-04:00,1,20010,2,2026-10-12T09:45:00-04:00\n")}`}
              >
                Download CSV template
              </a>
              {csvPreview ? (
                <>
                  <p className="csv-preview-status" role="status">
                    {csvPreview.issues.length === 0
                      ? `${csvPreview.rowCount} rows ready to import as journal records.`
                      : `${csvPreview.issues.length} of ${csvPreview.rowCount} rows need correction; nothing can be imported yet.`}
                  </p>
                  {csvPreview.issues.length > 0 ? (
                    <ul className="csv-issues">
                      {csvPreview.issues.slice(0, 8).map((issue) => (
                        <li key={`${issue.row}-${issue.message}`}>
                          Row {issue.row}: {issue.message}
                        </li>
                      ))}
                      {csvPreview.issues.length > 8 ? (
                        <li>And {csvPreview.issues.length - 8} more row errors.</li>
                      ) : null}
                    </ul>
                  ) : (
                    <div className="csv-preview-table-wrap">
                      <table className="csv-preview-table">
                        <thead>
                          <tr>
                            <th>Instrument</th>
                            <th>Side</th>
                            <th>Qty</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Setup</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.trades.slice(0, 5).map((trade, index) => (
                            <tr key={`${index}-${trade.instrument}`}>
                              <td>{trade.instrument}</td>
                              <td>{trade.side}</td>
                              <td>{trade.quantity}</td>
                              <td>{trade.price}</td>
                              <td>{trade.exit?.price ?? "Open"}</td>
                              <td>{trade.setup || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {csvPreview.trades.length > 5 ? (
                        <p>Showing first 5 rows.</p>
                      ) : null}
                    </div>
                  )}
                </>
              ) : null}
              {csvError ? (
                <p className="csv-preview-status" role="status">{csvError}</p>
              ) : null}
              <div className="trade-form-actions">
                <p>
                  Required: instrument, side, quantity, price. Optional: fee,
                  riskAmount, funding, setup, marketCondition, thesis, notes,
                  filledAt, exitQuantity, exitPrice, exitFee, exitAt. Times must
                  be ISO 8601 with timezone.
                </p>
                <button
                  className="button button-primary"
                  disabled={csvBusy || !csvPreview || csvPreview.issues.length > 0}
                  type="submit"
                >
                  {csvBusy ? "Importing…" : "Import journal records"}
                </button>
              </div>
            </form>
          </section>

          <section className="journal-form-panel journal-ai-panel" aria-labelledby="journal-ai-title">
            <div className="integration-heading">
              <div>
                <p className="eyebrow">READ-ONLY RESEARCH ASSISTANT</p>
                <h2 id="journal-ai-title">Ask your journal</h2>
              </div>
              <span className="scope-tag">
                {aiProviderLabel ? "OPT-IN PER QUESTION" : "NOT CONFIGURED"}
              </span>
            </div>
            {aiProviderLabel ? (
              <>
                <p className="risk-settings-copy">
                  Connected to {aiProviderLabel}. Questions include at most your
                  50 most recently updated trades, their setup/context, thesis,
                  notes, performance values, and up to 10 recent fills each.
                  Results are read-only; verify cited records before drawing
                  conclusions.
                </p>
                <form className="journal-ai-form" onSubmit={askJournal}>
                  <label>
                    Question
                    <textarea
                      maxLength={1_000}
                      minLength={3}
                      name="question"
                      placeholder="Which setup has had the strongest expectancy?"
                      required
                      rows={3}
                    />
                  </label>
                  <label className="journal-ai-consent">
                    <input name="consent" required type="checkbox" />
                    <span>
                      I agree to send the question and the listed journal data
                      to {aiProviderLabel} to generate this answer.
                    </span>
                  </label>
                  {aiError ? (
                    <p className="journal-error" role="alert">{aiError}</p>
                  ) : null}
                  {aiAnswer ? (
                    <div className="journal-ai-answer" aria-live="polite">
                      <strong>
                        Answer{aiAnalyzedTrades === null
                          ? ""
                          : ` · ${aiAnalyzedTrades} trades analyzed`}
                      </strong>
                      <p>{aiAnswer}</p>
                    </div>
                  ) : null}
                  <div className="trade-form-actions">
                    <p>
                      No query is sent until you submit with consent. The app
                      does not give the model write or order-execution access.
                    </p>
                    <button
                      className="button button-primary"
                      disabled={aiBusy}
                      type="submit"
                    >
                      {aiBusy ? "Thinking…" : "Ask"}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <p className="risk-settings-copy">
                Configure an OpenAI-compatible model endpoint on the server to
                enable Q&amp;A. Until configured, no journal data is sent to an
                AI service. See the README for the optional provider settings.
              </p>
            )}
          </section>

          <section className="journal-form-panel" aria-labelledby="new-trade-title">
            <div className="integration-heading">
              <div>
                <p className="eyebrow">MANUAL ENTRY</p>
                <h2 id="new-trade-title">Record a position</h2>
              </div>
              <span className="scope-tag">NO ORDER IS SENT</span>
            </div>
            <form className="trade-form" onSubmit={createTrade}>
              <label>
                Instrument
                <select name="instrument" required defaultValue="MNQ">
                  <option value="MNQ">MNQ</option>
                  <option value="NQ">NQ</option>
                  <option value="BTCUSDT">BTCUSDT perpetual</option>
                </select>
              </label>
              <label>
                Side
                <select name="side" required defaultValue="long">
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </label>
              <label>
                Record type
                <select name="mode" required defaultValue="journal">
                  <option value="journal">Journal record</option>
                  <option value="paper">Paper simulation</option>
                </select>
              </label>
              <label>
                Entry quantity
                <input
                  name="quantity"
                  min="0.000001"
                  required
                  step="any"
                  type="number"
                />
              </label>
              <label>
                Entry price
                <input
                  name="price"
                  min="0.000001"
                  required
                  step="any"
                  type="number"
                />
              </label>
              <label>
                Entry fee
                <input defaultValue="0" min="0" name="fee" step="any" type="number" />
              </label>
              <label>
                Funding paid / received
                <input defaultValue="0" name="funding" step="any" type="number" />
              </label>
              <label>
                Planned risk (optional)
                <input
                  name="riskAmount"
                  min="0.01"
                  step="any"
                  type="number"
                />
              </label>
              <label>
                Setup
                <input maxLength={120} name="setup" placeholder="e.g. NYOP rejection" />
              </label>
              <label>
                Market condition
                <input
                  maxLength={120}
                  name="marketCondition"
                  placeholder="e.g. range, trend, news"
                />
              </label>
              <label className="trade-form-wide">
                Thesis
                <textarea maxLength={4_000} name="thesis" rows={2} />
              </label>
              <label className="trade-form-wide">
                Execution notes
                <textarea maxLength={4_000} name="notes" rows={2} />
              </label>
              {formError ? (
                <p className="journal-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="trade-form-actions">
                <p>Fees are recorded per fill. P&amp;L is shown in quote currency without FX conversion.</p>
                <button className="button button-primary" disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save position"}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            </form>
          </section>

          <section className="journal-form-panel" aria-labelledby="risk-settings-title">
            <div className="integration-heading">
              <div>
                <p className="eyebrow">PAPER MODE ONLY</p>
                <h2 id="risk-settings-title">Risk limits</h2>
              </div>
              <span className="scope-tag">HARD CAPS</span>
            </div>
            <p className="risk-settings-copy">
              Balances are separate by quote currency. Paper positions require
              a configured balance, daily loss cap, and planned risk. Limits
              are checked before a paper entry is recorded.
            </p>
            <form
              className="trade-form"
              key={JSON.stringify(settings)}
              onSubmit={saveSettings}
            >
              <label>
                Starting balance · USD
                <input
                  defaultValue={settings.startingBalanceUsd}
                  min="0"
                  name="startingBalanceUsd"
                  required
                  step="any"
                  type="number"
                />
              </label>
              <label>
                Starting balance · USDT
                <input
                  defaultValue={settings.startingBalanceUsdt}
                  min="0"
                  name="startingBalanceUsdt"
                  required
                  step="any"
                  type="number"
                />
              </label>
              <label>
                Max risk per trade · %
                <input
                  defaultValue={settings.riskPerTradePercent}
                  max="5"
                  min="0.01"
                  name="riskPerTradePercent"
                  required
                  step="0.01"
                  type="number"
                />
              </label>
              <label>
                Daily loss limit · USD
                <input
                  defaultValue={settings.dailyLossLimitUsd}
                  min="0"
                  name="dailyLossLimitUsd"
                  required
                  step="any"
                  type="number"
                />
              </label>
              <label>
                Daily loss limit · USDT
                <input
                  defaultValue={settings.dailyLossLimitUsdt}
                  min="0"
                  name="dailyLossLimitUsdt"
                  required
                  step="any"
                  type="number"
                />
              </label>
              <label>
                Max open positions
                <input
                  defaultValue={settings.maxOpenPositions}
                  max="50"
                  min="1"
                  name="maxOpenPositions"
                  required
                  step="1"
                  type="number"
                />
              </label>
              <label>
                Max leverage · exposure cap
                <input
                  defaultValue={settings.maxLeverage}
                  max="100"
                  min="1"
                  name="maxLeverage"
                  required
                  step="0.1"
                  type="number"
                />
              </label>
              <div className="trade-form-actions">
                {settingsError ? (
                  <p className="journal-error" role="alert">{settingsError}</p>
                ) : (
                  <p>Futures and crypto quote balances are kept separate; no FX conversion is assumed.</p>
                )}
                <button className="button button-primary" disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save risk limits"}
                </button>
              </div>
            </form>
          </section>

          <section className="trade-list-panel" aria-labelledby="positions-title">
            <div className="integration-heading">
              <div>
                <p className="eyebrow">PRIVATE LEDGER</p>
                <h2 id="positions-title">Positions</h2>
              </div>
              <div className="ledger-actions">
                <span className="checklist-count">
                  {state.status === "ready" ? `${trades.length} RECORDS` : "LOADING"}
                </span>
                <button
                  className="button backup-button"
                  disabled={backupBusy || state.status !== "ready"}
                  onClick={() => void downloadBackup()}
                  type="button"
                >
                  {backupBusy ? "Preparing…" : "Download backup"}
                </button>
              </div>
            </div>
            {backupError ? (
              <p className="journal-error" role="alert">{backupError}</p>
            ) : null}
            {state.status === "error" ? (
              <p className="journal-error" role="alert">
                {state.message}
              </p>
            ) : state.status === "loading" ? (
              <p className="journal-empty">Loading journal records…</p>
            ) : trades.length === 0 ? (
              <p className="journal-empty">
                Your journal starts fresh. No trades have been recorded.
              </p>
            ) : (
              <div className="trade-list">
                {trades.map((trade) => (
                  <TradeRow
                    key={trade.id}
                    busy={busy}
                    onAddFill={addFill}
                    trade={trade}
                  />
                ))}
              </div>
            )}
          </section>
          <footer className="app-footer">
            <span>
              <span className="footer-shield">◆</span> PRIVATE WORKSPACE
            </span>
            <span>{storageLabel} · no broker/exchange order routing</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <article className="journal-metric">
      <span>{label}</span>
      <strong
        className={
          tone === "positive"
            ? "metric-positive"
            : tone === "negative"
              ? "metric-negative"
              : undefined
        }
      >
        {value}
      </strong>
    </article>
  );
}

function TradeRow({
  trade,
  busy,
  onAddFill,
}: {
  trade: JournalTrade;
  busy: boolean;
  onAddFill: (
    event: FormEvent<HTMLFormElement>,
    tradeId: string,
    kind: "entry" | "exit",
  ) => void;
}) {
  return (
    <article className="trade-row">
      <div className="trade-row-main">
        <div className="trade-row-title">
          <strong>{trade.instrument}</strong>
          <span className={trade.side === "long" ? "side-long" : "side-short"}>
            {trade.side.toUpperCase()}
          </span>
          <span className="mode-pill">
            {trade.mode === "paper" ? "PAPER" : "JOURNAL"}
          </span>
          <span className={trade.status === "open" ? "status-open" : "status-closed"}>
            {trade.status.toUpperCase()}
          </span>
        </div>
        <div className="trade-row-meta">
          {trade.setup || "No setup label"}
          {trade.marketCondition ? ` · ${trade.marketCondition}` : ""}
        </div>
      </div>
      <div className="trade-row-value">
        <span>ENTRY AVG</span>
        <strong>{formatAmount(trade.averageEntryPrice)}</strong>
      </div>
      <div className="trade-row-value">
        <span>OPEN QTY</span>
        <strong>{formatQuantity(trade.openQuantity)}</strong>
      </div>
      <div className="trade-row-value">
        <span>NET REALIZED · {trade.instrument === "BTCUSDT" ? "USDT" : "USD"}</span>
        <strong className={trade.netRealizedPnl >= 0 ? "metric-positive" : "metric-negative"}>
          {formatAmount(trade.netRealizedPnl)}
        </strong>
      </div>
      <details className="trade-details">
        <summary>
          {trade.fills.length} fills · details
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="trade-detail-content">
          {trade.thesis ? <p><strong>Thesis:</strong> {trade.thesis}</p> : null}
          {trade.notes ? <p><strong>Notes:</strong> {trade.notes}</p> : null}
          {trade.funding !== 0 ? (
            <p><strong>Funding:</strong> {formatAmount(trade.funding, trade.instrument === "BTCUSDT" ? "USDT" : "USD")}</p>
          ) : null}
          <div className="fill-list">
            {trade.fills.map((fill) => (
              <div className="fill-row" key={fill.id}>
                <span>{fill.kind.toUpperCase()}</span>
                <span>{formatQuantity(fill.quantity)} @ {formatAmount(fill.price)}</span>
                <span>fee {formatAmount(fill.fee, trade.instrument === "BTCUSDT" ? "USDT" : "USD")}</span>
                <time dateTime={fill.filledAt}>
                  {new Date(fill.filledAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
          {trade.status === "open" ? (
            <div className="fill-editors">
              <FillEditor
                busy={busy}
                kind="entry"
                requireRisk={trade.mode === "paper"}
                onSubmit={(event) => onAddFill(event, trade.id, "entry")}
              />
              <FillEditor
                busy={busy}
                kind="exit"
                maxQuantity={trade.openQuantity}
                onSubmit={(event) => onAddFill(event, trade.id, "exit")}
              />
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function FillEditor({
  kind,
  busy,
  maxQuantity,
  requireRisk = false,
  onSubmit,
}: {
  kind: "entry" | "exit";
  busy: boolean;
  maxQuantity?: number;
  requireRisk?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="exit-form" onSubmit={onSubmit}>
      <strong>Record a {kind} fill</strong>
      <label>
        Quantity
        <input
          max={maxQuantity}
          min="0.000001"
          name="quantity"
          required
          step="any"
          type="number"
        />
      </label>
      <label>
        Fill price
        <input min="0.000001" name="price" required step="any" type="number" />
      </label>
      <label>
        Fee
        <input defaultValue="0" min="0" name="fee" step="any" type="number" />
      </label>
      {requireRisk ? (
        <label>
          Additional planned risk
          <input min="0.01" name="riskAmount" required step="any" type="number" />
        </label>
      ) : null}
      <button className="button button-primary" disabled={busy} type="submit">
        Add {kind}
      </button>
    </form>
  );
}
