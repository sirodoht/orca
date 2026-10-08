import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { db } from "./db";
import { createToken, verifyToken, type AuthUser } from "./auth";
import { sendVerificationEmail, verificationUrl } from "./email";

const STARTING_BALANCE = 10_000;
const LIQUIDITY = 1_000;
const CATEGORIES = ["politics", "tech", "climate", "community"] as const;

type Category = (typeof CATEGORIES)[number];
type Side = "yes" | "no";
type TradeAction = "buy" | "sell";

type UserRow = {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  is_email_verified: boolean;
  balance: number;
  reset_generation: number;
  leaderboard_profit: number;
  leaderboard_correct_stake: number;
  leaderboard_resolved_stake: number;
  created_at: string;
};

type MarketRow = {
  id: number;
  creator_id: number;
  creator_username: string;
  question: string;
  category: Category;
  close_at: string;
  resolution_criteria: string;
  source_of_truth: string;
  fallback_rule: string;
  status: "open" | "resolved_yes" | "resolved_no" | "expired";
  q_yes: number;
  q_no: number;
  resolved_at: string | null;
  expired_at: string | null;
  created_at: string;
  trade_count: number;
  active_trade_count: number;
  comment_count: number;
  creator_markets_created: number;
  creator_markets_resolved: number;
  creator_markets_expired: number;
};

type PositionRow = {
  user_id: number;
  market_id: number;
  yes_shares: number;
  no_shares: number;
  yes_cost: number;
  no_cost: number;
  reset_generation: number;
};

export const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: Bun.env.CORS_ORIGIN ?? "http://localhost:5173",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validUsername(username: string) {
  return /^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,23}$/.test(username);
}

function isCategory(category: string): category is Category {
  return CATEGORIES.includes(category as Category);
}

function nowIso() {
  return new Date().toISOString();
}

function sqliteNowMinus(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function toPublicUser(user: UserRow | AuthUser) {
  return {
    id: user.id,
    email: "email" in user ? user.email : undefined,
    username: "username" in user ? user.username : undefined,
    isEmailVerified:
      "is_email_verified" in user ? user.is_email_verified : undefined,
    balance: "balance" in user ? Number(user.balance.toFixed(2)) : undefined,
  };
}

function price(qYes: number, qNo: number): number {
  const yes = Math.exp(qYes / LIQUIDITY);
  const no = Math.exp(qNo / LIQUIDITY);
  return yes / (yes + no);
}

function lmsrCost(qYes: number, qNo: number): number {
  const a = qYes / LIQUIDITY;
  const b = qNo / LIQUIDITY;
  const max = Math.max(a, b);
  return LIQUIDITY * (max + Math.log(Math.exp(a - max) + Math.exp(b - max)));
}

function sharesForSpend(qYes: number, qNo: number, side: Side, spend: number) {
  let low = 0;
  let high = Math.max(1, spend * 4);
  const before = lmsrCost(qYes, qNo);

  const costFor = (shares: number) => {
    const nextYes = side === "yes" ? qYes + shares : qYes;
    const nextNo = side === "no" ? qNo + shares : qNo;
    return lmsrCost(nextYes, nextNo) - before;
  };

  while (costFor(high) < spend) high *= 2;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (costFor(mid) < spend) low = mid;
    else high = mid;
  }

  return (low + high) / 2;
}

