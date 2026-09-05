import assert from "node:assert/strict";
import test from "node:test";
import { forwardWmaRequest } from "../src/lib/wma-proxy";

const endpoint = "minimax/h3-max/director";
function request(target: string, body: unknown = { app_id: endpoint }, signal?: AbortSignal) {
  return new Request("https://desk.example/api/fal/proxy", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "x-fal-target-url": target, Authorization: "attacker-value", Cookie: "private-cookie" },
    body: JSON.stringify(body)
  });
}

test("relay rejects other hosts, protocols, paths, URL credentials and query parameters before fetch", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const target of ["https://example.com/session", "https://wma.fal.run.evil.example/session", "http://wma.fal.run/ice", "https://user:secret@wma.fal.run/session", "https://wma.fal.run/other", "https://wma.fal.run/session?app_id=other", "https://wma.fal.run/session#fragment", "https://fal.run/minimax/h3-max/director"]) {
    assert.equal((await forwardWmaRequest(request(target), "test-key", fakeFetch)).status, 400, target);
  }
  assert.equal(calls, 0);
});

test("relay requires the exact model and a valid offer before allocating a session", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const payload of [{ app_id: "some-other-model", sdp: "offer", type: "offer" }, { app_id: endpoint }, { app_id: endpoint, sdp: "", type: "offer" }, { app_id: endpoint, sdp: "offer", type: "answer" }]) {
    assert.equal((await forwardWmaRequest(request("https://wma.fal.run/session", payload), "test-key", fakeFetch)).status, 400);
  }
  assert.equal(calls, 0);
});

test("relay forwards only server-owned auth, supported body and browser cancellation", async () => {
  const controller = new AbortController();
  let captured: RequestInit | undefined;
  const payload = { app_id: endpoint, sdp: "v=0\r\n", type: "offer" };
  const fakeFetch: typeof fetch = async (target, init) => {
    assert.equal(target, "https://wma.fal.run/session");
    captured = init;
    return Response.json({ session_id: "test-session", sdp: "answer", type: "answer" });
  };
  const response = await forwardWmaRequest(request("https://wma.fal.run/session", payload, controller.signal), "server-test-key", fakeFetch);
  assert.equal(response.status, 200);
  const headers = new Headers(captured?.headers);
  assert.equal(headers.get("authorization"), "Key server-test-key");
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("x-fal-target-url"), false);
  assert.equal(captured?.redirect, "error");
  assert.deepEqual(JSON.parse(String(captured?.body)), payload);
  assert.equal(captured?.signal?.aborted, false);
  controller.abort();
  assert.equal(captured?.signal?.aborted, true);
});

test("ICE and heartbeats use the same bounded relay", async () => {
  const fakeFetch: typeof fetch = async () => Response.json({ alive: true });
  assert.equal((await forwardWmaRequest(request("https://wma.fal.run/ice"), "test-key", fakeFetch)).status, 200);
  assert.equal((await forwardWmaRequest(request("https://wma.fal.run/session/heartbeat", { session_id: "test-session" }), "test-key", fakeFetch)).status, 200);
  assert.equal((await forwardWmaRequest(request("https://wma.fal.run/session/heartbeat", {}), "test-key", fakeFetch)).status, 400);
});

test("relay sanitizes upstream errors rather than reflecting credentials or diagnostics", async () => {
  const fakeFetch: typeof fetch = async () => Response.json({ secret: "server-test-key" }, { status: 401 });
  const response = await forwardWmaRequest(request("https://wma.fal.run/ice"), "server-test-key", fakeFetch);
  assert.equal(response.status, 401);
  assert.equal((await response.text()).includes("server-test-key"), false);
});

test("relay refuses oversized requests and missing keys", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => { calls++; return Response.json({}); };
  assert.equal((await forwardWmaRequest(request("https://wma.fal.run/ice"), "", fakeFetch)).status, 503);
  assert.equal((await forwardWmaRequest(request("https://wma.fal.run/ice", { app_id: endpoint, data: "x".repeat(131073) }), "test-key", fakeFetch)).status, 413);
  assert.equal(calls, 0);
});
