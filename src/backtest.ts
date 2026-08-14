import type { AppConfig } from "./config.js";
import type { Sale } from "./domain.js";

export interface BacktestTrade {
  token: string;
  entryAt: number;
  exitAt: number;
  entryEth: number;
  exitEth: number;
  costsEth: number;
  pnlEth: number;
  returnBps: number;
}

export interface BacktestResult {
  resolvedTrades: number;
  unresolvedSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlEth: number;
  averagePnlEth: number;
  averageReturnBps: number;
  maxDrawdownEth: number;
  trades: BacktestTrade[];
}

export interface BacktestOptions {
  minDiscountBps?: number;
  lookbackSales?: number;
  maxHoldDays?: number;
  gasEth?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return sorted[mid] ?? 0;
}

function tokenKey(sale: Sale): string {
  return `${sale.nft.contract}:${sale.nft.tokenId}`;
}

export function runSaleBacktest(
  sales: Sale[],
  valuationConfig: AppConfig["valuation"],
  options: BacktestOptions = {},
): BacktestResult {
  const minDiscountBps = options.minDiscountBps ?? 1_500;
  const lookbackSales = options.lookbackSales ?? 50;
  const maxHoldMs = (options.maxHoldDays ?? 30) * 86_400_000;
  const gasEth = options.gasEth ?? 0.003;
  const ordered = [...sales].filter((s) => s.priceEth > 0).sort((a, b) => a.timestamp - b.timestamp);
  const trades: BacktestTrade[] = [];
  let unresolvedSignals = 0;

  for (let i = lookbackSales; i < ordered.length; i += 1) {
    const current = ordered[i];
    if (!current) continue;
    const prior = ordered.slice(Math.max(0, i - lookbackSales), i);
    const baseline = median(prior.map((s) => s.priceEth));
    if (baseline <= 0) continue;

    const discountBps = ((baseline - current.priceEth) / baseline) * 10_000;
    if (discountBps < minDiscountBps) continue;

    const key = tokenKey(current);
    const exit = ordered.slice(i + 1).find((candidate) =>
      tokenKey(candidate) === key &&
      candidate.timestamp > current.timestamp &&
      candidate.timestamp - current.timestamp <= maxHoldMs,
    );
    if (!exit) {
      unresolvedSignals += 1;
      continue;
    }

    const marketplaceFeeEth = exit.priceEth * valuationConfig.marketplaceFeeBps / 10_000;
    const royaltyEth = exit.priceEth * valuationConfig.royaltyBps / 10_000;
    const slippageEth = exit.priceEth * valuationConfig.slippageBps / 10_000;
    const costsEth = marketplaceFeeEth + royaltyEth + slippageEth + gasEth;
    const pnlEth = exit.priceEth - current.priceEth - costsEth;
    const returnBps = current.priceEth > 0 ? pnlEth / current.priceEth * 10_000 : 0;
    trades.push({
      token: key,
      entryAt: current.timestamp,
      exitAt: exit.timestamp,
      entryEth: current.priceEth,
      exitEth: exit.priceEth,
      costsEth,
      pnlEth,
      returnBps,
    });
  }

  let equity = 0;
  let peak = 0;
  let maxDrawdownEth = 0;
  for (const trade of trades) {
    equity += trade.pnlEth;
    peak = Math.max(peak, equity);
    maxDrawdownEth = Math.max(maxDrawdownEth, peak - equity);
  }

  const wins = trades.filter((t) => t.pnlEth > 0).length;
  const losses = trades.length - wins;
  const totalPnlEth = trades.reduce((sum, t) => sum + t.pnlEth, 0);
  return {
    resolvedTrades: trades.length,
    unresolvedSignals,
    wins,
    losses,
    winRate: trades.length ? wins / trades.length : 0,
    totalPnlEth,
    averagePnlEth: trades.length ? totalPnlEth / trades.length : 0,
    averageReturnBps: trades.length ? trades.reduce((sum, t) => sum + t.returnBps, 0) / trades.length : 0,
    maxDrawdownEth,
    trades,
  };
}
