export function verificationUrl(token: string) {
  const origin = Bun.env.APP_URL ??
    (Bun.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
  const url = new URL("/verify-email", origin);
  if (Bun.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS in production");
  }
  // Fragments stay out of HTTP requests, access logs, and Referer headers.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export async function sendVerificationEmail(email: string, url: string) {
  const token = Bun.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error("Postmark is not configured");
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: Bun.env.POSTMARK_FROM ?? "noreply@01z.io",
      To: email,
      Subject: "Verify your Orca email",
      TextBody: `Verify your email address by opening this link:\n\n${url}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
      MessageStream: "outbound",
      TrackOpens: false,
      TrackLinks: "None",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null) as { ErrorCode?: number } | null;
  if (!response.ok || result?.ErrorCode !== 0) {
    throw new Error("Postmark could not send the verification email");
  }
}
