import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "h3director_session";
export const SESSION_SECONDS = 60 * 60 * 12;

export function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isConfigured(): boolean {
  return Boolean(process.env.FAL_KEY && (process.env.DIRECTOR_ACCESS_CODE?.length ?? 0) >= 16);
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expiry = String(Math.floor(now / 1000) + SESSION_SECONDS);
  const signature = createHmac("sha256", secret).update(`h3director:${expiry}`).digest("base64url");
  return `${expiry}.${signature}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token || secret.length < 16) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
  const expiry = Number(parts[0]);
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= current || expiry > current + SESSION_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`h3director:${parts[0]}`).digest("base64url");
  return secureEqual(parts[1], expected);
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const supplied = new URL(origin);
    if (process.env.APP_ORIGIN) return supplied.origin === new URL(process.env.APP_ORIGIN).origin;
    const requestUrl = new URL(request.url);
    // Next's Node server may use localhost in request.url even when the browser uses 127.0.0.1.
    // Host is the actual incoming authority; do not accept arbitrary forwarded-host overrides.
    const authority = request.headers.get("host") || requestUrl.host;
    const protocol = process.env.VERCEL === "1" ? "https:" : requestUrl.protocol;
    return supplied.host === authority && supplied.protocol === protocol;
  } catch { return false; }
}
