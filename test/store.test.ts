import assert from "node:assert/strict";
import test from "node:test";
import type { TradeProposal } from "../src/domain.js";
import { StateStore } from "../src/store.js";

const proposal: TradeProposal = {
  opportunityId: "op-1",
  action: "buy",
  venue: "opensea",
  collectionId: "collection-1",
  nft: {
    chainId: 1,
    contract: "0x1111111111111111111111111111111111111111",
    tokenId: "1",
  },
  limitPriceEth: 0.25,
  expectedProfitEth: 0.05,
  expectedEdgeBps: 2000,
  expiresAt: 2_000_000_000_000,
  rationale: ["test"],
};

test("proposal queue deduplicates and supports review state", () => {
  const store = new StateStore(":memory:");
  try {
    const now = 1_900_000_000_000;
    const id1 = store.enqueueProposal(proposal, now);
    const id2 = store.enqueueProposal(proposal, now + 1);
    assert.equal(id1, id2);

    const pending = store.listPendingProposals(10, now + 2);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.proposal.opportunityId, proposal.opportunityId);

    assert.equal(store.setProposalStatus(id1, "approved"), true);
    assert.equal(store.setProposalStatus(id1, "rejected"), false);
  } finally {
    store.close();
  }
});

test("proposal queue expires stale proposals", () => {
  const store = new StateStore(":memory:");
  try {
    const short = { ...proposal, opportunityId: "op-expire", expiresAt: 1000 };
    store.enqueueProposal(short, 500);
    assert.equal(store.expireOldProposals(1001), 1);
    assert.equal(store.listPendingProposals(10, 1001).length, 0);
  } finally {
    store.close();
  }
});
