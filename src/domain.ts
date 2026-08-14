export type Address = `0x${string}`;

export type Venue = "opensea" | "reservoir" | "blur" | "magiceden" | "unknown";
export type Side = "bid" | "ask";
export type TradingMode = "paper" | "live";

export interface NftId {
  chainId: number;
  contract: Address;
  tokenId: string;
}

export interface Trait {
  key: string;
  value: string;
  rarityRank?: number;
  rarityScore?: number;
}

export interface NftSnapshot extends NftId {
  collectionId: string;
  name?: string;
  traits: Trait[];
  observedAt: number;
}

export interface Order {
  id: string;
  venue: Venue;
  side: Side;
  collectionId: string;
  nft?: NftId;
  trait?: { key: string; value: string };
  priceEth: number;
  maker?: Address;
  validFrom: number;
  validUntil: number;
  observedAt: number;
  executable: boolean;
}

export interface Sale {
  txHash: string;
  venue: Venue;
  nft: NftId;
  collectionId: string;
  traits: Trait[];
  priceEth: number;
  buyer?: Address;
  seller?: Address;
  timestamp: number;
}

export interface CollectionMarket {
  collectionId: string;
  floorAskEth: number;
  topBidEth: number;
  floorDepth5Pct: number;
  floorDepth10Pct: number;
  sales24h: number;
  volume24hEth: number;
  uniqueBuyers24h: number;
  uniqueSellers24h: number;
  observedAt: number;
}

export interface CostEstimate {
  marketplaceFeeEth: number;
  royaltyEth: number;
  gasEth: number;
  slippageEth: number;
  totalEth: number;
}

export interface FairValueEstimate {
  fairValueEth: number;
  conservativeExitEth: number;
  confidence: number;
  comparableSales: number;
  traitPremiumBps: number;
  liquidityHaircutBps: number;
  uncertaintyHaircutBps: number;
  reasons: string[];
}

export type OpportunityType =
  | "bid_to_floor"
  | "trait_mispricing"
  | "cross_market_arbitrage"
  | "inventory_market_make"
  | "liquidity_sweep";

export interface Opportunity {
  id: string;
  type: OpportunityType;
  collectionId: string;
  nft?: NftId;
  entryPriceEth: number;
  modeledExitEth: number;
  costs: CostEstimate;
  expectedProfitEth: number;
  expectedEdgeBps: number;
  confidence: number;
  observedAt: number;
  buyOrder?: Order;
  sellOrder?: Order;
  metadata?: Record<string, string | number | boolean>;
}

export interface Position {
  nft: NftId;
  collectionId: string;
  acquisitionPriceEth: number;
  acquisitionCostsEth: number;
  acquiredAt: number;
  markedValueEth: number;
}

export interface PortfolioState {
  cashEth: number;
  realizedPnlEth: number;
  unrealizedPnlEth: number;
  dailyPnlEth: number;
  positions: Position[];
  openOrders: Order[];
}

export interface RiskDecision {
  approved: boolean;
  reasons: string[];
  maxSpendEth: number;
}

export interface ExecutionResult {
  status: "filled" | "submitted" | "rejected" | "simulated" | "failed";
  opportunityId: string;
  txHash?: string;
  orderId?: string;
  fillPriceEth?: number;
  costsEth?: number;
  reason?: string;
}
