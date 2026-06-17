import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { db } from "./db";
import { createToken, verifyToken } from "./auth";

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
};

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: Bun.env.CORS_ORIGIN ?? "http://localhost:5173",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readCredentials(c: Context) {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(body?.password ?? "");

  return { email, password };
}

app.post("/api/auth/signup", async (c) => {
  const { email, password } = await readCredentials(c);

  if (!validEmail(email)) return jsonError("Enter a valid email address");
  if (password.length < 8) {
    return jsonError("Password must be at least 8 characters");
  }

  const existing = db<UserRow>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) return jsonError("Email is already registered", 409);

  const passwordHash = await Bun.password.hash(password);
  db`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
  `;

  const [user] = db<UserRow>`
    SELECT id, email, password_hash FROM users WHERE email = ${email} LIMIT 1
  `;
  if (!user) return jsonError("Could not create user", 500);

  const token = await createToken({ id: user.id, email: user.email });

  return Response.json({ token, user: { id: user.id, email: user.email } }, { status: 201 });
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await readCredentials(c);
  const [user] = db<UserRow>`
    SELECT id, email, password_hash FROM users WHERE email = ${email} LIMIT 1
  `;

  if (!user) return jsonError("Invalid email or password", 401);

  const validPassword = await Bun.password.verify(password, user.password_hash);
  if (!validPassword) return jsonError("Invalid email or password", 401);

  const token = await createToken({ id: user.id, email: user.email });
  return Response.json({ token, user: { id: user.id, email: user.email } });
});

app.get("/api/auth/me", async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const user = token ? await verifyToken(token) : null;

  if (!user) return jsonError("Unauthorized", 401);
  return Response.json({ user });
});

app.get("/assets/*", serveStatic({ root: "./packages/frontend/dist" }));
app.get("*", serveStatic({ path: "./packages/frontend/dist/index.html" }));

const port = Number(Bun.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Server running on http://localhost:${port}`);
