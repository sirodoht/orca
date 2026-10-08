import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";

// Always isolate tests from the database and credentials in .env.
Bun.env.DATABASE_URL = ":memory:";
Bun.env.JWT_SECRET = "regression-tests-only";
Bun.env.POSTMARK_SERVER_TOKEN = "postmark-test-token";
Bun.env.POSTMARK_FROM = "noreply@01z.io";
Bun.env.APP_URL = "https://predictions.example.test";
const { db } = await import("./db");
const { app } = await import("./server");
const { createToken } = await import("./auth");
for (const name of ["001_create_users.sql", "002_prediction_markets.sql", "003_email_verification.sql"]) {
  db.sqlite.exec(await Bun.file(`${import.meta.dir}/../migrations/${name}`).text());
}
const aliceToken = await createToken({ id: 1, email: "alice@example.test" });
const bobToken = await createToken({ id: 2, email: "bob@example.test" });

afterAll(() => db.sqlite.close());
afterEach(() => { spyOnFetch?.mockRestore(); spyOnFetch = undefined; });
let spyOnFetch: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
beforeEach(() => {
  Bun.env.NODE_ENV = "production";
  db.sqlite.exec(`
    DELETE FROM email_verifications; DELETE FROM comments; DELETE FROM trades;
    DELETE FROM positions; DELETE FROM markets; DELETE FROM users;
    INSERT INTO users(id,email,username,password_hash,is_email_verified) VALUES
      (1,'alice@example.test','alice','unused',1),
      (2,'bob@example.test','bob','unused',1);
    INSERT INTO markets(id,creator_id,question,category,close_at,resolution_criteria,source_of_truth,fallback_rule)
      VALUES(1,1,'Will this work?','tech','2099-01-01T00:00:00.000Z','yes','source','fallback');
  `);
});

async function call(path: string, body?: unknown, token = aliceToken) {
  const response = await app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as any };
}

// Pause body consumption to deterministically overlap authenticated requests.
async function hold(path: string, body: unknown) {
  let release!: (text: string) => void;
  let reached!: () => void;
  const ready = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<string>((resolve) => { release = resolve; });
  const request = new Request(`http://localhost${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${aliceToken}`, "Content-Type": "application/json" },
  });
  request.text = () => { reached(); return gate; };
  const pending = app.fetch(request);
  await ready;
  return async () => {
    release(JSON.stringify(body));
    const response = await pending;
    return { status: response.status, data: await response.json() as any };
  };
}

const trade = (action: "buy" | "sell", side: "yes" | "no", amount: number, token = aliceToken) =>
  call("/api/markets/1/trades", { action, side, amount }, token);
const user = () => db<{ balance: number; leaderboard_profit: number; leaderboard_resolved_stake: number; leaderboard_correct_stake: number }>`SELECT * FROM users WHERE id=1`[0]!;
const position = () => db<{ yes_shares: number; no_shares: number; reset_generation: number }>`SELECT * FROM positions WHERE user_id=1 AND market_id=1`[0]!;
function closeMarket(daysAgo = 0) {
  db`UPDATE markets SET close_at = ${new Date(Date.now() - daysAgo * 86_400_000 - 1000).toISOString()} WHERE id=1`;
}

test("overlapping buys cannot overspend or overwrite market inventory", async () => {
  const a = await hold("/api/markets/1/trades", { action: "buy", side: "yes", amount: 8000 });
  const b = await hold("/api/markets/1/trades", { action: "buy", side: "yes", amount: 8000 });
  expect((await a()).status).toBe(200);
  expect((await b()).status).toBe(409);
  expect(user().balance).toBe(2000);
  expect(db`SELECT q_yes FROM markets WHERE id=1`[0]!.q_yes).toBe(position().yes_shares);
});

