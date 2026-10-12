# Market-data and integration review

This is an implementation checkpoint, not confirmation of account entitlements, legal availability, or data-use rights. Review the current provider terms and the user's actual account before enabling account-specific integrations.

| Source | Verified in this milestone | Still needs verification |
| --- | --- | --- |
| Bybit BTCUSDT linear perpetual | The official V5 API documents public linear-contract ticker and kline endpoints. Public candles do not require an API key. The app requests the BTCUSDT ticker and the latest 120 candles through the official REST API. | Australian account/product availability, permitted display/storage/redistribution, current rate limits, historical retention/coverage, and account-specific funding/history needs. The official restricted-country page could not be retrieved during this review, so Australian access is **not confirmed**. |
| Tradovate MNQ/NQ | Official API documentation exists. No Tradovate credential is collected, and no broker order endpoint is implemented. | Whether an app credential can be constrained to market-data-only/read-only access; API approval, live/historical CME data entitlements, fees, Australian availability, and permitted storage/display. Keep this integration disabled until verified. |
| TradingView Premium | The official help page describes alert webhooks and requires two-factor authentication for webhook use. TradingView Premium is recorded as the user's existing subscription. | Whether the user's plan/account supports the intended webhook/alert configuration, and whether any official integration is permitted for this app. A webhook is an alert-delivery mechanism, not a general-purpose historical market-data API. Do not scrape TradingView or use undocumented endpoints. |
| Hosting and private sync | No vendor has been selected. | Compare current provider costs, Australian region/availability, private authentication, encrypted secrets, backups, operational burden, and lock-in before persistent journal storage or public deployment. |

## Official references checked

- [Bybit V5 — Query kline](https://bybit-exchange.github.io/docs/v5/market/kline): documents linear contracts, supported intervals, response fields, and a per-request candle limit of up to 1,000.
- [Bybit V5 — Market tickers](https://bybit-exchange.github.io/docs/v5/market/tickers): official ticker endpoint used by the app.
- [Tradovate API documentation](https://api.tradovate.com/): official API documentation landing page; the access scopes and entitlement details above remain unverified.
- [TradingView — Configure webhook alerts](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/): describes webhook delivery, 2FA requirement, endpoint restrictions, and delivery caveats. It does not establish account-plan eligibility for this user.
- [Bybit — Service restricted countries](https://www.bybit.com/en/help-center/article/Service-Restricted-Countries): could not be fetched during this review (HTTP 403); this is not evidence that Australian access is either permitted or prohibited.

## Data behavior implemented

The app makes server-side requests to `https://api.bybit.com/v5/market/tickers` and `/v5/market/kline` with `category=linear` and `symbol=BTCUSDT`. The dashboard requests 5-minute candles and refreshes at a 30-second interval. Unsupported candle intervals fall back to 5 minutes. Invalid provider responses and failed/timeout requests are surfaced; a prior dashboard snapshot is labeled stale after a failed refresh.

This is a live-data display slice, not a durable historical store or backtest feed. It fetches only the latest 120 candles. Later historical ingestion must paginate within provider limits and licensing terms and record actual coverage.