function previewTrade(
  market: Pick<MarketRow, "q_yes" | "q_no">,
  action: TradeAction,
  side: Side,
  amount: number,
) {
  const oldPrice = price(market.q_yes, market.q_no);
  let shares = amount;
  let credits = amount;
  let nextYes = market.q_yes;
  let nextNo = market.q_no;

  if (action === "buy") {
    shares = sharesForSpend(market.q_yes, market.q_no, side, amount);
    nextYes = side === "yes" ? market.q_yes + shares : market.q_yes;
    nextNo = side === "no" ? market.q_no + shares : market.q_no;
  } else {
    nextYes = side === "yes" ? market.q_yes - shares : market.q_yes;
    nextNo = side === "no" ? market.q_no - shares : market.q_no;
    credits = lmsrCost(market.q_yes, market.q_no) - lmsrCost(nextYes, nextNo);
  }

  const newYesPrice = price(nextYes, nextNo);
  const relevantPrice = side === "yes" ? newYesPrice : 1 - newYesPrice;
  const oldRelevantPrice = side === "yes" ? oldPrice : 1 - oldPrice;

  return {
    action,
    side,
    shares,
    credits,
    averagePrice: credits / shares,
    yesPrice: newYesPrice,
    noPrice: 1 - newYesPrice,
    priceAfter: relevantPrice,
    priceImpact: Math.abs(relevantPrice - oldRelevantPrice),
    nextYes,
    nextNo,
  };
}

async function authUser(c: Context) {
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  const [user] = db<UserRow>`
    SELECT * FROM users WHERE id = ${payload.id} LIMIT 1
  `;
  return user ?? null;
}

async function requireAuth(c: Context) {
  const user = await authUser(c);
  if (!user) return { response: jsonError("Unauthorized", 401), user: null };
  return { response: null, user };
}

async function requireVerified(c: Context) {
  const auth = await requireAuth(c);
  if (auth.response) return auth;
  if (!auth.user?.is_email_verified) {
    return {
      response: jsonError("Verify your email before using this feature", 403),
      user: auth.user,
    };
  }
  return auth;
}

function marketSelect(extraWhere = "", orderBy = "m.created_at DESC") {
  return `
    SELECT
      m.*,
      u.username AS creator_username,
      (SELECT COUNT(*) FROM trades t WHERE t.market_id = m.id) AS trade_count,
      (
        SELECT COUNT(*) FROM trades t
        WHERE t.market_id = m.id
          AND datetime(t.created_at) >= datetime('now', '-24 hours')
      ) AS active_trade_count,
      (SELECT COUNT(*) FROM comments c WHERE c.market_id = m.id) AS comment_count,
      (SELECT COUNT(*) FROM markets cm WHERE cm.creator_id = m.creator_id) AS creator_markets_created,
      (
        SELECT COUNT(*) FROM markets cm
        WHERE cm.creator_id = m.creator_id
          AND cm.status IN ('resolved_yes', 'resolved_no')
      ) AS creator_markets_resolved,
      (
        SELECT COUNT(*) FROM markets cm
        WHERE cm.creator_id = m.creator_id
          AND cm.status = 'expired'
      ) AS creator_markets_expired
    FROM markets m
    JOIN users u ON u.id = m.creator_id
    ${extraWhere}
    ORDER BY ${orderBy}
  `;
}

function formatMarket(market: MarketRow) {
  const yesPrice = price(market.q_yes, market.q_no);
  return {
    ...market,
    yesPrice,
    noPrice: 1 - yesPrice,
    yesPercent: Math.round(yesPrice * 100),
    noPercent: Math.round((1 - yesPrice) * 100),
  };
}

function expireEligibleMarkets() {
  return db.sqlite.transaction(() => {
    const cutoff = sqliteNowMinus(7);
    const markets = db<MarketRow>`
      SELECT
        m.*,
        u.username AS creator_username,
        0 AS trade_count,
        0 AS active_trade_count,
        0 AS comment_count,
        0 AS creator_markets_created,
        0 AS creator_markets_resolved,
        0 AS creator_markets_expired
      FROM markets m
      JOIN users u ON u.id = m.creator_id
      WHERE m.status = 'open' AND m.close_at <= ${cutoff}
    `;

    for (const market of markets) {
      const positions = db<PositionRow>`
        SELECT * FROM positions
        WHERE market_id = ${market.id}
          AND (yes_cost > 0 OR no_cost > 0)
      `;
      for (const position of positions) {
        const refund = position.yes_cost + position.no_cost;
        if (refund > 0) {
          db`
            UPDATE users
            SET balance = balance + ${refund}
            WHERE id = ${position.user_id}
          `;
        }
      }
      db`
        UPDATE markets
        SET status = 'expired', expired_at = ${nowIso()}
        WHERE id = ${market.id}
      `;
    }
  }).immediate();
}

