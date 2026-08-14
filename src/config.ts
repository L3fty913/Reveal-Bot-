import type { TradingMode } from "./domain.js";

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
};

const str = (name: string, fallback = ""): string => process.env[name] ?? fallback;

export interface AppConfig {
  tradingMode: TradingMode;
  chain: string;
  pollIntervalMs: number;
  databasePath: string;
  serverPort: number;
  reservoirApiKey: string;
  reservoirApiBase: string;
  openSeaApiKey: string;
  rpcUrl: string;
  risk: {
    minExpectedEdgeBps: number;
    maxSingleTradeEth: number;
    maxCollectionExposureEth: number;
    maxTotalInventoryEth: number;
    maxDailyLossEth: number;
    maxGasEth: number;
    maxDataAgeMs: number;
    maxOpenBidsPerCollection: number;
    minConfidence: number;
  };
  valuation: {
    minComparableSales: number;
    saleLookbackHours: number;
    liquidityHaircutBps: number;
    uncertaintyHaircutBps: number;
    marketplaceFeeBps: number;
    royaltyBps: number;
    slippageBps: number;
  };
}

export function loadConfig(): AppConfig {
  const modeRaw = str("TRADING_MODE", "paper");
  const tradingMode: TradingMode = modeRaw === "proposal" ? "proposal" : "paper";

  const cfg: AppConfig = {
    tradingMode,
    chain: str("CHAIN", "ethereum"),
    pollIntervalMs: num("POLL_INTERVAL_MS", 5000),
    databasePath: str("DATABASE_PATH", "reveal-bot.db"),
    serverPort: num("SERVER_PORT", 8787),
    reservoirApiKey: str("RESERVOIR_API_KEY"),
    reservoirApiBase: str("RESERVOIR_API_BASE", "https://api.reservoir.tools"),
    openSeaApiKey: str("OPENSEA_API_KEY"),
    rpcUrl: str("RPC_URL"),
    risk: {
      minExpectedEdgeBps: num("MIN_EXPECTED_EDGE_BPS", 800),
      maxSingleTradeEth: num("MAX_SINGLE_TRADE_ETH", 0.5),
      maxCollectionExposureEth: num("MAX_COLLECTION_EXPOSURE_ETH", 2),
      maxTotalInventoryEth: num("MAX_TOTAL_INVENTORY_ETH", 5),
      maxDailyLossEth: num("MAX_DAILY_LOSS_ETH", 0.25),
      maxGasEth: num("MAX_GAS_ETH", 0.015),
      maxDataAgeMs: num("MAX_DATA_AGE_MS", 15000),
      maxOpenBidsPerCollection: num("MAX_OPEN_BIDS_PER_COLLECTION", 8),
      minConfidence: num("MIN_CONFIDENCE", 0.6),
    },
    valuation: {
      minComparableSales: num("MIN_COMPARABLE_SALES", 3),
      saleLookbackHours: num("SALE_LOOKBACK_HOURS", 168),
      liquidityHaircutBps: num("LIQUIDITY_HAIRCUT_BPS", 500),
      uncertaintyHaircutBps: num("UNCERTAINTY_HAIRCUT_BPS", 750),
      marketplaceFeeBps: num("MARKETPLACE_FEE_BPS", 250),
      royaltyBps: num("ROYALTY_BPS", 500),
      slippageBps: num("SLIPPAGE_BPS", 100),
    },
  };

  if (cfg.serverPort < 1 || cfg.serverPort > 65_535) throw new Error("SERVER_PORT must be between 1 and 65535");
  if (cfg.risk.minExpectedEdgeBps < 0) throw new Error("MIN_EXPECTED_EDGE_BPS cannot be negative");
  if (cfg.risk.maxSingleTradeEth <= 0) throw new Error("MAX_SINGLE_TRADE_ETH must be positive");
  if (cfg.risk.minConfidence < 0 || cfg.risk.minConfidence > 1) throw new Error("MIN_CONFIDENCE must be between 0 and 1");
  return cfg;
}
