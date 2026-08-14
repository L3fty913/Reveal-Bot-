import { loadConfig } from "./config.js";
import type { Address, Opportunity, PortfolioState, TradeProposal } from "./domain.js";
import { buildTradeProposal } from "./proposal.js";
import { ReservoirClient, type DiscoveredToken } from "./reservoir.js";
import { RiskEngine } from "./risk.js";
import { OpportunityScanner } from "./scanner.js";
import { ValuationEngine } from "./valuation.js";

interface Args {
  collection: string;
  contract: Address;
  tokens: string[];
  discoverLimit: number;
  concurrency: number;
  cashEth: number;
  gasEth: number;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key?.startsWith("--") && value) map.set(key.slice(2), value);
  }

  const collection = map.get("collection");
  const contract = map.get("contract") as Address | undefined;
  const tokens = (map.get("tokens") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const discoverLimit = Number(map.get("discover") ?? "25");
  const concurrency = Number(map.get("concurrency") ?? "4");
  const cashEth = Number(map.get("cash") ?? "1");
  const gasEth = Number(map.get("gas") ?? "0.003");

  if (!collection) throw new Error("Missing --collection <collection-id>");
  if (!contract || !/^0x[a-fA-F0-9]{40}$/.test(contract)) throw new Error("Missing/invalid --contract <0x...>");
  if (!Number.isInteger(discoverLimit) || discoverLimit < 1 || discoverLimit > 100) throw new Error("--discover must be an integer from 1 to 100");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error("--concurrency must be an integer from 1 to 10");
  if (!Number.isFinite(cashEth) || cashEth <= 0) throw new Error("--cash must be positive");
  if (!Number.isFinite(gasEth) || gasEth < 0) throw new Error("--gas must be non-negative");

  return { collection, contract, tokens, discoverLimit, concurrency, cashEth, gasEth };
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

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const reservoir = new ReservoirClient(config);
  const valuationEngine = new ValuationEngine(config.valuation);
  const scanner = new OpportunityScanner(config.valuation);
  const risk = new RiskEngine(config.risk);

  const portfolio: PortfolioState = {
    cashEth: args.cashEth,
    realizedPnlEth: 0,
    unrealizedPnlEth: 0,
    dailyPnlEth: 0,
    positions: [],
    openOrders: [],
  };

  const [market, sales] = await Promise.all([
    reservoir.getCollectionMarket(args.collection),
    reservoir.getSales(args.collection, args.contract, config.valuation.saleLookbackHours),
  ]);

  let discovered: DiscoveredToken[] = [];
  let tokenIds = args.tokens;
  if (tokenIds.length === 0) {
    discovered = await reservoir.discoverListedTokens(args.collection, args.contract, args.discoverLimit);
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
  const batches = await mapLimit(tokenIds, args.concurrency, async (tokenId) => {
    const candidate = discoveredByToken.get(tokenId);
    const [nft, orders] = await Promise.all([
      candidate ? Promise.resolve(candidate.nft) : reservoir.getToken(args.collection, args.contract, tokenId),
      reservoir.getOrders(args.collection, args.contract, tokenId),
    ]);
    const valuation = valuationEngine.estimate({ nft, market, sales });
    return scanner.scanToken({ nft, market, valuation, asks: orders.asks, bids: orders.bids, gasEth: args.gasEth });
  });

  const opportunities: Opportunity[] = batches.flat();
  const ranked = opportunities
    .map((opportunity) => {
      const decision = risk.evaluate(opportunity, portfolio);
      const proposal = buildTradeProposal(opportunity, decision);
      return { opportunity, decision, proposal };
    })
    .sort((a, b) => (b.opportunity.expectedEdgeBps * b.opportunity.confidence) - (a.opportunity.expectedEdgeBps * a.opportunity.confidence));

  const approved: TradeProposal[] = ranked.flatMap((row) => row.proposal ? [row.proposal] : []);
  console.log(JSON.stringify({
    mode: config.tradingMode,
    collection: args.collection,
    discoveryMode: args.tokens.length === 0,
    tokensScanned: tokenIds.length,
    market,
    saleComparables: sales.length,
    approvedCount: approved.length,
    approved,
    ranked,
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
