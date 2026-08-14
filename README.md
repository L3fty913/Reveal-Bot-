# Reveal Bot — NFT Quant Trading Engine

A standalone, modular NFT market-analysis, paper-trading, and trade-proposal engine for EVM NFT markets.

> No strategy can guarantee profit. Reveal Bot is designed to measure expected edge after marketplace fees, royalties, gas, slippage, inventory risk, liquidity, and adverse selection, and to reject opportunities that do not clear configured risk/edge thresholds.

## What it does

- Aggregates listings, bids, sales, floors, traits, and liquidity through Reservoir.
- Keeps OpenSea SDK/Seaport available as a first-party OpenSea integration layer.
- Normalizes marketplace data into one order/sales model.
- Calculates trait-aware fair value from recency-weighted comparable sales, floor, top bid, liquidity, and trait similarity.
- Applies conservative liquidity and uncertainty haircuts before estimating an exit.
- Calculates **net expected profit and edge after costs**.
- Detects token mispricing, bid-to-floor spreads, and executable cross-market ask/bid dislocations.
- Enforces portfolio risk controls before producing a trade proposal.
- Supports historical walk-forward testing and paper-mode operation.
- Produces short-lived, human-authorized trade proposals instead of storing a wallet private key or signing transactions unattended.

## Architecture

```text
Reservoir / OpenSea Market Data
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
   Paper Result / Trade Proposal
              |
              v
        PnL + Evaluation
```

## Strategies in the deterministic core

1. **Trait mispricing** — compare the cheapest executable ask with a conservative trait-adjusted exit value.
2. **Cross-market arbitrage detection** — compare executable ask and bid liquidity and subtract all modeled costs.
3. **Bid-to-floor spread** — calculate a bid level from the current top bid/floor relationship and reject it unless modeled resale edge survives costs.

Planned strategy modules can add inventory-aware market making, collection/trait offer optimization, floor-depth sweeps, and portfolio rebalancing without changing the domain/risk layer.

The engine explicitly excludes self-dealing, wash trading, fake-volume generation, spoofing, or coordinated manipulation.

## Quick start

```bash
npm install
cp .env.example .env
npm run check
npm test

# Example scan
npm run dev -- \
  --collection 0xCOLLECTION_OR_RESERVOIR_COLLECTION_ID \
  --contract 0xCONTRACT_ADDRESS \
  --tokens 1,2,3,4,5 \
  --cash 1.0 \
  --gas 0.003
```

The command returns collection state, comparable-sale count, every scored opportunity, each risk decision, and the proposals that survived the configured thresholds.

## Risk controls

Defaults are deliberately restrictive and live in `.env.example`:

- minimum expected edge
- minimum valuation confidence
- maximum single-trade size
- maximum collection exposure
- maximum total inventory
- maximum daily loss
- maximum gas estimate
- maximum market-data age
- maximum open bids per collection

## Backtesting

`src/backtest.ts` contains a walk-forward historical-sale backtester. It never uses future sales to create an entry signal. It measures resolved trades, unresolved signals, win rate, net PnL, average return, and maximum drawdown after modeled fees, royalties, slippage, and gas.

## Repository status

**Build 000 complete:** domain model, config, Reservoir adapter, trait valuation, opportunity scanner, portfolio risk engine, proposal generator, historical backtester, unit tests, and CI.

Next build should focus on real-time websocket ingestion, persistent orderbook/state, portfolio accounting, strategy calibration, and a review UI for approving/rejecting generated proposals.