function parseMarketId(c: Context) {
  const id = Number(c.req.param("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getMarket(id: number) {
  const [market] = db<MarketRow>`
    SELECT
      m.*,
      u.username AS creator_username,
      (SELECT COUNT(*) FROM trades t WHERE t.market_id = m.id) AS trade_count,
      (
        SELECT COUNT(*) FROM trades t
        WHERE t.market_id = m.id
          AND datetime(t.created_at) >= datetime('now', '-24 hours')
      ) AS active_trade_count,
      (SELECT COUNT(*) FROM comments c WHERE c.market_id = m.id) AS comment_count,
      (SELECT COUNT(*) FROM markets cm WHERE cm.creator_id = m.creator_id) AS creator_markets_created,
      (
        SELECT COUNT(*) FROM markets cm
        WHERE cm.creator_id = m.creator_id
          AND cm.status IN ('resolved_yes', 'resolved_no')
      ) AS creator_markets_resolved,
      (
        SELECT COUNT(*) FROM markets cm
        WHERE cm.creator_id = m.creator_id
          AND cm.status = 'expired'
      ) AS creator_markets_expired
    FROM markets m
    JOIN users u ON u.id = m.creator_id
    WHERE m.id = ${id}
    LIMIT 1
  `;
  return market;
}

async function readCredentials(c: Context) {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email ?? "")
    .trim()
    .toLowerCase();
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");

  return { email, username, password };
}

app.post("/api/auth/signup", async (c) => {
  const { email, username, password } = await readCredentials(c);

  if (!validEmail(email)) return jsonError("Enter a valid email address");
  if (!validUsername(username)) {
    return jsonError("Username must be 3-24 letters, numbers, dashes, or underscores");
  }
  if (password.length < 8) {
    return jsonError("Password must be at least 8 characters");
  }

  const existing = db<UserRow>`
    SELECT id FROM users WHERE email = ${email} OR lower(username) = ${username.toLowerCase()} LIMIT 1
  `;
  if (existing.length > 0) return jsonError("Email or username is already registered", 409);

  const passwordHash = await Bun.password.hash(password);
  db`
    INSERT INTO users (email, username, password_hash, balance)
    VALUES (${email}, ${username}, ${passwordHash}, ${STARTING_BALANCE})
  `;

  const [user] = db<UserRow>`
    SELECT * FROM users WHERE email = ${email} LIMIT 1
  `;
  if (!user) return jsonError("Could not create user", 500);

  const token = await createToken({ id: user.id, email: user.email });

  return Response.json({ token, user: toPublicUser(user) }, { status: 201 });
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await readCredentials(c);
  const [user] = db<UserRow>`
    SELECT * FROM users WHERE email = ${email} LIMIT 1
  `;

  if (!user) return jsonError("Invalid email or password", 401);

  const validPassword = await Bun.password.verify(password, user.password_hash);
  if (!validPassword) return jsonError("Invalid email or password", 401);

  const token = await createToken({ id: user.id, email: user.email });
  return Response.json({ token, user: toPublicUser(user) });
});

app.get("/api/auth/me", async (c) => {
  const auth = await requireAuth(c);
  if (auth.response) return auth.response;
  return Response.json({ user: toPublicUser(auth.user!) });
});

app.post("/api/auth/verify-dev", async (c) => {
  if (Bun.env.NODE_ENV !== "development") return jsonError("Not found", 404);
  const auth = await requireAuth(c);
  if (auth.response) return auth.response;

  db`
    UPDATE users SET is_email_verified = 1 WHERE id = ${auth.user!.id}
  `;
  const [user] = db<UserRow>`SELECT * FROM users WHERE id = ${auth.user!.id}`;
  if (!user) return jsonError("User not found", 404);
  return Response.json({ user: toPublicUser(user) });
});

app.post("/api/auth/request-verification", async (c) => {
  const auth = await requireAuth(c);
  if (auth.response) return auth.response;
  if (auth.user!.is_email_verified) return Response.json({ ok: true });

  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
  let url: string;
  try {
    url = verificationUrl(token);
  } catch {
    return jsonError("Email verification is not configured", 503);
  }
  const reserved = db.sqlite.transaction(() => {
    const now = Date.now();
    const [previous] = db<{ requested_at: number }>`
      SELECT requested_at FROM email_verifications WHERE user_id = ${auth.user!.id}
    `;
    if (previous && now - previous.requested_at < 60_000) return false;
    db`
      INSERT INTO email_verifications (user_id, token_hash, expires_at, requested_at)
      VALUES (${auth.user!.id}, ${hash}, ${now + 3_600_000}, ${now})
      ON CONFLICT(user_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        requested_at = excluded.requested_at
    `;
    return true;
  }).immediate();
  if (!reserved) return jsonError("Please wait a minute before requesting another email", 429);

  try {
    await sendVerificationEmail(auth.user!.email, url);
  } catch {
    // Do not remove a newer token if another request replaced this one.
    db`DELETE FROM email_verifications WHERE token_hash = ${hash}`;
    return jsonError("Could not send the verification email. Please try again.", 503);
  }
  return Response.json({ ok: true });
});

app.post("/api/auth/verify-email", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = String(body?.token ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) return jsonError("Invalid or expired verification link");
  const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
  return db.sqlite.transaction(() => {
    const [verification] = db<{ user_id: number }>`
      DELETE FROM email_verifications
      WHERE token_hash = ${hash} AND expires_at > ${Date.now()}
      RETURNING user_id
    `;
    if (!verification) return jsonError("Invalid or expired verification link");
    db`UPDATE users SET is_email_verified = 1 WHERE id = ${verification.user_id}`;
    return Response.json({ ok: true });
  }).immediate();
});

