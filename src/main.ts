import { loadConfig } from "./config.js";
import type { Address } from "./domain.js";
import { runCollectionScan } from "./engine.js";
import { StateStore } from "./store.js";

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

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  const store = new StateStore(config.databasePath);

  try {
    const result = await runCollectionScan(config, {
      collectionId: args.collection,
      contract: args.contract,
      tokenIds: args.tokens,
      discoverLimit: args.discoverLimit,
      concurrency: args.concurrency,
      cashEth: args.cashEth,
      gasEth: args.gasEth,
    }, store);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