test("affordable overlapping buys use the price after the previous trade", async () => {
  const a = await hold("/api/markets/1/trades", { action: "buy", side: "yes", amount: 100 });
  const b = await hold("/api/markets/1/trades", { action: "buy", side: "yes", amount: 100 });
  const first = await a();
  const second = await b();
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(second.data.preview.shares).toBeLessThan(first.data.preview.shares);
  expect(db`SELECT q_yes FROM markets WHERE id=1`[0]!.q_yes).toBeCloseTo(position().yes_shares, 8);
});

test("overlapping sales cannot sell the same shares twice", async () => {
  await trade("buy", "yes", 100);
  const body = { action: "sell", side: "yes", amount: position().yes_shares };
  const a = await hold("/api/markets/1/trades", body);
  const b = await hold("/api/markets/1/trades", body);
  expect((await a()).status).toBe(200);
  expect((await b()).status).toBe(409);
  expect(position().yes_shares).toBe(0);
  expect(user().balance).toBeCloseTo(10000, 8);
});

test("a trade delayed past market close is rejected", async () => {
  const release = await hold("/api/markets/1/trades", { action: "buy", side: "yes", amount: 100 });
  closeMarket();
  expect((await release()).status).toBe(409);
  expect(user().balance).toBe(10000);
});

test("overlapping resolutions pay and record statistics only once", async () => {
  await trade("buy", "yes", 100);
  closeMarket();
  const a = await hold("/api/markets/1/resolve", { outcome: "yes" });
  const b = await hold("/api/markets/1/resolve", { outcome: "no" });
  expect((await a()).status).toBe(200);
  const paid = user();
  expect((await b()).status).toBe(409);
  expect(user()).toEqual(paid);
  expect(paid.balance).toBeCloseTo(9900 + position().yes_shares, 8);
  expect(paid.leaderboard_resolved_stake).toBe(100);
});

test("late direct resolution expires and refunds exactly once", async () => {
  await trade("buy", "yes", 100);
  closeMarket(8);
  expect((await call("/api/markets/1/resolve", { outcome: "yes" })).status).toBe(409);
  expect(db`SELECT status FROM markets WHERE id=1`[0]!.status).toBe("expired");
  expect(user().balance).toBe(10000);
  expect(user().leaderboard_resolved_stake).toBe(0);
  await call("/api/markets");
  await call("/api/markets/1/resolve", { outcome: "no" });
  expect(user().balance).toBe(10000);
});

test("expiry during a pending resolution cannot be followed by a payout", async () => {
  await trade("buy", "yes", 100);
  closeMarket();
  const release = await hold("/api/markets/1/resolve", { outcome: "yes" });
  closeMarket(8);
  await call("/api/markets");
  expect((await release()).status).toBe(409);
  expect(user().balance).toBe(10000);
});

for (const side of ["yes", "no"] as const) {
  test(`rebuying ${side} after reset counts toward new leaderboard statistics`, async () => {
    const bought = await trade("buy", side, 100);
    await trade("sell", side, bought.data.preview.shares);
    expect((await call("/api/account/reset", {})).status).toBe(200);
    await trade("buy", side, 100);
    expect(position().reset_generation).toBe(1);
    closeMarket();
    expect((await call("/api/markets/1/resolve", { outcome: side })).status).toBe(200);
    expect(user().leaderboard_resolved_stake).toBeCloseTo(100, 8);
    expect(user().leaderboard_correct_stake).toBeCloseTo(100, 8);
    expect(user().leaderboard_profit).toBeCloseTo(user().balance - 10000, 8);
  });
}

for (const movement of ["yes", "no"] as const) {
  test(`realized ${movement === "yes" ? "profit" : "loss"} is counted through partial sale and settlement`, async () => {
    const bought = await trade("buy", "yes", 100);
    await trade("buy", movement, 1000, bobToken);
    const sold = await trade("sell", "yes", bought.data.preview.shares / 2);
    expect(user().leaderboard_profit).toBeCloseTo(sold.data.preview.credits - 50, 8);
    closeMarket();
    await call("/api/markets/1/resolve", { outcome: "yes" });
    expect(user().leaderboard_profit).toBeCloseTo(user().balance - 10000, 8);
    expect(user().leaderboard_resolved_stake).toBeCloseTo(50, 8);
  });
}

