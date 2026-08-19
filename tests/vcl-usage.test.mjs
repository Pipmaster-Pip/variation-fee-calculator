import { test } from "node:test";
import assert from "node:assert/strict";
import usage from "../variation-fee-calculator/assets/js/vcl-usage.js";

// Helper: install a counting fetch mock + config on globalThis, return the calls array.
function install(countUrl) {
  const calls = [];
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(); };
  globalThis.VCL_CONFIG = countUrl ? { countUrl } : {};
  return calls;
}

test("fires exactly one POST with the right JSON body for a fresh key", () => {
  const calls = install("http://x/count");
  usage.track("timelines", "start");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://x/count");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { tool: "timelines", event: "start" });
});

test("dedups: the same key never fires twice", () => {
  const calls = install("http://x/count");
  usage.track("calculator", "finish");
  usage.track("calculator", "finish");
  assert.equal(calls.length, 1);
});

test("no countUrl -> no fetch, and the key stays retryable", () => {
  const calls = install(null);            // config without countUrl
  usage.track("budget", "handoff");
  assert.equal(calls.length, 0);
  const calls2 = install("http://x/count"); // now configured
  usage.track("budget", "handoff");         // same key must still fire
  assert.equal(calls2.length, 1);
});

test("a throwing fetch never propagates to the caller", () => {
  install("http://x/count");
  globalThis.fetch = () => { throw new Error("boom"); };
  assert.doesNotThrow(() => usage.track("workflow", "finish"));
});