app.get("/api/markets", (c) => {
  expireEligibleMarkets();
  const sort = c.req.query("sort") ?? "active";
  const category = c.req.query("category");
  const params: string[] = [];
  let where = "";

  if (category) {
    if (!isCategory(category)) return jsonError("Unknown category");
    where = "WHERE m.category = ?";
    params.push(category);
  }

  const orderBy =
    sort === "newest"
      ? "m.created_at DESC"
      : sort === "closing"
        ? "m.close_at ASC"
        : "active_trade_count DESC, m.created_at DESC";

  const rows = db.sqlite
    .query(marketSelect(where, orderBy))
    .all(...params) as Record<string, unknown>[];
  return Response.json({ markets: rows.map((row) => formatMarket(row as MarketRow)) });
});

app.post("/api/markets", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;

  const body = await c.req.json().catch(() => null);
  const question = String(body?.question ?? "").trim();
  const category = String(body?.category ?? "").trim();
  const closeAt = new Date(String(body?.closeAt ?? ""));
  const resolutionCriteria = String(body?.resolutionCriteria ?? "").trim();
  const sourceOfTruth = String(body?.sourceOfTruth ?? "").trim();
  const fallbackRule = String(body?.fallbackRule ?? "").trim();

  if (question.length < 8) return jsonError("Question is too short");
  if (!isCategory(category)) return jsonError("Choose a valid category");
  if (Number.isNaN(closeAt.getTime())) return jsonError("Choose a valid close date");
  if (!resolutionCriteria) return jsonError("Resolution criteria are required");
  if (!sourceOfTruth) return jsonError("Source of truth is required");
  if (!fallbackRule) return jsonError("Fallback rule is required");

  const minClose = Date.now() + 60 * 60 * 1000;
  const maxClose = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (closeAt.getTime() < minClose || closeAt.getTime() > maxClose) {
    return jsonError("Close date must be between 1 hour and 1 year from now");
  }

  const [created] = db<{ id: number }>`
    INSERT INTO markets (
      creator_id, question, category, close_at, resolution_criteria,
      source_of_truth, fallback_rule
    )
    VALUES (
      ${auth.user!.id}, ${question}, ${category}, ${closeAt.toISOString()},
      ${resolutionCriteria}, ${sourceOfTruth}, ${fallbackRule}
    )
    RETURNING id
  `;
  if (!created) return jsonError("Could not create market", 500);

  return Response.json({ market: formatMarket(getMarket(created.id)!) }, { status: 201 });
});

