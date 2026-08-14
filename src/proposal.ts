import type { Opportunity, RiskDecision, TradeProposal, Venue } from "./domain.js";

function venueFor(opportunity: Opportunity): Venue {
  return opportunity.buyOrder?.venue ?? opportunity.sellOrder?.venue ?? "reservoir";
}

export function buildTradeProposal(
  opportunity: Opportunity,
  risk: RiskDecision,
  ttlMs = 30_000,
  now = Date.now(),
): TradeProposal | null {
  if (!risk.approved) return null;

  const action: TradeProposal["action"] = opportunity.type === "bid_to_floor" ? "bid" : "buy";
  return {
    opportunityId: opportunity.id,
    action,
    venue: venueFor(opportunity),
    collectionId: opportunity.collectionId,
    nft: opportunity.nft,
    limitPriceEth: Math.min(opportunity.entryPriceEth, risk.maxSpendEth),
    expectedProfitEth: opportunity.expectedProfitEth,
    expectedEdgeBps: opportunity.expectedEdgeBps,
    expiresAt: now + ttlMs,
    rationale: [
      `${opportunity.type} opportunity`,
      `modeled exit ${opportunity.modeledExitEth.toFixed(4)} ETH`,
      `net expected profit ${opportunity.expectedProfitEth.toFixed(4)} ETH`,
      `net expected edge ${opportunity.expectedEdgeBps} bps`,
      `confidence ${opportunity.confidence.toFixed(2)}`,
    ],
  };
}
