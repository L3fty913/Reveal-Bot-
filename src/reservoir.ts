import type { AppConfig } from "./config.js";
import type { Address, CollectionMarket, NftSnapshot, Order, Sale, Trait, Venue } from "./domain.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (v: Json | undefined): v is { [key: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);
const asObject = (v: Json | undefined): { [key: string]: Json } => isObject(v) ? v : {};
const asArray = (v: Json | undefined): Json[] => Array.isArray(v) ? v : [];
const asString = (v: Json | undefined): string | undefined => typeof v === "string" ? v : undefined;
const asNumber = (v: Json | undefined): number | undefined => typeof v === "number" && Number.isFinite(v) ? v : undefined;

function path(root: Json, keys: string[]): Json | undefined {
  let cur: Json | undefined = root;
  for (const key of keys) {
    const obj = asObject(cur);
    cur = obj[key];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function firstNumber(root: Json, paths: string[][]): number | undefined {
  for (const keys of paths) {
    const v = path(root, keys);
    const direct = asNumber(v);
    if (direct !== undefined) return direct;
    const str = asString(v);
    if (str !== undefined) {
      const n = Number(str);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function firstString(root: Json, paths: string[][]): string | undefined {
  for (const keys of paths) {
    const v = asString(path(root, keys));
    if (v !== undefined) return v;
  }
  return undefined;
}

function sourceToVenue(source?: string): Venue {
  const s = source?.toLowerCase() ?? "";
  if (s.includes("opensea")) return "opensea";
  if (s.includes("blur")) return "blur";
  if (s.includes("magiceden")) return "magiceden";
  if (s.includes("reservoir")) return "reservoir";
  return "unknown";
}

function tokenKey(contract: string, tokenId: string): string {
  return `${contract}:${tokenId}`;
}

function parseTraits(raw: Json | undefined): Trait[] {
  return asArray(raw).flatMap((entry) => {
    const obj = asObject(entry);
    const key = asString(obj.key) ?? asString(obj.trait_type);
    const valueRaw = obj.value;
    const value = asString(valueRaw) ?? (typeof valueRaw === "number" ? String(valueRaw) : undefined);
    if (!key || value === undefined) return [];
    return [{ key, value }];
  });
}

export class ReservoirClient {
  constructor(private readonly config: Pick<AppConfig, "reservoirApiBase" | "reservoirApiKey">) {}

  private async get(endpoint: string, params: URLSearchParams): Promise<Json> {
    const url = `${this.config.reservoirApiBase}${endpoint}?${params.toString()}`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.config.reservoirApiKey) headers["x-api-key"] = this.config.reservoirApiKey;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Reservoir ${endpoint} failed: ${response.status} ${response.statusText}`);
    return await response.json() as Json;
  }

  async getToken(collectionId: string, contract: Address, tokenId: string, chainId = 1): Promise<NftSnapshot> {
    const params = new URLSearchParams();
    params.append("tokens", tokenKey(contract, tokenId));
    params.set("includeLastSale", "true");
    const payload = await this.get("/tokens/v6", params);
    const row = asObject(asArray(path(payload, ["tokens"]))[0]);
    const token = asObject(row.token);
    return {
      chainId,
      contract,
      tokenId,
      collectionId,
      name: asString(token.name),
      traits: parseTraits(token.attributes),
      observedAt: Date.now(),
    };
  }

  async getOrders(collectionId: string, contract: Address, tokenId: string): Promise<{ asks: Order[]; bids: Order[] }> {
    const token = tokenKey(contract, tokenId);
    const common = new URLSearchParams({ token, limit: "100", normalizeRoyalties: "true" });
    const [askPayload, bidPayload] = await Promise.all([
      this.get("/orders/asks/v5", common),
      this.get("/orders/bids/v6", common),
    ]);
    return {
      asks: this.parseOrders(askPayload, "ask", collectionId, contract, tokenId),
      bids: this.parseOrders(bidPayload, "bid", collectionId, contract, tokenId),
    };
  }

  private parseOrders(payload: Json, side: "ask" | "bid", collectionId: string, contract: Address, tokenId: string): Order[] {
    const rows = asArray(path(payload, ["orders"]));
    const now = Date.now();
    return rows.flatMap((row) => {
      const id = firstString(row, [["id"]]);
      const priceEth = firstNumber(row, [
        ["price", "gross", "amount", "decimal"],
        ["price", "amount", "decimal"],
        ["price", "net", "amount", "decimal"],
      ]);
      if (!id || priceEth === undefined || priceEth <= 0) return [];
      const source = firstString(row, [["source", "domain"], ["source", "name"]]);
      const validFrom = (firstNumber(row, [["validFrom"]]) ?? Math.floor(now / 1000)) * 1000;
      const validUntilSec = firstNumber(row, [["validUntil"]]) ?? Math.floor((now + 3_600_000) / 1000);
      const status = firstString(row, [["status"]]) ?? "active";
      const quantityRemaining = firstNumber(row, [["quantityRemaining"]]) ?? 1;
      return [{
        id,
        venue: sourceToVenue(source),
        side,
        collectionId,
        nft: { chainId: 1, contract, tokenId },
        priceEth,
        maker: firstString(row, [["maker"]]) as Address | undefined,
        validFrom,
        validUntil: validUntilSec * 1000,
        observedAt: now,
        executable: status === "active" && quantityRemaining > 0 && validUntilSec * 1000 > now,
      }];
    });
  }

  async getSales(collectionId: string, contract: Address, lookbackHours: number, limit = 250): Promise<Sale[]> {
    const startTimestamp = Math.floor((Date.now() - lookbackHours * 3_600_000) / 1000);
    const params = new URLSearchParams({
      collection: collectionId,
      includeTokenMetadata: "true",
      startTimestamp: String(startTimestamp),
      sortBy: "time",
      sortDirection: "desc",
      limit: String(Math.min(limit, 1000)),
    });
    const payload = await this.get("/sales/v6", params);
    return asArray(path(payload, ["sales"])).flatMap((row) => {
      const contractRaw = firstString(row, [["token", "contract"]]) ?? contract;
      const tokenId = firstString(row, [["token", "tokenId"]]);
      const priceEth = firstNumber(row, [["price", "amount", "decimal"], ["price", "gross", "amount", "decimal"]]);
      const timestampSec = firstNumber(row, [["timestamp"]]);
      const txHash = firstString(row, [["txHash"]]) ?? firstString(row, [["id"]]);
      if (!tokenId || !priceEth || !timestampSec || !txHash) return [];
      const token = path(row, ["token"]);
      const source = firstString(row, [["orderSource"], ["fillSource"]]);
      return [{
        txHash,
        venue: sourceToVenue(source),
        nft: { chainId: 1, contract: contractRaw as Address, tokenId },
        collectionId,
        traits: parseTraits(path(token ?? {}, ["attributes"])),
        priceEth,
        buyer: firstString(row, [["to"]]) as Address | undefined,
        seller: firstString(row, [["from"]]) as Address | undefined,
        timestamp: timestampSec * 1000,
      }];
    });
  }

  async getCollectionMarket(collectionId: string): Promise<CollectionMarket> {
    const params = new URLSearchParams({ id: collectionId, includeSalesCount: "true", limit: "1" });
    const payload = await this.get("/collections/v7", params);
    const row = asArray(path(payload, ["collections"]))[0] ?? {};
    const floorAskEth = firstNumber(row, [["floorAsk", "price", "amount", "decimal"], ["floorAsk", "price", "decimal"]]) ?? 0;
    const topBidEth = firstNumber(row, [["topBid", "price", "amount", "decimal"], ["topBid", "price", "decimal"]]) ?? 0;
    return {
      collectionId,
      floorAskEth,
      topBidEth,
      floorDepth5Pct: firstNumber(row, [["floorSale", "count"]]) ?? 0,
      floorDepth10Pct: firstNumber(row, [["tokenCount"]]) ?? 0,
      sales24h: firstNumber(row, [["salesCount", "1day"]]) ?? firstNumber(row, [["salesCount", "1Day"]]) ?? 0,
      volume24hEth: firstNumber(row, [["volume", "1day"]]) ?? firstNumber(row, [["volume", "1Day"]]) ?? 0,
      uniqueBuyers24h: firstNumber(row, [["ownerCount"]]) ?? 0,
      uniqueSellers24h: 0,
      observedAt: Date.now(),
    };
  }
}
