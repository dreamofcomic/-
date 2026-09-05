import assert from "node:assert/strict";
import test from "node:test";
import { applyDirectionEvent, openingMessage, parseServerMessage, timecode, validateImageUrl, validatePrompt, type Direction } from "../src/lib/director-protocol";

test("opening config fixes 16:9, includes an optional first frame, and uses supported controls", () => {
  assert.deepEqual(openingMessage(" 雨夜书店 ", "768p"), {
    type: "configure", protocol_version: 1, prompt_version: 1, prompt: "雨夜书店", aspect_ratio: "16:9", resolution: "768p", memory: 12
  });
  assert.equal(openingMessage("A scene", "480p", "https://example.com/frame.png").image_url, "https://example.com/frame.png");
});

test("empty and oversized prompts fail before starting a session", () => {
  assert.throws(() => validatePrompt(" \n "));
  assert.throws(() => validatePrompt("a".repeat(50001)));
  assert.equal(validatePrompt("a".repeat(50000)).length, 50000);
});

test("image input rejects unsafe schemes, inline credentials and malformed URLs", () => {
  for (const url of ["javascript:alert(1)", "file:///tmp/image.png", "http://example.com/image.png", "data:image/png;base64,abc", "https://user:pass@example.com/a.png", "not-a-url"]) assert.throws(() => validateImageUrl(url));
  assert.equal(validateImageUrl(" https://example.com/first-frame.png "), "https://example.com/first-frame.png");
});

test("only a matching server acknowledgement marks a direction applied", () => {
  const directions: Direction[] = [{ version: 1, text: "scene", status: "applied" }, { version: 2, text: "close up", status: "pending" }];
  assert.equal(applyDirectionEvent(directions, { type: "prompt_pending", prompt_version: 2 })[1].status, "pending");
  assert.equal(applyDirectionEvent(directions, { type: "prompt_applied", prompt_version: 99 })[1].status, "pending");
  assert.equal(applyDirectionEvent(directions, { type: "prompt_applied", prompt_version: 2 })[1].status, "applied");
  assert.equal(applyDirectionEvent(directions, { type: "prompt_rejected", prompt_version: 2 })[1].status, "rejected");
  assert.equal(directions[1].status, "pending");
});

test("malformed realtime events do not crash message handling", () => {
  for (const raw of ["{bad", "null", "[]", "4", "{}", null, undefined]) assert.equal(parseServerMessage(raw), null);
  assert.deepEqual(parseServerMessage('{"type":"configured","prompt_version":1}'), { type: "configured", prompt_version: 1 });
});

test("monitor timecode uses 24 fps and handles invalid timestamps", () => {
  assert.equal(timecode(3661.5), "01:01:01:12");
  assert.equal(timecode(-1), "00:00:00:00");
  assert.equal(timecode(NaN), "00:00:00:00");
});