test("a fully sold position retains realized profit after resolution", async () => {
  const bought = await trade("buy", "yes", 100);
  await trade("buy", "yes", 1000, bobToken);
  await trade("sell", "yes", bought.data.preview.shares);
  closeMarket();
  await call("/api/markets/1/resolve", { outcome: "yes" });
  expect(user().leaderboard_profit).toBeGreaterThan(0);
  expect(user().leaderboard_profit).toBeCloseTo(user().balance - 10000, 8);
});

test("development verification is unavailable unless explicitly in development", async () => {
  db`UPDATE users SET is_email_verified=0 WHERE id=1`;
  for (const env of ["production", "test", undefined]) {
    if (env) Bun.env.NODE_ENV = env; else delete Bun.env.NODE_ENV;
    expect((await call("/api/auth/verify-dev", {})).status).toBe(404);
    expect(db`SELECT is_email_verified FROM users WHERE id=1`[0]!.is_email_verified).toBe(false);
  }
  Bun.env.NODE_ENV = "development";
  expect((await call("/api/auth/verify-dev", {})).data.user.isEmailVerified).toBe(true);
});

function mockPostmark(error = false) {
  let verificationToken = "";
  spyOnFetch = spyOn(globalThis, "fetch").mockImplementation((async (input, options) => {
    expect(String(input)).toBe("https://api.postmarkapp.com/email");
    expect(new Headers(options?.headers).get("X-Postmark-Server-Token")).toBe("postmark-test-token");
    const message = JSON.parse(String(options?.body));
    expect(message.From).toBe("noreply@01z.io");
    expect(message.To).toBe("alice@example.test");
    const link = message.TextBody.match(/https:\/\/[^\s]+/)[0];
    verificationToken = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
    return Response.json({ ErrorCode: error ? 300 : 0 }, { status: error ? 422 : 200 });
  }) as typeof fetch);
  return () => verificationToken;
}

test("Postmark verification links are hashed, single-use, and verify only the intended account", async () => {
  db`UPDATE users SET is_email_verified=0`;
  const token = mockPostmark();
  expect((await call("/api/auth/request-verification", {})).status).toBe(200);
  expect(db`SELECT token_hash FROM email_verifications`[0]!.token_hash).not.toBe(token());
  expect((await call("/api/auth/verify-email", { token: "0".repeat(64) }, "")).status).toBe(400);
  expect((await call("/api/auth/verify-email", { token: token() }, "")).status).toBe(200);
  expect((await call("/api/auth/verify-email", { token: token() }, "")).status).toBe(400);
  expect(db`SELECT is_email_verified FROM users WHERE id=1`[0]!.is_email_verified).toBe(true);
  expect(db`SELECT is_email_verified FROM users WHERE id=2`[0]!.is_email_verified).toBe(false);
});

test("verification links expire and resends are rate-limited", async () => {
  db`UPDATE users SET is_email_verified=0 WHERE id=1`;
  const token = mockPostmark();
  await call("/api/auth/request-verification", {});
  expect((await call("/api/auth/request-verification", {})).status).toBe(429);
  expect(spyOnFetch).toHaveBeenCalledTimes(1);
  db`UPDATE email_verifications SET expires_at=0`;
  expect((await call("/api/auth/verify-email", { token: token() }, "")).status).toBe(400);
  expect(db`SELECT is_email_verified FROM users WHERE id=1`[0]!.is_email_verified).toBe(false);
});

test("delivery failures are reported and allow a retry", async () => {
  db`UPDATE users SET is_email_verified=0 WHERE id=1`;
  mockPostmark(true);
  expect((await call("/api/auth/request-verification", {})).status).toBe(503);
  expect(db`SELECT * FROM email_verifications`).toHaveLength(0);
  expect(db`SELECT is_email_verified FROM users WHERE id=1`[0]!.is_email_verified).toBe(false);
});
