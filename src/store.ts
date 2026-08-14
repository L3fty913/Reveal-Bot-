import { DatabaseSync } from "node:sqlite";
import type { Opportunity, TradeProposal } from "./domain.js";

export interface StoredProposal {
  id: number;
  createdAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
  proposal: TradeProposal;
}

export class StateStore {
  private readonly db: DatabaseSync;

  constructor(path = "reveal-bot.db") {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS scan_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        collection_id TEXT NOT NULL,
        tokens_scanned INTEGER NOT NULL,
        opportunities INTEGER NOT NULL,
        approved INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        observed_at INTEGER NOT NULL,
        collection_id TEXT NOT NULL,
        opportunity_type TEXT NOT NULL,
        expected_profit_eth REAL NOT NULL,
        expected_edge_bps REAL NOT NULL,
        confidence REAL NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired')),
        payload_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_proposals_status_created
        ON proposals(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_opportunities_collection_observed
        ON opportunities(collection_id, observed_at DESC);
    `);
  }

  recordScanRun(input: {
    startedAt: number;
    collectionId: string;
    tokensScanned: number;
    opportunities: number;
    approved: number;
  }): void {
    this.db.prepare(`
      INSERT INTO scan_runs(started_at, collection_id, tokens_scanned, opportunities, approved)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.startedAt, input.collectionId, input.tokensScanned, input.opportunities, input.approved);
  }

  upsertOpportunity(opportunity: Opportunity): void {
    this.db.prepare(`
      INSERT INTO opportunities(
        id, observed_at, collection_id, opportunity_type,
        expected_profit_eth, expected_edge_bps, confidence, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        observed_at=excluded.observed_at,
        expected_profit_eth=excluded.expected_profit_eth,
        expected_edge_bps=excluded.expected_edge_bps,
        confidence=excluded.confidence,
        payload_json=excluded.payload_json
    `).run(
      opportunity.id,
      opportunity.observedAt,
      opportunity.collectionId,
      opportunity.type,
      opportunity.expectedProfitEth,
      opportunity.expectedEdgeBps,
      opportunity.confidence,
      JSON.stringify(opportunity),
    );
  }

  enqueueProposal(proposal: TradeProposal, now = Date.now()): number {
    const existing = this.db.prepare(`
      SELECT id FROM proposals
      WHERE opportunity_id = ? AND status = 'pending' AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(proposal.opportunityId, now) as { id?: number } | undefined;
    if (existing?.id !== undefined) return existing.id;

    const result = this.db.prepare(`
      INSERT INTO proposals(opportunity_id, created_at, expires_at, status, payload_json)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(proposal.opportunityId, now, proposal.expiresAt, JSON.stringify(proposal));
    return Number(result.lastInsertRowid);
  }

  expireOldProposals(now = Date.now()): number {
    const result = this.db.prepare(`
      UPDATE proposals SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= ?
    `).run(now);
    return Number(result.changes);
  }

  setProposalStatus(id: number, status: "approved" | "rejected"): boolean {
    const result = this.db.prepare(`
      UPDATE proposals SET status = ?
      WHERE id = ? AND status = 'pending' AND expires_at > ?
    `).run(status, id, Date.now());
    return Number(result.changes) === 1;
  }

  listPendingProposals(limit = 50, now = Date.now()): StoredProposal[] {
    this.expireOldProposals(now);
    const rows = this.db.prepare(`
      SELECT id, created_at, status, payload_json
      FROM proposals
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.min(Math.max(limit, 1), 500)) as Array<{
      id: number;
      created_at: number;
      status: StoredProposal["status"];
      payload_json: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      proposal: JSON.parse(row.payload_json) as TradeProposal,
    }));
  }

  close(): void {
    this.db.close();
  }
}
