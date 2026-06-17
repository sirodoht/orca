import { db } from "./db";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

async function ensureMigrationsTable() {
  db.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await db`SELECT name FROM migrations ORDER BY id`;
  return new Set(rows.map((r: any) => r.name));
}

function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

async function applyMigration(name: string, sql: string) {
  console.log(`Applying ${name}...`);

  db.sqlite.exec("BEGIN");
  try {
    db.sqlite.exec(sql);
    db.sqlite.exec(
      `INSERT INTO migrations (name) VALUES ('${escapeSqlString(name)}')`,
    );
    db.sqlite.exec("COMMIT");
    console.log(`  ✓ ${name}`);
  } catch (err) {
    try {
      db.sqlite.exec("ROLLBACK");
    } catch {}
    console.error(`  ✗ ${name} failed`);
    throw err;
  }
}

async function runMigrations() {
  await ensureMigrationsTable();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = await getAppliedMigrations();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await Bun.file(join(MIGRATIONS_DIR, file)).text();
    await applyMigration(file, sql);
    ran++;
  }

  if (ran === 0) {
    console.log("No pending migrations");
  } else {
    console.log(`Applied ${ran} migration(s)`);
  }
}

async function status() {
  await ensureMigrationsTable();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = await getAppliedMigrations();

  console.log("\nMigration Status");
  console.log("----------------");
  for (const file of files) {
    const mark = applied.has(file) ? "✓" : "○";
    console.log(`  ${mark} ${file}`);
  }
  console.log("");
}

const command = process.argv[2];

if (command === "status") {
  await status();
  process.exit(0);
} else if (command) {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: bun run migrate [status]");
  process.exit(1);
} else {
  await runMigrations();
  process.exit(0);
}