app.get("/api/markets/:id", (c) => {
  expireEligibleMarkets();
  const id = parseMarketId(c);
  if (!id) return jsonError("Invalid market id");
  const market = getMarket(id);
  if (!market) return jsonError("Market not found", 404);

  const trades = db`
    SELECT t.*, u.username
    FROM trades t
    JOIN users u ON u.id = t.user_id
    WHERE t.market_id = ${id}
    ORDER BY t.created_at DESC
    LIMIT 20
  `;
  const comments = db`
    SELECT c.*, u.username
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.market_id = ${id}
    ORDER BY c.created_at ASC
  `;

  return Response.json({ market: formatMarket(market), trades, comments });
});

app.put("/api/markets/:id", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;
  const id = parseMarketId(c);
  if (!id) return jsonError("Invalid market id");
  const market = getMarket(id);
  if (!market) return jsonError("Market not found", 404);
  if (market.creator_id !== auth.user!.id) return jsonError("Only the creator can edit this market", 403);
  if (market.trade_count > 0) return jsonError("Markets cannot be edited after the first trade", 409);

  const body = await c.req.json().catch(() => null);
  const question = String(body?.question ?? market.question).trim();
  const category = String(body?.category ?? market.category).trim();
  const closeAt = new Date(String(body?.closeAt ?? market.close_at));
  const resolutionCriteria = String(body?.resolutionCriteria ?? market.resolution_criteria).trim();
  const sourceOfTruth = String(body?.sourceOfTruth ?? market.source_of_truth).trim();
  const fallbackRule = String(body?.fallbackRule ?? market.fallback_rule).trim();

  if (question.length < 8) return jsonError("Question is too short");
  if (!isCategory(category)) return jsonError("Choose a valid category");
  if (Number.isNaN(closeAt.getTime())) return jsonError("Choose a valid close date");
  const minClose = Date.now() + 60 * 60 * 1000;
  const maxClose = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (closeAt.getTime() < minClose || closeAt.getTime() > maxClose) {
    return jsonError("Close date must be between 1 hour and 1 year from now");
  }

  db`
    UPDATE markets
    SET question = ${question},
        category = ${category},
        close_at = ${closeAt.toISOString()},
        resolution_criteria = ${resolutionCriteria},
        source_of_truth = ${sourceOfTruth},
        fallback_rule = ${fallbackRule}
    WHERE id = ${id}
  `;

  return Response.json({ market: formatMarket(getMarket(id)!) });
});

app.delete("/api/markets/:id", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;
  const id = parseMarketId(c);
  if (!id) return jsonError("Invalid market id");
  const market = getMarket(id);
  if (!market) return jsonError("Market not found", 404);
  if (market.creator_id !== auth.user!.id) return jsonError("Only the creator can delete this market", 403);
  if (market.trade_count > 0) return jsonError("Markets cannot be deleted after the first trade", 409);

  db`DELETE FROM markets WHERE id = ${id}`;
  return Response.json({ ok: true });
});

app.post("/api/markets/:id/preview", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;
  const id = parseMarketId(c);
  if (!id) return jsonError("Invalid market id");
  const market = getMarket(id);
  if (!market) return jsonError("Market not found", 404);

  const body = await c.req.json().catch(() => null);
  const action = String(body?.action ?? "buy") as TradeAction;
  const side = String(body?.side ?? "yes") as Side;
  const amount = Number(body?.amount);
  if (!["buy", "sell"].includes(action)) return jsonError("Choose buy or sell");
  if (!["yes", "no"].includes(side)) return jsonError("Choose Yes or No");
  if (!Number.isFinite(amount) || amount <= 0) return jsonError("Enter a positive amount");

  return Response.json({ preview: previewTrade(market, action, side, amount) });
});

