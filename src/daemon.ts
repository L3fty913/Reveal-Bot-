import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { runCollectionScan } from "./engine.js";
import { ReservoirRealtimeWatcher } from "./realtime.js";
import { StateStore } from "./store.js";
import { parseWatchlist } from "./watchlist.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const watchlistPath = process.env.WATCHLIST_PATH ?? "watchlist.json";
  const targets = parseWatchlist(await readFile(watchlistPath, "utf8"));
  const store = new StateStore(config.databasePath);
  let stopping = false;
  let wakeRequested = false;
  let delayController: AbortController | null = null;
  let lastRealtimeWake = 0;

  const contracts = [...new Set(targets.map((target) => target.contract.toLowerCase()))];
  const realtime = config.realtimeEnabled
    ? new ReservoirRealtimeWatcher({
        apiKey: config.reservoirApiKey,
        contracts,
        onMarketEvent: (marketEvent) => {
          const now = Date.now();
          if (now - lastRealtimeWake < config.realtimeDebounceMs) return;
          lastRealtimeWake = now;
          wakeRequested = true;
          delayController?.abort();
          console.log(JSON.stringify({
            event: "realtime_market_change",
            marketEvent: marketEvent.event,
            contract: marketEvent.contract,
          }));
        },
        onStatus: (status, detail) => {
          console.log(JSON.stringify({ event: "realtime_status", status, detail }));
        },
      })
    : null;

  const stop = (): void => {
    stopping = true;
    delayController?.abort();
    realtime?.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  realtime?.start();

  try {
    while (!stopping) {
      wakeRequested = false;
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

      if (stopping || wakeRequested) continue;
      const elapsed = Date.now() - cycleStartedAt;
      const delay = Math.max(0, config.pollIntervalMs - elapsed);
      if (delay <= 0) continue;

      delayController = new AbortController();
      try {
        await sleep(delay, undefined, { signal: delayController.signal });
      } catch (error: unknown) {
        if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      } finally {
        delayController = null;
      }
    }
  } finally {
    realtime?.stop();
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "fatal", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
