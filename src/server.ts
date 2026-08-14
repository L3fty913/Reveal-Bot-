import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { StateStore } from "./store.js";

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function authorized(req: IncomingMessage, token: string): boolean {
  if (!token) return false;
  return req.headers.authorization === `Bearer ${token}`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new StateStore(config.databasePath);

  const server = createServer((req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${config.serverHost}:${config.serverPort}`);

      if (method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, mode: config.tradingMode });
        return;
      }

      if (method === "GET" && url.pathname === "/proposals") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 500);
        sendJson(res, 200, { proposals: store.listPendingProposals(limit) });
        return;
      }

      const match = /^\/proposals\/(\d+)\/(approve|reject)$/.exec(url.pathname);
      if (method === "POST" && match) {
        if (!config.reviewApiToken) {
          sendJson(res, 503, { error: "proposal mutations disabled until REVIEW_API_TOKEN is configured" });
          return;
        }
        if (!authorized(req, config.reviewApiToken)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }

        const id = Number(match[1]);
        const status = match[2] === "approve" ? "approved" : "rejected";
        const changed = store.setProposalStatus(id, status);
        sendJson(res, changed ? 200 : 409, {
          ok: changed,
          id,
          status: changed ? status : "unchanged",
          note: "Review status only; this server never signs or submits a transaction.",
        });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "request failed";
      sendJson(res, 500, { error: message });
    }
  });

  server.listen(config.serverPort, config.serverHost, () => {
    console.log(JSON.stringify({
      service: "reveal-bot-review-api",
      host: config.serverHost,
      port: config.serverPort,
      mutationsEnabled: Boolean(config.reviewApiToken),
    }));
  });

  const shutdown = (): void => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
