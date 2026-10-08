import { Database } from "bun:sqlite";

type SqlFragment = {
  __sqlFragment: true;
  sql: string;
  values: unknown[];
};

type Db = {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): T[];
  (values: unknown[]): SqlFragment;
  sqlite: Database;
};

function databasePath() {
  const url = Bun.env.DATABASE_URL ?? "sqlite://orca.db";
  if (url.startsWith("sqlite://")) {
    return url.slice("sqlite://".length);
  }
  return url;
}

const sqlite = new Database(databasePath(), { create: true });
sqlite.exec("PRAGMA foreign_keys = ON;");

function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    "__sqlFragment" in value &&
    (value as SqlFragment).__sqlFragment === true
  );
}

function normalizeValue(value: unknown) {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function normalizeRow(row: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith("is_") || key.startsWith("has_")) {
      normalized[key] = value === 1 ? true : value === 0 ? false : value;
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

export const db = ((stringsOrValues: TemplateStringsArray | unknown[], ...values: any[]) => {
  if (!("raw" in stringsOrValues)) {
    return {
      __sqlFragment: true,
      sql: stringsOrValues.map(() => "?").join(", "),
      values: stringsOrValues.map(normalizeValue),
    };
  }

  let sql = "";
  const params: unknown[] = [];

  for (let i = 0; i < stringsOrValues.length; i++) {
    sql += stringsOrValues[i];
    if (i >= values.length) continue;

    const value = values[i];
    if (isSqlFragment(value)) {
      sql += value.sql;
      params.push(...value.values.map(normalizeValue));
    } else {
      sql += "?";
      params.push(normalizeValue(value));
    }
  }

  return sqlite
    .query(sql)
    .all(...(params as any[]))
    .map((row) => normalizeRow(row as Record<string, unknown>));
}) as Db;

db.sqlite = sqlite;
