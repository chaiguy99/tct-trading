"use client";

import { useEffect, useMemo, useState } from "react";
import type { BybitInterval, BybitSnapshot } from "@/lib/market-data/bybit";
import { analyzeBreakoutAlignment } from "@/lib/market-data/scanner";

type ScannerState =
  | { status: "loading" }
  | { status: "ready"; medium: BybitSnapshot; higher: BybitSnapshot }
  | { status: "stale"; medium: BybitSnapshot; higher: BybitSnapshot; message: string }
  | { status: "error"; message: string };

const intervals: { value: BybitInterval; label: string; minutes: number }[] = [
  { value: "1", label: "1 minute", minutes: 1 },
  { value: "5", label: "5 minutes", minutes: 5 },
  { value: "15", label: "15 minutes", minutes: 15 },
  { value: "60", label: "1 hour", minutes: 60 },
  { value: "240", label: "4 hours", minutes: 240 },
];

function formatInterval(value: BybitInterval) {
  return intervals.find((interval) => interval.value === value)?.label ?? value;
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignalTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

export default function BtcScanner() {
  const [mediumInterval, setMediumInterval] = useState<BybitInterval>("15");
  const [higherInterval, setHigherInterval] = useState<BybitInterval>("60");
  const [state, setState] = useState<ScannerState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [mediumResponse, higherResponse] = await Promise.all([
          fetch(`/api/market/bybit?interval=${mediumInterval}`, {
            cache: "no-store",
          }),
          fetch(`/api/market/bybit?interval=${higherInterval}`, {
            cache: "no-store",
          }),
        ]);
        const [mediumBody, higherBody] = (await Promise.all([
          mediumResponse.json(),
          higherResponse.json(),
        ])) as [
          BybitSnapshot | { error: string },
          BybitSnapshot | { error: string },
        ];
        if (
          !mediumResponse.ok ||
          !higherResponse.ok ||
          "error" in mediumBody ||
          "error" in higherBody
        ) {
          const error =
            "error" in mediumBody
              ? mediumBody.error
              : "error" in higherBody
                ? higherBody.error
                : "Market data is unavailable.";
          throw new Error(error);
        }
        if (active) {
          setState({ status: "ready", medium: mediumBody, higher: higherBody });
        }
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Market data is unavailable.";
        setState((current) =>
          current.status === "ready" || current.status === "stale"
            ? { ...current, status: "stale", message }
            : { status: "error", message },
        );
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [higherInterval, mediumInterval]);

  const analysis = useMemo(() => {
    if (state.status !== "ready" && state.status !== "stale") return null;
    return analyzeBreakoutAlignment(
      state.medium.candles,
      state.higher.candles,
      mediumInterval,
      higherInterval,
    );
  }, [higherInterval, mediumInterval, state]);

  function changeMedium(value: BybitInterval) {
    const minutes = intervals.find((item) => item.value === value)!.minutes;
    const nextHigher = intervals.find((item) => item.minutes > minutes)?.value ?? "240";
    setMediumInterval(value);
    const currentMinutes =
      intervals.find((item) => item.value === higherInterval)?.minutes ?? 0;
    const nextValue =
      currentMinutes > minutes ? higherInterval : nextHigher;
    setHigherInterval(nextValue);
    setState({ status: "loading" });
  }

  function changeHigher(value: BybitInterval) {
    setHigherInterval(value);
    setState({ status: "loading" });
  }

  const higherMinutes =
    intervals.find((item) => item.value === higherInterval)?.minutes ?? Infinity;

  return (
    <section className="scanner-panel" aria-labelledby="btc-scanner-title">
      <div className="scanner-heading">
        <div>
          <p className="eyebrow">ALERTS · PAPER RESEARCH ONLY</p>
          <h2 id="btc-scanner-title">BTCUSDT breakout scanner</h2>
        </div>
        <span className="scope-tag">NO ORDER ROUTING</span>
      </div>
      <p className="scanner-description">
        Highlights a closed-candle range breakout only when the higher-timeframe
        trend agrees. This objective rule is for research, not a trade
        recommendation or profitability claim.
      </p>
      <div className="scanner-controls">
        <label>
          Breakout timeframe
          <select
            aria-label="Breakout timeframe"
            onChange={(event) =>
              changeMedium(event.target.value as BybitInterval)
            }
            value={mediumInterval}
          >
            {intervals
              .filter((interval) => interval.minutes < higherMinutes)
              .map((interval) => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Trend timeframe
          <select
            aria-label="Trend timeframe"
            onChange={(event) =>
              changeHigher(event.target.value as BybitInterval)
            }
            value={higherInterval}
          >
            {intervals
              .filter(
                (interval) =>
                  interval.minutes >
                  (intervals.find((item) => item.value === mediumInterval)
                    ?.minutes ?? 0),
              )
              .map((interval) => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="scanner-result" aria-live="polite">
        {state.status === "loading" ? (
          <p>Loading public Bybit candles…</p>
        ) : state.status === "error" ? (
          <p className="market-error">{state.message}</p>
        ) : analysis?.signal ? (
          <div className={`scanner-signal signal-${analysis.signal.direction}`}>
            <strong>
              {analysis.signal.direction === "long"
                ? "Bullish breakout alignment"
                : "Bearish breakout alignment"}
            </strong>
            <span>
              {formatInterval(mediumInterval)} close{" "}
              {formatPrice(analysis.signal.breakoutClose)} broke beyond{" "}
              {formatPrice(analysis.signal.rangeLevel)};{" "}
              {formatInterval(higherInterval)} trend is {analysis.trend}.
            </span>
            <small>
              Closed candle · {formatSignalTime(analysis.signal.signalTime)}
              {state.status === "stale" ? ` · stale data: ${state.message}` : ""}
            </small>
          </div>
        ) : (
          <div className="scanner-no-signal">
            <strong>No aligned breakout currently</strong>
            <span>
              Higher-timeframe trend: {analysis?.trend ?? "neutral"} ·{" "}
              {formatInterval(mediumInterval)} breakout:{" "}
              {analysis?.mediumBreakout ?? "none"}
            </span>
            {state.status === "stale" ? (
              <small>Showing last data; refresh issue: {state.message}</small>
            ) : null}
          </div>
        )}
      </div>
      <p className="scanner-footnote">
        Uses the last completed candles and refreshes every minute. Public Bybit
        data only; verify conditions independently.
      </p>
    </section>
  );
}
