export type AuthUser = {
  id: number;
  email: string;
  username: string;
  isEmailVerified: boolean;
  balance: number;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type Market = {
  id: number;
  creator_id: number;
  creator_username: string;
  question: string;
  category: "politics" | "tech" | "climate" | "community";
  close_at: string;
  resolution_criteria: string;
  source_of_truth: string;
  fallback_rule: string;
  status: "open" | "resolved_yes" | "resolved_no" | "expired";
  yesPrice: number;
  noPrice: number;
  yesPercent: number;
  noPercent: number;
  trade_count: number;
  active_trade_count: number;
  comment_count: number;
  creator_markets_created: number;
  creator_markets_resolved: number;
  creator_markets_expired: number;
};

export type Trade = {
  id: number;
  username: string;
  action: "buy" | "sell";
  side: "yes" | "no";
  shares: number;
  credits: number;
  average_price: number;
  price_after: number;
  created_at: string;
};

export type Comment = {
  id: number;
  username: string;
  body: string;
  created_at: string;
};

export type Preview = {
  action: "buy" | "sell";
  side: "yes" | "no";
  shares: number;
  credits: number;
  averagePrice: number;
  yesPrice: number;
  noPrice: number;
  priceAfter: number;
  priceImpact: number;
};

const TOKEN_KEY = "orca_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  for (const [key, value] of Object.entries(authHeaders())) {
    headers.set(key, value);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : "Request failed";
    throw new Error(errorMessage);
  }

  return data as T;
}

export function signup(email: string, username: string, password: string) {
  return request<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
}

export function login(email: string, password: string) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function me() {
  return request<{ user: AuthUser }>("/api/auth/me");
}

export function verifyDev() {
  return request<{ user: AuthUser }>("/api/auth/verify-dev", { method: "POST" });
}

export function requestVerification() {
  return request<{ ok: true }>("/api/auth/request-verification", { method: "POST" });
}

export function confirmEmail(token: string) {
  return request<{ ok: true }>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function listMarkets(sort = "active", category = "") {
  const params = new URLSearchParams({ sort });
  if (category) params.set("category", category);
  return request<{ markets: Market[] }>(`/api/markets?${params}`);
}

export function createMarket(payload: Record<string, unknown>) {
  return request<{ market: Market }>("/api/markets", {
    method: "POST",
    body: JSON.stringify(marketPayload(payload)),
  });
}

export function updateMarket(id: number, payload: Record<string, unknown>) {
  return request<{ market: Market }>(`/api/markets/${id}`, {
    method: "PUT",
    body: JSON.stringify(marketPayload(payload)),
  });
}

function marketPayload(payload: Record<string, unknown>) {
  return {
    ...payload,
    // datetime-local has no offset. Interpret it in the browser's timezone.
    closeAt:
      typeof payload.closeAt === "string"
        ? new Date(payload.closeAt).toISOString()
        : payload.closeAt,
  };
}

export function deleteMarket(id: number) {
  return request<{ ok: true }>(`/api/markets/${id}`, {
    method: "DELETE",
  });
}

export function getMarket(id: number) {
  return request<{ market: Market; trades: Trade[]; comments: Comment[] }>(
    `/api/markets/${id}`,
  );
}

export function tradeMarket(
  id: number,
  payload: { action: "buy" | "sell"; side: "yes" | "no"; amount: number },
) {
  return request<{ market: Market; preview: Preview }>(`/api/markets/${id}/trades`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function previewTrade(
  id: number,
  payload: { action: "buy" | "sell"; side: "yes" | "no"; amount: number },
) {
  return request<{ preview: Preview }>(`/api/markets/${id}/preview`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function commentOnMarket(id: number, body: string) {
  return request<{ ok: true }>(`/api/markets/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function resolveMarket(id: number, outcome: "yes" | "no") {
  return request<{ market: Market }>(`/api/markets/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}

export function resetBalance() {
  return request<{ user: AuthUser }>("/api/account/reset", { method: "POST" });
}

export function leaderboard(tab = "balance") {
  return request<{ leaders: any[] }>(`/api/leaderboards?tab=${tab}`);
}

export function profile(username: string) {
  return request<any>(`/api/users/${encodeURIComponent(username)}`);
}
