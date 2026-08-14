import { loadConfig } from "./config.js";
import type { Address, Opportunity, PortfolioState, TradeProposal } from "./domain.js";
import { buildTradeProposal } from "./proposal.js";
import { ReservoirClient } from "./reservoir.js";
import { RiskEngine } from "./risk.js";
import { OpportunityScanner } from "./scanner.js";
import { ValuationEngine } from "./valuation.js";

interface Args {
  collection: string;
  contract: Address;
  tokens: string[];
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
  const cashEth = Number(map.get("cash") ?? "1");
  const gasEth = Number(map.get("gas") ?? "0.003");

  if (!collection) throw new Error("Missing --collection <collection-id>");
  if (!contract || !/^0x[a-fA-F0-9]{40}$/.test(contract)) throw new Error("Missing/invalid --contract <0x...>");
  if (tokens.length === 0) throw new Error("Missing --tokens <id,id,...>");
  if (!Number.isFinite(cashEth) || cashEth <= 0) throw new Error("--cash must be positive");
  if (!Number.isFinite(gasEth) || gasEth < 0) throw new Error("--gas must be non-negative");

  return { collection, contract, tokens, cashEth, gasEth };
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

  const opportunities: Opportunity[] = [];
  for (const tokenId of args.tokens) {
    const [nft, orders] = await Promise.all([
      reservoir.getToken(args.collection, args.contract, tokenId),
      reservoir.getOrders(args.collection, args.contract, tokenId),
    ]);
    const valuation = valuationEngine.estimate({ nft, market, sales });
    opportunities.push(...scanner.scanToken({ nft, market, valuation, asks: orders.asks, bids: orders.bids, gasEth: args.gasEth }));
  }

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
