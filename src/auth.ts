const JWT_ALG = "HS256";
const JWT_TYP = "JWT";

export type AuthUser = {
  id: number;
  email: string;
};

type TokenPayload = AuthUser & {
  exp: number;
};

function jwtSecret() {
  const secret = Bun.env.JWT_SECRET;
  if (!secret) {
    if (Bun.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return "dev-secret-change-me";
  }
  return secret;
}

function base64UrlEncode(input: string | ArrayBuffer) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);

  return Buffer.from(bytes)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string) {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return new TextDecoder().decode(Buffer.from(base64, "base64"));
}

async function sign(data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

export async function createToken(user: AuthUser) {
  const header = base64UrlEncode(JSON.stringify({ alg: JWT_ALG, typ: JWT_TYP }));
  const payload = base64UrlEncode(
    JSON.stringify({
      ...user,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    } satisfies TokenPayload),
  );
  const body = `${header}.${payload}`;
  const signature = base64UrlEncode(await sign(body));

  return `${body}.${signature}`;
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;

  const expected = base64UrlEncode(await sign(`${header}.${payload}`));
  if (signature !== expected) return null;

  const decodedHeader = JSON.parse(base64UrlDecode(header));
  if (decodedHeader.alg !== JWT_ALG || decodedHeader.typ !== JWT_TYP) return null;

  const decodedPayload = JSON.parse(base64UrlDecode(payload)) as TokenPayload;
  if (decodedPayload.exp < Math.floor(Date.now() / 1000)) return null;

  return {
    id: decodedPayload.id,
    email: decodedPayload.email,
  };
}
