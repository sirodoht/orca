import { Database } from "bun:sqlite";

const source = (Bun.env.DATABASE_URL ?? "sqlite://orca.db").replace(/^sqlite:\/\//, "");
const destination = process.argv[2];
if (!destination) throw new Error("Usage: bun deploy/backup.ts <destination>");

if (await Bun.file(source).exists()) {
  const database = new Database(source, { readonly: true });
  try {
    database.query("VACUUM INTO ?").run(destination);
  } finally {
    database.close();
  }
  const backup = new Database(destination, { readonly: true });
  try {
    const result = backup.query("PRAGMA integrity_check").get() as { integrity_check: string };
    if (result.integrity_check !== "ok") throw new Error("Backup integrity check failed");
  } finally {
    backup.close();
  }
  console.log(`Verified database backup: ${destination}`);
} else {
  console.log("Fresh installation: no existing database to back up");
}
