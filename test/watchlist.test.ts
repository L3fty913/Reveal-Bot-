import assert from "node:assert/strict";
import test from "node:test";
import { parseWatchlist } from "../src/watchlist.js";

test("watchlist parser accepts a bounded standalone target", () => {
  const targets = parseWatchlist(JSON.stringify({
    targets: [{
      collectionId: "collection-1",
      contract: "0x1111111111111111111111111111111111111111",
      discoverLimit: 50,
      concurrency: 5,
      cashEth: 2,
      gasEth: 0.004,
    }],
  }));
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.collectionId, "collection-1");
  assert.equal(targets[0]?.discoverLimit, 50);
});

test("watchlist parser rejects invalid risk/scan bounds", () => {
  assert.throws(() => parseWatchlist(JSON.stringify({
    targets: [{
      collectionId: "collection-1",
      contract: "0x1111111111111111111111111111111111111111",
      discoverLimit: 101,
      cashEth: 1,
      gasEth: 0.003,
    }],
  })), /discoverLimit/);
});

test("watchlist parser rejects malformed contracts", () => {
  assert.throws(() => parseWatchlist(JSON.stringify({
    targets: [{ collectionId: "collection-1", contract: "nope", cashEth: 1, gasEth: 0 }],
  })), /EVM address/);
});
