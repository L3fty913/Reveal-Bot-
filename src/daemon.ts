import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { runCollectionScan } from "./engine.js";
import { StateStore } from "./store.js";
import { parseWatchlist } from "./watchlist.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const watchlistPath = process.env.WATCHLIST_PATH ?? "watchlist.json";
  const targets = parseWatchlist(await readFile(watchlistPath, "utf8"));
  const store = new StateStore(config.databasePath);
  let stopping = false;

  const stop = (): void => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    while (!stopping) {
      const cycleStartedAt = Date.now();
      for (const target of targets) {
        if (stopping) break;
        try {
          const result = await runCollectionScan(config, target, store);
          console.log(JSON.stringify({
            event: "scan_complete",
            collectionId: result.collectionId,
            tokensScanned: result.tokensScanned,
            approvedCount: result.approvedCount,
            queuedProposalIds: result.queuedProposalIds,
            durationMs: result.finishedAt - result.startedAt,
          }));
        } catch (error: unknown) {
          console.error(JSON.stringify({
            event: "scan_error",
            collectionId: target.collectionId,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      if (stopping) break;
      const elapsed = Date.now() - cycleStartedAt;
      const delay = Math.max(0, config.pollIntervalMs - elapsed);
      if (delay > 0) await sleep(delay);
    }
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "fatal", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
