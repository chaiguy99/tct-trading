# TCT Research

A private, responsive trading-research workspace. It provides owner-only sign-in, protected Bybit BTCUSDT linear-perpetual market data, and a private trade journal with a paper-only ledger and configurable risk limits. Tradovate and TradingView remain visibly marked for review until their access, data rights, and Australian availability are verified.

**This application is research-only. It does not submit orders to a broker or exchange.**

## Run locally

Requirements: Node.js 20.9 or newer and npm.

```sh
npm install
cp .env.example .env.local
npm run auth:hash-password
```

The password command prompts without echoing the password and prints a scrypt hash in a dotenv-safe format. Put that output in `OWNER_PASSWORD_HASH` in `.env.local`, set `OWNER_EMAIL`, and generate `NEXTAUTH_SECRET` with `openssl rand -base64 32`. Keep `.env.local` private; it is ignored by Git. Then start the app:

```sh
npm run dev
```

Open `http://localhost:3000`. There is no public sign-up. The one owner account is configured through server environment variables; the app does not store provider credentials.

Open **Journal** from the dashboard to record manual trades or paper simulations. By default, the database is created automatically at `.data/journal.sqlite` with private directory/file permissions; this path is ignored by Git. To use hosted storage, set the server-only `DATABASE_URL` to a Supabase Postgres connection string and apply the migration first: open [`supabase/migrations/20261012000000_journal_schema.sql`](supabase/migrations/20261012000000_journal_schema.sql) in the repository, copy the SQL statements inside that file, paste those statements into the Supabase SQL Editor, and run them. Do **not** paste the file path itself into the SQL Editor. The app uses Postgres whenever `DATABASE_URL` is set; otherwise, it uses local SQLite. The first paper position is blocked until you enter separate USD and USDT balances and daily loss caps. Futures use their point values for P&L (MNQ $2/point, NQ $20/point); BTCUSDT is measured in USDT. Results are not combined across USD and USDT.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

## Current scope and deployment notes

- Sign-in uses an owner-configured email and scrypt password hash with NextAuth.js sessions. The session lifetime is 12 hours.
- The market-data route requires a valid session. It fetches public Bybit ticker and candle data server-side; no Bybit API key is required for those public endpoints.
- Market data is refreshed in the dashboard every 30 seconds. A failed refresh preserves the last result but marks it stale and shows the error.
- Times are rendered in the viewer's browser-local timezone, with a separate New York clock for session context.
- Tradovate credentials are deliberately not requested until a read-only access model and data entitlement are confirmed. TradingView Premium is included in the review but is not treated as an app API or market-data license.
- Manual journal and internal paper records support multiple entries/exits, partial fills, per-fill fees, per-position funding, setup/context/thesis/notes, realized P&L, win rate, expectancy, profit factor, drawdown, and R-multiple.
- CSV import accepts up to 500 fresh journal records per file (1 MB max) after preview and full-row validation. Each row creates one position with a single entry and optional partial/full exit. Required columns: `instrument,side,quantity,price`; optional columns: `fee,riskAmount,funding,setup,marketCondition,thesis,notes,filledAt,exitQuantity,exitPrice,exitFee,exitAt`. Timestamps must be ISO 8601 with a timezone; an exit requires both `exitQuantity` and `exitPrice`. Imports are all-or-nothing and journal-only; they do not create or modify paper trades. Re-importing a file creates duplicates.
- The Journal page can download a versioned JSON backup of all owner-scoped trades, fills, metrics, and paper risk settings. Store downloaded backups securely; they contain private journal notes.
- Paper entries require a configured quote-currency balance and daily loss cap, a planned risk amount within the per-trade risk cap, and available position/leverage headroom. Additional paper entries are checked against the same leverage/risk caps. These are research guardrails, not broker margin calculations or guaranteed loss stops.
- SQLite is local persistent storage for development or a single persistent server. It does **not** sync between devices by itself. Do not deploy to ephemeral/serverless storage or multiple app instances expecting shared data. Choose a hosted database/backup plan before using the journal across devices.
- Supabase setup: create the project in the Sydney region; run the SQL migration above; retrieve the server-side connection string from Supabase's Connect panel (use the transaction pooler for serverless deployment); store it as `DATABASE_URL` in the hosting provider's server environment. Never use a `NEXT_PUBLIC_` variable or expose the connection string to browser code. The Postgres adapter uses TLS, disables prepared statements, and limits each application instance to one pool connection. All application reads/writes filter by the signed-in owner ID; RLS is enabled with no browser-access policies.
- The Supabase Free plan is suitable for trying the sync workflow, but projects may pause after a week of inactivity and the Free tier does not include downloadable database backups. Use the app's authenticated JSON backup export regularly and keep copies securely outside the app. Confirm the current plan, pause behavior, backup options, and Sydney-region availability in your account before relying on it as the sole copy of journal data. The JSON backup is an export; automatic restore/migration tooling is not yet implemented.
- Optional journal Q&A uses an OpenAI-compatible chat-completions endpoint. It is disabled unless `JOURNAL_AI_BASE_URL` and `JOURNAL_AI_MODEL` are set; remote endpoints also require `JOURNAL_AI_API_KEY`. Use HTTPS for remote providers; loopback HTTP is permitted for a local model server. Credentials remain server-side. Each question requires explicit consent and sends the question plus up to the 50 most recently updated trades (including setup/context, thesis, notes, performance, and up to 10 fills per trade) to that endpoint. Review its privacy terms and costs before enabling it. Answers are read-only and can be wrong; they are not trading advice.
- Screenshots, scanner, and backtests are not implemented yet.

Before exposing a deployment to the public internet, choose a single persistent host or hosted database/private-sync provider, configure HTTPS and production secrets, apply deployment-level sign-in rate limits, verify backup/restore, and complete the data-provider checks in [`docs/market-data-access.md`](docs/market-data-access.md). Do not put passwords, API tokens, or other secrets in source control, URLs, screenshots, logs, or chat.
