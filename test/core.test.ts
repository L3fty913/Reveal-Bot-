import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import type { CollectionMarket, NftSnapshot, Opportunity, PortfolioState, Sale } from "../src/domain.js";
import { buildTradeProposal } from "../src/proposal.js";
import { RiskEngine } from "../src/risk.js";
import { OpportunityScanner } from "../src/scanner.js";
import { ValuationEngine } from "../src/valuation.js";

const valuationConfig: AppConfig["valuation"] = {
  minComparableSales: 3,
  saleLookbackHours: 168,
  liquidityHaircutBps: 500,
  uncertaintyHaircutBps: 750,
  marketplaceFeeBps: 250,
  royaltyBps: 500,
  slippageBps: 100,
};

const riskConfig: AppConfig["risk"] = {
  minExpectedEdgeBps: 800,
  maxSingleTradeEth: 0.5,
  maxCollectionExposureEth: 2,
  maxTotalInventoryEth: 5,
  maxDailyLossEth: 0.25,
  maxGasEth: 0.015,
  maxDataAgeMs: 15_000,
  maxOpenBidsPerCollection: 8,
  minConfidence: 0.6,
};

const now = 1_800_000_000_000;
const nft: NftSnapshot = {
  chainId: 1,
  contract: "0x1111111111111111111111111111111111111111",
  tokenId: "7",
  collectionId: "test-collection",
  traits: [{ key: "Fur", value: "Gold" }],
  observedAt: now,
};

const market: CollectionMarket = {
  collectionId: "test-collection",
  floorAskEth: 1,
  topBidEth: 0.75,
  floorDepth5Pct: 12,
  floorDepth10Pct: 30,
  sales24h: 20,
  volume24hEth: 20,
  uniqueBuyers24h: 15,
  uniqueSellers24h: 12,
  observedAt: now,
};

const sales: Sale[] = [0.95, 1.0, 1.05, 1.15, 1.2].map((priceEth, i) => ({
  txHash: `0x${String(i + 1).padStart(64, "0")}`,
  venue: "opensea",
  nft: { chainId: 1, contract: nft.contract, tokenId: String(i + 100) },
  collectionId: nft.collectionId,
  traits: i >= 3 ? [{ key: "Fur", value: "Gold" }] : [{ key: "Fur", value: "Brown" }],
  priceEth,
  timestamp: now - (i + 1) * 3_600_000,
}));

test("valuation is trait-aware and conservative", () => {
  const estimate = new ValuationEngine(valuationConfig).estimate({ nft, market, sales, now });
  assert.ok(estimate.fairValueEth > 0);
  assert.ok(estimate.conservativeExitEth > 0);
  assert.ok(estimate.conservativeExitEth < estimate.fairValueEth);
  assert.ok(estimate.confidence > 0.5);
  assert.ok(estimate.traitPremiumBps >= 0);
});

test("scanner ranks an executable cross-market spread after costs", () => {
  const scanner = new OpportunityScanner(valuationConfig);
  const opportunities = scanner.scanToken({
    nft,
    market,
    valuation: {
      fairValueEth: 1,
      conservativeExitEth: 0.92,
      confidence: 0.9,
      comparableSales: 8,
      traitPremiumBps: 0,
      liquidityHaircutBps: 500,
      uncertaintyHaircutBps: 750,
      reasons: [],
    },
    asks: [{
      id: "ask-1", venue: "opensea", side: "ask", collectionId: nft.collectionId, nft,
      priceEth: 0.60, validFrom: now - 1000, validUntil: now + 60_000, observedAt: now, executable: true,
    }],
    bids: [{
      id: "bid-1", venue: "magiceden", side: "bid", collectionId: nft.collectionId, nft,
      priceEth: 0.80, validFrom: now - 1000, validUntil: now + 60_000, observedAt: now, executable: true,
    }],
    gasEth: 0.003,
  });
  const arb = opportunities.find((x) => x.type === "cross_market_arbitrage");
  if (!arb) assert.fail("expected a cross-market arbitrage opportunity");
  assert.ok(arb.expectedProfitEth > 0);
  assert.ok(arb.expectedEdgeBps > 0);
});

test("risk engine rejects stale or weak opportunities and proposal requires approval", () => {
  const risk = new RiskEngine(riskConfig);
  const portfolio: PortfolioState = {
    cashEth: 1,
    realizedPnlEth: 0,
    unrealizedPnlEth: 0,
    dailyPnlEth: 0,
    positions: [],
    openOrders: [],
  };
  const weak: Opportunity = {
    id: "weak",
    type: "trait_mispricing",
    collectionId: nft.collectionId,
    nft,
    entryPriceEth: 0.2,
    modeledExitEth: 0.22,
    costs: { marketplaceFeeEth: 0.005, royaltyEth: 0.01, gasEth: 0.003, slippageEth: 0.002, totalEth: 0.02 },
    expectedProfitEth: 0,
    expectedEdgeBps: 0,
    confidence: 0.4,
    observedAt: now - 60_000,
  };
  const decision = risk.evaluate(weak, portfolio, now);
  assert.equal(decision.approved, false);
  assert.equal(buildTradeProposal(weak, decision, 30_000, now), null);
});
