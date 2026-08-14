# Reveal Bot — Standalone NFT Quant Engine

Reveal Bot is a standalone NFT market-analysis, paper-mode opportunity evaluation, and trade-proposal engine for EVM NFT markets.

> No strategy can guarantee profit. The engine is built to reject weak trades by measuring expected edge after marketplace fees, royalties, gas, slippage, inventory concentration, liquidity, uncertainty, and adverse selection.

## Current capabilities

- Pulls normalized NFT listings, bids, sales, collection data, token metadata, and traits from Reservoir using native HTTP.
- Automatically discovers the cheapest listed candidates in a collection; manually supplied token IDs are optional.
- Optionally listens to Reservoir real-time ask, bid, and sale events and immediately wakes the scanner, while retaining polling as a fallback.
- Calculates trait-aware fair value from recency-weighted comparable sales, floor, top bid, liquidity, and trait similarity.
- Applies dynamic liquidity and uncertainty haircuts to create a conservative modeled exit value.
- Calculates net expected profit and expected edge after modeled costs.
- Detects trait mispricing, bid-to-floor spreads, and executable cross-market ask/bid dislocations.
- Enforces portfolio risk limits before an opportunity can become a proposal.
- Persists scan history, scored opportunities, and expiring proposals in SQLite.
- Runs one-off scans or a continuous multi-collection watchlist daemon.
- Exposes a local review API for listing, approving, or rejecting queued proposals.
- Includes a walk-forward historical-sale backtester, unit tests, runtime dependency audit, strict TypeScript checks, and GitHub Actions CI.

Reveal Bot does **not** store wallet private keys, autonomously sign transactions, or broadcast purchases/sales. Proposal approval is review state only.

## Architecture

```text
Reservoir HTTP + Optional WebSocket Events
                   |
                   v
           Candidate Discovery
                   |
                   v
        Normalized Orders + Sales
                   |
                   v
          Trait Valuation Engine
                   |
                   v
          Opportunity Scanner
                   |
                   v
              Risk Engine
                   |
            APPROVE / REJECT
                   |
                   v
      Paper Evaluation / Proposal
                   |
             +-----+-----+
             |           |
             v           v
        SQLite State   Review API
```

## Deterministic strategies

1. **Trait mispricing** — compare the cheapest executable ask with a conservative trait-adjusted exit value.
2. **Cross-market arbitrage detection** — compare executable ask and bid liquidity and subtract all modeled costs.
3. **Bid-to-floor spread** — calculate a candidate bid from the current top-bid/floor relationship and reject it unless modeled resale edge survives costs.

The engine explicitly excludes self-dealing, wash trading, fake-volume generation, spoofing, or coordinated manipulation.

## Install

```bash
npm install
cp .env.example .env
npm run audit:runtime
npm run check
npm test
```

Set `RESERVOIR_API_KEY` in `.env` for production use.

## Autonomous collection scan

Omit `--tokens` and Reveal Bot discovers listed candidates automatically:

```bash
npm run scan -- \
  --collection YOUR_RESERVOIR_COLLECTION_ID \
  --contract 0xYOUR_CONTRACT \
  --discover 25 \
  --concurrency 4 \
  --cash 1.0 \
  --gas 0.003
```

To deep-scan specific tokens instead:

```bash
npm run scan -- \
  --collection YOUR_RESERVOIR_COLLECTION_ID \
  --contract 0xYOUR_CONTRACT \
  --tokens 1,2,3,4,5 \
  --cash 1.0 \
  --gas 0.003
```

In `TRADING_MODE=paper`, approved opportunities are evaluated and returned but not queued. In `TRADING_MODE=proposal`, approved opportunities are also persisted as short-lived review proposals.

## Continuous multi-collection daemon

```bash
cp watchlist.example.json watchlist.json
# Edit watchlist.json with real collections/contracts and capital assumptions.
npm run daemon
```

Each target can define `collectionId`, `contract`, optional `tokenIds`, `discoverLimit`, `concurrency`, modeled `cashEth`, and `gasEth`. A failure on one collection is isolated so the daemon can continue scanning the rest of the watchlist.

### Optional real-time triggers

Polling is always available. For lower-latency rescans, configure:

```text
REALTIME_ENABLED=true
REALTIME_DEBOUNCE_MS=1500
RESERVOIR_API_KEY=...
```

The watcher subscribes to filtered `ask.created`, `ask.updated`, `bid.created`, `bid.updated`, and `sale.created` events for watchlist contracts, reconnects with exponential backoff, and wakes the scanner when the market changes. Reservoir mainnet WebSockets require an eligible Data Syncing plan.

## Proposal review API

The review service binds to `127.0.0.1` by default.

```bash
# Configure a strong REVIEW_API_TOKEN in .env before enabling mutations.
npm run serve
```

Endpoints:

```text
GET  /health
GET  /proposals?limit=50
POST /proposals/:id/approve
POST /proposals/:id/reject
```

Mutation requests require `Authorization: Bearer <REVIEW_API_TOKEN>`. Approving a proposal never signs or submits an on-chain transaction.

## Risk controls

Configured in `.env`:

- minimum expected edge
- minimum valuation confidence
- maximum single-trade size
- maximum collection exposure
- maximum total inventory
- maximum daily loss circuit breaker
- maximum gas estimate
- maximum market-data age
- maximum open bids per collection

## Backtesting

`src/backtest.ts` contains a walk-forward historical-sale backtester. Entry signals only use prior sales. It reports resolved/unresolved signals, win rate, net PnL, average return, and maximum drawdown after modeled fees, royalties, slippage, and gas.

Historical repeat-sale testing is useful for strategy calibration but is not a substitute for historical order-book replay.

## Repository status

**Operational core complete:** normalized domain model, configuration, Reservoir adapter, autonomous discovery, optional WebSocket market triggers, trait valuation, opportunity scanning, risk engine, proposal generation, SQLite persistence, local review API, multi-collection daemon, historical backtesting, tests, runtime audit, MIT license, and CI.

### Highest-value next upgrades

- True order-book depth and source-specific marketplace fee/royalty modeling instead of generic cost assumptions.
- Wallet/portfolio reconciliation so inventory exposure and realized/unrealized PnL come from actual holdings rather than modeled state.
- Historical order-book capture/replay for statistically meaningful strategy validation.
- Strategy calibration by collection regime, liquidity, volatility, hold time, and trait cohort.
- A review dashboard and transaction-builder output that a user-controlled wallet can inspect and sign.

Those upgrades improve execution quality and evidence of edge; they still cannot guarantee profitability.