app.post("/api/markets/:id/trades", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;
  const id = parseMarketId(c);
  if (!id) return jsonError("Invalid market id");
  const body = await c.req.json().catch(() => null);
  const action = String(body?.action ?? "buy") as TradeAction;
  const side = String(body?.side ?? "yes") as Side;
  const amount = Number(body?.amount);
  if (!["buy", "sell"].includes(action)) return jsonError("Choose buy or sell");
  if (!["yes", "no"].includes(side)) return jsonError("Choose Yes or No");
  if (!Number.isFinite(amount) || amount <= 0) return jsonError("Enter a positive amount");

  // No awaits inside this transaction: validate and price against current state.
  return db.sqlite.transaction(() => {
    const [user] = db<UserRow>`SELECT * FROM users WHERE id = ${auth.user!.id}`;
    if (!user) return jsonError("Unauthorized", 401);
    const market = getMarket(id);
    if (!market) return jsonError("Market not found", 404);
    if (market.status !== "open") return jsonError("This market is not open for trading", 409);
    if (new Date(market.close_at).getTime() <= Date.now()) {
      return jsonError("Trading has closed for this market", 409);
    }

    const [position] = db<PositionRow>`
      SELECT * FROM positions WHERE user_id = ${user.id} AND market_id = ${id} LIMIT 1
    `;
    const currentPosition =
      position ??
      ({
        user_id: user.id,
        market_id: id,
        yes_shares: 0,
        no_shares: 0,
        yes_cost: 0,
        no_cost: 0,
        reset_generation: user.reset_generation,
      } satisfies PositionRow);

    if (action === "buy" && user.balance < amount) {
      return jsonError("Insufficient balance", 409);
    }
    if (action === "sell") {
      const owned = side === "yes" ? currentPosition.yes_shares : currentPosition.no_shares;
      if (owned + 0.000001 < amount) return jsonError("You cannot sell more shares than you own", 409);
    }

    const preview = previewTrade(market, action, side, amount);

    if (!position) {
      db`
        INSERT INTO positions (user_id, market_id, reset_generation)
        VALUES (${user.id}, ${id}, ${user.reset_generation})
      `;
    }

    if (action === "buy") {
      db`
        UPDATE users SET balance = balance - ${preview.credits}
        WHERE id = ${user.id}
      `;
      if (side === "yes") {
        db`
          UPDATE positions
          SET yes_shares = yes_shares + ${preview.shares},
              yes_cost = yes_cost + ${preview.credits},
              reset_generation = ${user.reset_generation}
          WHERE user_id = ${user.id} AND market_id = ${id}
        `;
      } else {
        db`
          UPDATE positions
          SET no_shares = no_shares + ${preview.shares},
              no_cost = no_cost + ${preview.credits},
              reset_generation = ${user.reset_generation}
          WHERE user_id = ${user.id} AND market_id = ${id}
        `;
      }
    } else {
      const owned = side === "yes" ? currentPosition.yes_shares : currentPosition.no_shares;
      const cost = side === "yes" ? currentPosition.yes_cost : currentPosition.no_cost;
      const costReduction = owned > 0 ? cost * (amount / owned) : 0;
      db`
        UPDATE users
        SET balance = balance + ${preview.credits},
            leaderboard_profit = leaderboard_profit + ${preview.credits - costReduction}
        WHERE id = ${user.id}
      `;
      if (side === "yes") {
        db`
          UPDATE positions
          SET yes_shares = yes_shares - ${amount},
              yes_cost = max(0, yes_cost - ${costReduction})
          WHERE user_id = ${user.id} AND market_id = ${id}
        `;
      } else {
        db`
          UPDATE positions
          SET no_shares = no_shares - ${amount},
              no_cost = max(0, no_cost - ${costReduction})
          WHERE user_id = ${user.id} AND market_id = ${id}
        `;
      }
    }

    db`
      UPDATE markets
      SET q_yes = ${preview.nextYes}, q_no = ${preview.nextNo}
      WHERE id = ${id}
    `;
    db`
      INSERT INTO trades (
        user_id, market_id, action, side, shares, credits, average_price,
        price_after, price_impact, reset_generation
      )
      VALUES (
        ${user.id}, ${id}, ${action}, ${side}, ${preview.shares},
        ${preview.credits}, ${preview.averagePrice}, ${preview.priceAfter},
        ${preview.priceImpact}, ${user.reset_generation}
      )
    `;

    return Response.json({ market: formatMarket(getMarket(id)!), preview });
  }).immediate();
});

