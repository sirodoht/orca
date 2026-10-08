import { db } from "../src/db";
import markets from "./data/markets-2026-10-08.json";

const creator = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!creator || creator.startsWith("--")) {
  throw new Error("Usage: bun scripts/seed-markets.ts <creator-username> [--dry-run]");
}

const [user] = db<{ id: number; is_email_verified: boolean }>`
  SELECT id, is_email_verified FROM users WHERE username = ${creator}
`;
if (!user?.is_email_verified) throw new Error("An existing verified creator is required");
if (markets.length !== 10 || new Set(markets.map((m) => m.question)).size !== 10) {
  throw new Error("Expected exactly ten distinct markets");
}

// A single transaction keeps the batch atomic, including conflict checks.
const result = db.sqlite.transaction(() => {
  return markets.map((market) => {
    const [existing] = db<Record<string, unknown>>`
      SELECT * FROM markets WHERE question = ${market.question}
    `;
    const fields = {
      creator_id: user.id,
      category: market.category,
      close_at: market.closeAt,
      resolution_criteria: market.resolutionCriteria,
      source_of_truth: market.sourceOfTruth,
      fallback_rule: market.fallbackRule,
    };
    if (existing) {
      for (const [key, value] of Object.entries(fields)) {
        if (existing[key] !== value) throw new Error(`Existing market differs: ${market.question} (${key})`);
      }
      return { id: existing.id, question: market.question, action: "unchanged" };
    }
    const closes = Date.parse(market.closeAt);
    if (!Number.isFinite(closes) || closes < Date.now() + 3_600_000 || closes > Date.now() + 365 * 86_400_000) {
      throw new Error(`Close date must be between one hour and one year away: ${market.question}`);
    }
    if (!["politics", "tech", "climate", "community"].includes(market.category) ||
        market.question.length < 8 || !market.resolutionCriteria || !market.sourceOfTruth || !market.fallbackRule) {
      throw new Error(`Invalid market: ${market.question}`);
    }
    if (dryRun) return { question: market.question, action: "would create" };
    const [inserted] = db<{ id: number }>`
      INSERT INTO markets (creator_id, question, category, close_at, resolution_criteria, source_of_truth, fallback_rule)
      VALUES (${user.id}, ${market.question}, ${market.category}, ${market.closeAt},
        ${market.resolutionCriteria}, ${market.sourceOfTruth}, ${market.fallbackRule})
      RETURNING id
    `;
    return { id: inserted!.id, question: market.question, action: "created" };
  });
});

console.log(JSON.stringify({ creator, dryRun, markets: dryRun ? result() : result.immediate() }, null, 2));
db.sqlite.close();
