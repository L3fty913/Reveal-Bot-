# Reveal Bot — NFT Quant Trading Engine

A modular, profit-seeking NFT trading and market-making engine for EVM NFT markets.

> No strategy can guarantee profit. This repository is engineered to measure expected edge after marketplace fees, royalties, gas, slippage, inventory risk, and adverse selection, and to refuse trades that do not clear configured risk/edge thresholds.

## Design goals

- Aggregate listings, bids, sales, floors, traits, and liquidity across marketplaces.
- Use Reservoir for normalized cross-market data/routing and OpenSea SDK/Seaport for native OpenSea execution.
- Support token offers, collection offers, trait offers, floor sweeping, relisting, inventory rebalancing, and cross-market arbitrage detection.
- Trait-aware fair-value estimation using recent sales, floor depth, top bids, rarity/trait premiums, liquidity, and time decay.
- Strict pre-trade risk engine: max inventory, max collection exposure, max daily loss, max gas, min expected edge, stale-data rejection, self-trade/wash-trade prevention, and circuit breakers.
- Paper trading and backtesting are first-class. Live trading is opt-in.
- Full PnL attribution: realized/unrealized PnL, fees, royalties, gas, inventory mark, and strategy attribution.
- Event-driven adapters so additional marketplaces/chains can be added without rewriting strategy logic.

## Architecture

```text
Market Data
  Reservoir REST/WebSocket
  OpenSea REST/SDK/Seaport
        |
        v
Normalized Order Book + Sales Tape
        |
        v
Valuation Engine ----> Opportunity Scanner
        |                    |
        v                    v
Portfolio State ------> Strategy Engine
        |                    |
        +------> Risk Engine <+
                      |
                APPROVE / REJECT
                      |
                      v
                Execution Engine
                 paper | live
                      |
                      v
              PnL / Audit Journal
```

## Initial strategies

1. **Bid-to-floor spread** — place bids only when modeled resale value clears all costs plus required edge.
2. **Trait mispricing** — buy/list NFTs where trait-adjusted fair value materially differs from ask.
3. **Cross-market arbitrage** — detect executable ask/bid dislocations across aggregated venues.
4. **Inventory market making** — maintain bids and asks around fair value while skewing quotes based on inventory.
5. **Liquidity sweeps** — opportunistically buy thin underpriced listings only when exit liquidity is measurable.

The engine explicitly excludes self-dealing, wash trading, fake-volume generation, spoofing, or coordinated manipulation.

## Safety defaults

- `TRADING_MODE=paper`
- Live execution requires `LIVE_TRADING=true` and a separate funded execution wallet.
- Keep only limited strategy capital in the hot wallet.
- Never commit private keys or API keys.

## Status

Build 000: repository foundation and deterministic strategy/risk core.