app.post("/api/markets/:id/comments", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;
  const id = parseMarketId(c);
  if (!id) return jsonError("Invalid market id");
  if (!getMarket(id)) return jsonError("Market not found", 404);

  const body = await c.req.json().catch(() => null);
  const comment = String(body?.body ?? "").trim();
  if (comment.length < 1 || comment.length > 2_000) {
    return jsonError("Comment must be between 1 and 2000 characters");
  }

  db`
    INSERT INTO comments (user_id, market_id, body)
    VALUES (${auth.user!.id}, ${id}, ${comment})
  `;
  return Response.json({ ok: true }, { status: 201 });
});

app.post("/api/markets/:id/resolve", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;
  const id = parseMarketId(c);
  if (!id) return jsonError("Invalid market id");
  const body = await c.req.json().catch(() => null);
  const outcome = String(body?.outcome ?? "").toLowerCase();
  if (!["yes", "no"].includes(outcome)) return jsonError("Outcome must be Yes or No");

  return db.sqlite.transaction(() => {
    expireEligibleMarkets();
    const market = getMarket(id);
    if (!market) return jsonError("Market not found", 404);
    if (market.creator_id !== auth.user!.id) return jsonError("Only the creator can resolve this market", 403);
    if (market.status !== "open") return jsonError("This market has already been finalized", 409);
    if (new Date(market.close_at).getTime() > Date.now()) return jsonError("This market has not closed yet", 409);

    const positions = db<PositionRow>`SELECT * FROM positions WHERE market_id = ${id}`;
    for (const position of positions) {
      const winningShares = outcome === "yes" ? position.yes_shares : position.no_shares;
      const winningCost = outcome === "yes" ? position.yes_cost : position.no_cost;
      const totalStake = position.yes_cost + position.no_cost;
      const profit = winningShares - totalStake;
      if (winningShares > 0) {
        db`
          UPDATE users SET balance = balance + ${winningShares}
          WHERE id = ${position.user_id}
        `;
      }
      db`
        UPDATE users
        SET leaderboard_profit = leaderboard_profit + ${profit},
            leaderboard_resolved_stake = leaderboard_resolved_stake + ${totalStake},
            leaderboard_correct_stake = leaderboard_correct_stake + ${winningCost}
        WHERE id = ${position.user_id}
          AND reset_generation = ${position.reset_generation}
      `;
    }

    db`
      UPDATE markets
      SET status = ${outcome === "yes" ? "resolved_yes" : "resolved_no"},
          resolved_at = ${nowIso()}
      WHERE id = ${id}
    `;

    return Response.json({ market: formatMarket(getMarket(id)!) });
  }).immediate();
});

