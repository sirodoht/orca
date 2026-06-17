export type AuthUser = {
  id: number;
  email: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

const TOKEN_KEY = "vidya_predictions_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
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

export function signup(email: string, password: string) {
  return request<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function me(token: string) {
  return request<{ user: AuthUser }>("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
