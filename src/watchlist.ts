import type { Address } from "./domain.js";
import type { ScanTarget } from "./engine.js";

interface RawTarget {
  collectionId?: unknown;
  contract?: unknown;
  tokenIds?: unknown;
  discoverLimit?: unknown;
  concurrency?: unknown;
  cashEth?: unknown;
  gasEth?: unknown;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

export function parseWatchlist(text: string): ScanTarget[] {
  const parsed = JSON.parse(text) as { targets?: unknown };
  if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) {
    throw new Error("watchlist.targets must be a non-empty array");
  }

  return parsed.targets.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`targets[${index}] must be an object`);
    const target = raw as RawTarget;
    const collectionId = target.collectionId;
    const contract = target.contract;
    if (typeof collectionId !== "string" || collectionId.trim() === "") throw new Error(`targets[${index}].collectionId is required`);
    if (typeof contract !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(contract)) throw new Error(`targets[${index}].contract must be an EVM address`);

    const cashEth = finiteNumber(target.cashEth ?? 1, `targets[${index}].cashEth`);
    const gasEth = finiteNumber(target.gasEth ?? 0.003, `targets[${index}].gasEth`);
    const discoverLimit = finiteNumber(target.discoverLimit ?? 25, `targets[${index}].discoverLimit`);
    const concurrency = finiteNumber(target.concurrency ?? 4, `targets[${index}].concurrency`);

    if (cashEth <= 0) throw new Error(`targets[${index}].cashEth must be positive`);
    if (gasEth < 0) throw new Error(`targets[${index}].gasEth cannot be negative`);
    if (!Number.isInteger(discoverLimit) || discoverLimit < 1 || discoverLimit > 100) throw new Error(`targets[${index}].discoverLimit must be 1-100`);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error(`targets[${index}].concurrency must be 1-10`);

    let tokenIds: string[] | undefined;
    if (target.tokenIds !== undefined) {
      if (!Array.isArray(target.tokenIds) || target.tokenIds.some((x) => typeof x !== "string" || x.trim() === "")) {
        throw new Error(`targets[${index}].tokenIds must be an array of non-empty strings`);
      }
      tokenIds = target.tokenIds as string[];
    }

    return {
      collectionId,
      contract: contract as Address,
      tokenIds,
      discoverLimit,
      concurrency,
      cashEth,
      gasEth,
    };
  });
}
