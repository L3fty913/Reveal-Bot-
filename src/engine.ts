import type { AppConfig } from "./config.js";
import type { Address, Opportunity, PortfolioState, RiskDecision, TradeProposal } from "./domain.js";
import { buildTradeProposal } from "./proposal.js";
import { ReservoirClient, type DiscoveredToken } from "./reservoir.js";
import { RiskEngine } from "./risk.js";
import { OpportunityScanner } from "./scanner.js";
import { StateStore } from "./store.js";
import { ValuationEngine } from "./valuation.js";

export interface ScanTarget {
  collectionId: string;
  contract: Address;
  tokenIds?: string[];
  discoverLimit?: number;
  concurrency?: number;
  cashEth: number;
  gasEth: number;
}

export interface RankedOpportunity {
  opportunity: Opportunity;
  decision: RiskDecision;
  proposal: TradeProposal | null;
}

export interface ScanResult {
  startedAt: number;
  finishedAt: number;
  mode: AppConfig["tradingMode"];
  collectionId: string;
  discoveryMode: boolean;
  tokensScanned: number;
  saleComparables: number;
  approvedCount: number;
  queuedProposalIds: number[];
  ranked: RankedOpportunity[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function emptyPortfolio(cashEth: number): PortfolioState {
  return {
    cashEth,
    realizedPnlEth: 0,
    unrealizedPnlEth: 0,
    dailyPnlEth: 0,
    positions: [],
    openOrders: [],
  };
}

export async function runCollectionScan(
  config: AppConfig,
  target: ScanTarget,
  store?: StateStore,
  portfolio: PortfolioState = emptyPortfolio(target.cashEth),
): Promise<ScanResult> {
  const startedAt = Date.now();
  const reservoir = new ReservoirClient(config);
  const valuationEngine = new ValuationEngine(config.valuation);
  const scanner = new OpportunityScanner(config.valuation);
  const risk = new RiskEngine(config.risk);
  const discoverLimit = Math.min(Math.max(target.discoverLimit ?? 25, 1), 100);
  const concurrency = Math.min(Math.max(target.concurrency ?? 4, 1), 10);

  const [market, sales] = await Promise.all([
    reservoir.getCollectionMarket(target.collectionId),
    reservoir.getSales(target.collectionId, target.contract, config.valuation.saleLookbackHours),
  ]);

  let discovered: DiscoveredToken[] = [];
  let tokenIds = target.tokenIds?.filter(Boolean) ?? [];
  const discoveryMode = tokenIds.length === 0;
  if (discoveryMode) {
    discovered = await reservoir.discoverListedTokens(target.collectionId, target.contract, discoverLimit);
    tokenIds = discovered
      .filter((candidate) => candidate.floorAskEth > 0)
      .sort((a, b) => {
        const aSpread = a.floorAskEth > 0 ? a.topBidEth / a.floorAskEth : 0;
        const bSpread = b.floorAskEth > 0 ? b.topBidEth / b.floorAskEth : 0;
        return bSpread - aSpread || a.floorAskEth - b.floorAskEth;
      })
      .map((candidate) => candidate.nft.tokenId);
  }

  const discoveredByToken = new Map(discovered.map((candidate) => [candidate.nft.tokenId, candidate]));
  const batches = await mapLimit(tokenIds, concurrency, async (tokenId) => {
    const candidate = discoveredByToken.get(tokenId);
    const [nft, orders] = await Promise.all([
      candidate ? Promise.resolve(candidate.nft) : reservoir.getToken(target.collectionId, target.contract, tokenId),
      reservoir.getOrders(target.collectionId, target.contract, tokenId),
    ]);
    const valuation = valuationEngine.estimate({ nft, market, sales });
    return scanner.scanToken({ nft, market, valuation, asks: orders.asks, bids: orders.bids, gasEth: target.gasEth });
  });

  const opportunities = batches.flat();
  for (const opportunity of opportunities) store?.upsertOpportunity(opportunity);

  const ranked: RankedOpportunity[] = opportunities
    .map((opportunity) => {
      const decision = risk.evaluate(opportunity, portfolio);
      const proposal = buildTradeProposal(opportunity, decision);
      return { opportunity, decision, proposal };
    })
    .sort((a, b) => (b.opportunity.expectedEdgeBps * b.opportunity.confidence) - (a.opportunity.expectedEdgeBps * a.opportunity.confidence));

  const approved = ranked.flatMap((row) => row.proposal ? [row.proposal] : []);
  const queuedProposalIds = config.tradingMode === "proposal" && store
    ? approved.map((proposal) => store.enqueueProposal(proposal))
    : [];

  store?.recordScanRun({
    startedAt,
    collectionId: target.collectionId,
    tokensScanned: tokenIds.length,
    opportunities: opportunities.length,
    approved: approved.length,
  });

  return {
    startedAt,
    finishedAt: Date.now(),
    mode: config.tradingMode,
    collectionId: target.collectionId,
    discoveryMode,
    tokensScanned: tokenIds.length,
    saleComparables: sales.length,
    approvedCount: approved.length,
    queuedProposalIds,
    ranked,
  };
}
