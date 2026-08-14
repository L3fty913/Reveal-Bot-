import type { AppConfig } from "./config.js";
import type { Opportunity, PortfolioState, RiskDecision } from "./domain.js";

export class RiskEngine {
  constructor(private readonly config: AppConfig["risk"]) {}

  evaluate(opportunity: Opportunity, portfolio: PortfolioState, now = Date.now()): RiskDecision {
    const reasons: string[] = [];
    const totalInventory = portfolio.positions.reduce((sum, p) => sum + p.markedValueEth, 0);
    const collectionExposure = portfolio.positions
      .filter((p) => p.collectionId === opportunity.collectionId)
      .reduce((sum, p) => sum + p.markedValueEth, 0);
    const openCollectionBids = portfolio.openOrders.filter(
      (order) => order.collectionId === opportunity.collectionId && order.side === "bid",
    ).length;

    if (now - opportunity.observedAt > this.config.maxDataAgeMs) reasons.push("market data is stale");
    if (opportunity.expectedEdgeBps < this.config.minExpectedEdgeBps) reasons.push("edge below configured minimum");
    if (opportunity.confidence < this.config.minConfidence) reasons.push("valuation confidence too low");
    if (opportunity.entryPriceEth > this.config.maxSingleTradeEth) reasons.push("single trade size too large");
    if (opportunity.entryPriceEth > portfolio.cashEth) reasons.push("insufficient modeled cash");
    if (collectionExposure + opportunity.entryPriceEth > this.config.maxCollectionExposureEth) {
      reasons.push("collection exposure limit exceeded");
    }
    if (totalInventory + opportunity.entryPriceEth > this.config.maxTotalInventoryEth) {
      reasons.push("total inventory limit exceeded");
    }
    if (portfolio.dailyPnlEth <= -this.config.maxDailyLossEth) reasons.push("daily loss circuit breaker active");
    if (opportunity.costs.gasEth > this.config.maxGasEth) reasons.push("gas estimate exceeds limit");
    if (openCollectionBids >= this.config.maxOpenBidsPerCollection && opportunity.type === "bid_to_floor") {
      reasons.push("maximum collection bid count reached");
    }
    if (opportunity.expectedProfitEth <= 0) reasons.push("expected profit is not positive after costs");

    const maxSpendEth = Math.max(
      0,
      Math.min(
        portfolio.cashEth,
        this.config.maxSingleTradeEth,
        this.config.maxCollectionExposureEth - collectionExposure,
        this.config.maxTotalInventoryEth - totalInventory,
      ),
    );

    return {
      approved: reasons.length === 0 && opportunity.entryPriceEth <= maxSpendEth,
      reasons,
      maxSpendEth,
    };
  }
}