app.post("/api/account/reset", async (c) => {
  const auth = await requireVerified(c);
  if (auth.response) return auth.response;
  return db.sqlite.transaction(() => {
    expireEligibleMarkets();
    const openPositions = db`
      SELECT p.id
      FROM positions p
      JOIN markets m ON m.id = p.market_id
      WHERE p.user_id = ${auth.user!.id}
        AND m.status = 'open'
        AND (p.yes_shares > 0.000001 OR p.no_shares > 0.000001)
      LIMIT 1
    `;
    if (openPositions.length > 0) {
      return jsonError("You can reset only after closing all open positions", 409);
    }

    db`
      UPDATE users
      SET balance = ${STARTING_BALANCE},
          reset_generation = reset_generation + 1,
          leaderboard_profit = 0,
          leaderboard_correct_stake = 0,
          leaderboard_resolved_stake = 0
      WHERE id = ${auth.user!.id}
    `;
    const [user] = db<UserRow>`SELECT * FROM users WHERE id = ${auth.user!.id}`;
    if (!user) return jsonError("User not found", 404);
    return Response.json({ user: toPublicUser(user) });
  }).immediate();
});

app.get("/api/leaderboards", (c) => {
  const tab = c.req.query("tab") ?? "balance";
  const orderBy =
    tab === "profit"
      ? "leaderboard_profit DESC"
      : tab === "accuracy"
        ? "(CASE WHEN leaderboard_resolved_stake > 0 THEN leaderboard_correct_stake / leaderboard_resolved_stake ELSE 0 END) DESC"
        : "balance DESC";

  const rows = db.sqlite
    .query(`
      SELECT
        username,
        balance,
        leaderboard_profit AS profit,
        leaderboard_correct_stake AS correct_stake,
        leaderboard_resolved_stake AS resolved_stake,
        CASE
          WHEN leaderboard_resolved_stake > 0
          THEN leaderboard_correct_stake / leaderboard_resolved_stake
          ELSE 0
        END AS accuracy
      FROM users
      ORDER BY ${orderBy}, username ASC
      LIMIT 50
    `)
    .all();

  return Response.json({ leaders: rows });
});

app.get("/api/users/:username", (c) => {
  const username = c.req.param("username");
  const [user] = db<UserRow>`
    SELECT * FROM users WHERE lower(username) = ${username.toLowerCase()} LIMIT 1
  `;
  if (!user) return jsonError("User not found", 404);

  const markets = db`
    SELECT id, question, category, status, close_at, created_at
    FROM markets
    WHERE creator_id = ${user.id}
    ORDER BY created_at DESC
  `;
  const trades = db`
    SELECT t.*, m.question
    FROM trades t
    JOIN markets m ON m.id = t.market_id
    WHERE t.user_id = ${user.id}
    ORDER BY t.created_at DESC
    LIMIT 50
  `;
  const positions = db`
    SELECT p.*, m.question, m.status
    FROM positions p
    JOIN markets m ON m.id = p.market_id
    WHERE p.user_id = ${user.id}
      AND (p.yes_shares > 0.000001 OR p.no_shares > 0.000001)
    ORDER BY p.updated_at DESC
  `;
  const [stats] = db`
    SELECT
      COUNT(*) AS markets_created,
      SUM(CASE WHEN status IN ('resolved_yes', 'resolved_no') THEN 1 ELSE 0 END) AS markets_resolved,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS markets_expired
    FROM markets
    WHERE creator_id = ${user.id}
  `;

  return Response.json({
    profile: {
      username: user.username,
      createdAt: user.created_at,
      balance: user.balance,
      profit: user.leaderboard_profit,
      accuracy:
        user.leaderboard_resolved_stake > 0
          ? user.leaderboard_correct_stake / user.leaderboard_resolved_stake
          : 0,
      creatorStats: stats,
    },
    markets,
    trades,
    positions,
  });
});

app.get("/assets/*", serveStatic({ root: "./packages/frontend/dist" }));
app.get("*", serveStatic({ path: "./packages/frontend/dist/index.html" }));

export function startServer() {
  const port = Number(Bun.env.PORT ?? 3000);
  const server = Bun.serve({ port, fetch: app.fetch });
  console.log(`Server running on http://localhost:${server.port}`);
  return server;
}

if (import.meta.main) startServer();
