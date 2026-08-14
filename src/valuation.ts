import type { AppConfig } from "./config.js";
import type { CollectionMarket, FairValueEstimate, NftSnapshot, Sale, Trait } from "./domain.js";

const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

function weightedMedian(points: Array<{ value: number; weight: number }>): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  let running = 0;
  for (const point of sorted) {
    running += point.weight;
    if (running >= total / 2) return point.value;
  }
  return sorted[sorted.length - 1]?.value ?? 0;
}

function traitSet(traits: Trait[]): Set<string> {
  return new Set(traits.map((t) => `${t.key.toLowerCase()}=${t.value.toLowerCase()}`));
}

export function traitSimilarity(a: Trait[], b: Trait[]): number {
  const aa = traitSet(a);
  const bb = traitSet(b);
  if (aa.size === 0 && bb.size === 0) return 1;
  let intersection = 0;
  for (const key of aa) if (bb.has(key)) intersection += 1;
  const union = new Set([...aa, ...bb]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface ValuationInput {
  nft: NftSnapshot;
  market: CollectionMarket;
  sales: Sale[];
  now?: number;
}

export class ValuationEngine {
  constructor(private readonly config: AppConfig["valuation"]) {}

  estimate(input: ValuationInput): FairValueEstimate {
    const now = input.now ?? Date.now();
    const lookbackMs = this.config.saleLookbackHours * 60 * 60 * 1000;
    const eligible = input.sales.filter(
      (sale) =>
        sale.collectionId === input.nft.collectionId &&
        sale.priceEth > 0 &&
        sale.timestamp <= now &&
        now - sale.timestamp <= lookbackMs,
    );

    const weighted = eligible.map((sale) => {
      const ageHours = Math.max(0, now - sale.timestamp) / 3_600_000;
      const recencyWeight = Math.exp(-ageHours / 72);
      const similarity = traitSimilarity(input.nft.traits, sale.traits);
      return {
        value: sale.priceEth,
        weight: recencyWeight * (0.35 + 0.65 * similarity),
        similarity,
      };
    });

    const saleMedian = weightedMedian(weighted.map(({ value, weight }) => ({ value, weight })));
    const similar = weighted.filter((x) => x.similarity >= 0.35);
    const similarMedian = weightedMedian(similar.map(({ value, weight }) => ({ value, weight })));

    const referenceMedian = saleMedian || input.market.floorAskEth || input.market.topBidEth;
    const traitPremiumBps = referenceMedian > 0 && similarMedian > 0
      ? Math.round(clamp(((similarMedian / referenceMedian) - 1) * 10_000, -5_000, 20_000))
      : 0;

    const traitAdjustedSales = saleMedian > 0 ? saleMedian * (1 + traitPremiumBps / 10_000) : 0;
    const anchors = [
      { value: traitAdjustedSales, weight: 0.55 },
      { value: input.market.floorAskEth, weight: 0.25 },
      { value: input.market.topBidEth, weight: 0.20 },
    ].filter((x) => x.value > 0);

    const weightTotal = anchors.reduce((sum, x) => sum + x.weight, 0);
    const fairValueEth = weightTotal > 0
      ? anchors.reduce((sum, x) => sum + x.value * x.weight, 0) / weightTotal
      : 0;

    const comparableScore = clamp(eligible.length / Math.max(this.config.minComparableSales * 3, 1), 0, 1);
    const liquidityScore = clamp(
      0.45 * Math.min(input.market.sales24h / 10, 1) +
      0.30 * Math.min(input.market.floorDepth10Pct / 20, 1) +
      0.25 * Math.min(input.market.uniqueBuyers24h / 10, 1),
      0,
      1,
    );
    const confidence = clamp(0.15 + 0.50 * comparableScore + 0.35 * liquidityScore, 0, 1);

    const dynamicLiquidityHaircut = this.config.liquidityHaircutBps * (1 + (1 - liquidityScore));
    const dynamicUncertaintyHaircut = this.config.uncertaintyHaircutBps * (1 + (1 - confidence));
    const totalHaircutBps = Math.min(4_500, dynamicLiquidityHaircut + dynamicUncertaintyHaircut);
    const conservativeExitEth = fairValueEth * (1 - totalHaircutBps / 10_000);

    const reasons: string[] = [];
    reasons.push(`${eligible.length} comparable sales inside lookback`);
    reasons.push(`trait premium ${traitPremiumBps} bps`);
    reasons.push(`liquidity score ${liquidityScore.toFixed(2)}`);
    reasons.push(`confidence ${confidence.toFixed(2)}`);

    return {
      fairValueEth,
      conservativeExitEth,
      confidence,
      comparableSales: eligible.length,
      traitPremiumBps,
      liquidityHaircutBps: Math.round(dynamicLiquidityHaircut),
      uncertaintyHaircutBps: Math.round(dynamicUncertaintyHaircut),
      reasons,
    };
  }
}
