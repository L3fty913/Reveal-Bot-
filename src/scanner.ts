import type { AppConfig } from "./config.js";
import type {
  CollectionMarket,
  CostEstimate,
  FairValueEstimate,
  NftSnapshot,
  Opportunity,
  Order,
} from "./domain.js";

function costs(exitPriceEth: number, gasEth: number, config: AppConfig["valuation"]): CostEstimate {
  const marketplaceFeeEth = exitPriceEth * config.marketplaceFeeBps / 10_000;
  const royaltyEth = exitPriceEth * config.royaltyBps / 10_000;
  const slippageEth = exitPriceEth * config.slippageBps / 10_000;
  const totalEth = marketplaceFeeEth + royaltyEth + slippageEth + gasEth;
  return { marketplaceFeeEth, royaltyEth, gasEth, slippageEth, totalEth };
}

function edgeBps(entry: number, profit: number): number {
  return entry > 0 ? Math.round((profit / entry) * 10_000) : -Infinity;
}

export interface TokenOpportunityInput {
  nft: NftSnapshot;
  market: CollectionMarket;
  valuation: FairValueEstimate;
  asks: Order[];
  bids: Order[];
  gasEth: number;
}

export class OpportunityScanner {
  constructor(private readonly valuationConfig: AppConfig["valuation"]) {}

  scanToken(input: TokenOpportunityInput): Opportunity[] {
    const opportunities: Opportunity[] = [];
    const asks = input.asks
      .filter((o) => o.side === "ask" && o.executable && o.priceEth > 0)
      .sort((a, b) => a.priceEth - b.priceEth);
    const bids = input.bids
      .filter((o) => o.side === "bid" && o.executable && o.priceEth > 0)
      .sort((a, b) => b.priceEth - a.priceEth);

    const bestAsk = asks[0];
    const bestBid = bids[0];

    if (bestAsk && input.valuation.conservativeExitEth > 0) {
      const modeledExit = input.valuation.conservativeExitEth;
      const c = costs(modeledExit, input.gasEth, this.valuationConfig);
      const profit = modeledExit - bestAsk.priceEth - c.totalEth;
      opportunities.push({
        id: `trait:${input.nft.contract}:${input.nft.tokenId}:${bestAsk.id}`,
        type: "trait_mispricing",
        collectionId: input.nft.collectionId,
        nft: input.nft,
        entryPriceEth: bestAsk.priceEth,
        modeledExitEth: modeledExit,
        costs: c,
        expectedProfitEth: profit,
        expectedEdgeBps: edgeBps(bestAsk.priceEth, profit),
        confidence: input.valuation.confidence,
        observedAt: Math.min(bestAsk.observedAt, input.market.observedAt),
        buyOrder: bestAsk,
        metadata: {
          fairValueEth: input.valuation.fairValueEth,
          conservativeExitEth: input.valuation.conservativeExitEth,
          traitPremiumBps: input.valuation.traitPremiumBps,
        },
      });
    }

    if (bestAsk && bestBid && bestBid.priceEth > bestAsk.priceEth) {
      const c = costs(bestBid.priceEth, input.gasEth, this.valuationConfig);
      const profit = bestBid.priceEth - bestAsk.priceEth - c.totalEth;
      opportunities.push({
        id: `arb:${input.nft.contract}:${input.nft.tokenId}:${bestAsk.id}:${bestBid.id}`,
        type: "cross_market_arbitrage",
        collectionId: input.nft.collectionId,
        nft: input.nft,
        entryPriceEth: bestAsk.priceEth,
        modeledExitEth: bestBid.priceEth,
        costs: c,
        expectedProfitEth: profit,
        expectedEdgeBps: edgeBps(bestAsk.priceEth, profit),
        confidence: Math.max(0, Math.min(1, input.valuation.confidence + 0.1)),
        observedAt: Math.min(bestAsk.observedAt, bestBid.observedAt),
        buyOrder: bestAsk,
        sellOrder: bestBid,
        metadata: { spreadEth: bestBid.priceEth - bestAsk.priceEth },
      });
    }

    if (input.market.floorAskEth > 0 && input.market.topBidEth > 0) {
      const desiredBid = Math.min(input.market.floorAskEth * 0.88, input.market.topBidEth * 1.0025);
      const modeledExit = Math.min(input.valuation.conservativeExitEth, input.market.floorAskEth * 0.99);
      if (desiredBid > 0 && modeledExit > 0) {
        const c = costs(modeledExit, input.gasEth, this.valuationConfig);
        const profit = modeledExit - desiredBid - c.totalEth;
        opportunities.push({
          id: `bid-floor:${input.nft.collectionId}:${input.nft.contract}:${input.nft.tokenId}`,
          type: "bid_to_floor",
          collectionId: input.nft.collectionId,
          nft: input.nft,
          entryPriceEth: desiredBid,
          modeledExitEth: modeledExit,
          costs: c,
          expectedProfitEth: profit,
          expectedEdgeBps: edgeBps(desiredBid, profit),
          confidence: input.valuation.confidence * 0.9,
          observedAt: input.market.observedAt,
          metadata: {
            currentTopBidEth: input.market.topBidEth,
            currentFloorEth: input.market.floorAskEth,
          },
        });
      }
    }

    return opportunities
      .filter((o) => Number.isFinite(o.expectedEdgeBps))
      .sort((a, b) => {
        const scoreA = a.expectedEdgeBps * a.confidence;
        const scoreB = b.expectedEdgeBps * b.confidence;
        return scoreB - scoreA;
      });
  }
}
