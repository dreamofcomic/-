import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, isSameOrigin, secureEqual, SESSION_SECONDS, verifySessionToken } from "../src/lib/auth";

const secret = "test-only-access-code-not-a-real-secret";
const now = 1790000000000;

test("signed session accepts its own secret and rejects tampering, extra fields and a different secret", () => {
  const token = createSessionToken(secret, now);
  assert.equal(verifySessionToken(token, secret, now), true);
  assert.equal(verifySessionToken(`${token}x`, secret, now), false);
  assert.equal(verifySessionToken(`${token}.extra`, secret, now), false);
  assert.equal(verifySessionToken(token.replace(/^\d/, "9"), secret, now), false);
  assert.equal(verifySessionToken(token, "another-test-secret-1234", now), false);
  assert.equal(verifySessionToken(undefined, secret, now), false);
  assert.equal(verifySessionToken("not-a-token", secret, now), false);
});

test("session expires at 12 hours and rejects future-dated credentials and short signing secrets", () => {
  const token = createSessionToken(secret, now);
  assert.equal(verifySessionToken(token, secret, now + SESSION_SECONDS * 1000 - 1), true);
  assert.equal(verifySessionToken(token, secret, now + SESSION_SECONDS * 1000), false);
  assert.equal(verifySessionToken(token, secret, now - 1000), false);
  assert.equal(verifySessionToken(createSessionToken("short", now), "short", now), false);
});

test("origin guard rejects cross-site and missing-origin writes", () => {
  const previous = process.env.APP_ORIGIN;
  delete process.env.APP_ORIGIN;
  try {
    assert.equal(isSameOrigin(new Request("https://desk.example/api/session", { headers: { origin: "https://desk.example" } })), true);
    assert.equal(isSameOrigin(new Request("https://desk.example/api/session", { headers: { origin: "https://evil.example" } })), false);
    assert.equal(isSameOrigin(new Request("https://desk.example/api/session")), false);
    assert.equal(isSameOrigin(new Request("https://desk.example/api/session", { headers: { origin: "null" } })), false);
    assert.equal(isSameOrigin(new Request("http://localhost:3001/api/session", { headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" } })), true);
    assert.equal(isSameOrigin(new Request("https://desk.example/api/session", { headers: { host: "desk.example", "x-forwarded-host": "evil.example", origin: "https://evil.example" } })), false);
    process.env.APP_ORIGIN = "https://production.example";
    assert.equal(isSameOrigin(new Request("https://internal.example/api/session", { headers: { origin: "https://production.example" } })), true);
    assert.equal(isSameOrigin(new Request("https://internal.example/api/session", { headers: { origin: "https://internal.example" } })), false);
  } finally { if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous; }
});

test("secret comparison handles UTF-8 and unequal lengths", () => {
  assert.equal(secureEqual("中文-hello", "中文-hello"), true);
  assert.equal(secureEqual("中文-hello", "中文-world"), false);
  assert.equal(secureEqual("a", "aa"), false);
});
