import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAbsoluteSearch, normalizeSearch } from "../src/policy.js";

test("applies the confirmed defaults for each profile", () => {
  assert.deepEqual(normalizeSearch("tst", { stream_key: "tst_precision" }), {
    streamKey: "tst_precision",
    query: "*",
    rangeSeconds: 5_400,
    limit: 50,
    offset: 0,
    messageMaxChars: 1_024,
  });
  assert.deepEqual(normalizeSearch("prd", { stream_key: "prd_workflow" }), {
    streamKey: "prd_workflow",
    query: "*",
    rangeSeconds: 3_600,
    limit: 50,
    offset: 0,
    messageMaxChars: 1_024,
  });
});

test("rejects streams from the other profile", () => {
  assert.throws(
    () => normalizeSearch("prd", { stream_key: "tst_precision" }),
    /not allowed/,
  );
});

test("allows long ranges only when the query is specific", () => {
  assert.throws(
    () => normalizeSearch("prd", { stream_key: "prd_precision", range_seconds: 7_201 }),
    /query=\*/,
  );
  assert.equal(
    normalizeSearch("prd", {
      stream_key: "prd_precision",
      query: "level:3",
      range_seconds: 86_400,
    }).rangeSeconds,
    86_400,
  );
});

test("enforces result and offset limits", () => {
  assert.throws(
    () => normalizeSearch("tst", { stream_key: "tst_workflow", limit: 501 }),
    /limit/,
  );
  assert.throws(
    () => normalizeSearch("tst", { stream_key: "tst_workflow", limit: 0 }),
    /limit/,
  );
  assert.equal(
    normalizeSearch("tst", { stream_key: "tst_workflow", limit: 500 }).limit,
    500,
  );
  assert.throws(
    () => normalizeSearch("prd", { stream_key: "prd_workflow", offset: 1_001 }),
    /offset/,
  );
});

test("absolute search normalizes from/to and applies defaults", () => {
  assert.deepEqual(
    normalizeAbsoluteSearch("tst", {
      stream_key: "tst_precision",
      from: "2026-08-14T00:00:00.000Z",
      to: "2026-08-14T01:00:00.000Z",
    }),
    {
      streamKey: "tst_precision",
      query: "*",
      from: "2026-08-14T00:00:00.000Z",
      to: "2026-08-14T01:00:00.000Z",
      limit: 50,
      offset: 0,
      messageMaxChars: 1_024,
    },
  );
});

test("absolute search rejects streams from the other profile", () => {
  assert.throws(
    () =>
      normalizeAbsoluteSearch("prd", {
        stream_key: "tst_precision",
        from: "2026-08-14T00:00:00.000Z",
        to: "2026-08-14T01:00:00.000Z",
      }),
    /not allowed/,
  );
});

test("absolute search enforces the window limit", () => {
  assert.throws(
    () =>
      normalizeAbsoluteSearch("tst", {
        stream_key: "tst_precision",
        from: "2026-08-10T00:00:00.000Z",
        to: "2026-08-14T00:00:00.000Z",
      }),
    /window/,
  );
});

test("absolute search restricts query=* to the shorter window", () => {
  assert.throws(
    () =>
      normalizeAbsoluteSearch("tst", {
        stream_key: "tst_precision",
        from: "2026-08-13T00:00:00.000Z",
        to: "2026-08-14T00:00:00.000Z",
      }),
    /query=\*/,
  );
  assert.equal(
    normalizeAbsoluteSearch("tst", {
      stream_key: "tst_precision",
      query: "level:3",
      from: "2026-08-13T00:00:00.000Z",
      to: "2026-08-14T00:00:00.000Z",
    }).from,
    "2026-08-13T00:00:00.000Z",
  );
});

test("absolute search rejects invalid, inverted, and future timestamps", () => {
  assert.throws(
    () =>
      normalizeAbsoluteSearch("tst", {
        stream_key: "tst_precision",
        from: "not-a-time",
      }),
    /ISO 8601/,
  );
  assert.throws(
    () =>
      normalizeAbsoluteSearch("tst", {
        stream_key: "tst_precision",
        from: "2026-08-14T02:00:00.000Z",
        to: "2026-08-14T01:00:00.000Z",
      }),
    /earlier than/,
  );
  assert.throws(
    () =>
      normalizeAbsoluteSearch("tst", {
        stream_key: "tst_precision",
        from: "2099-01-01T00:00:00.000Z",
        to: "2099-01-02T00:00:00.000Z",
      }),
    /future/,
  );
});

test("absolute search defaults to the current time", () => {
  const from = new Date(Date.now() - 60_000).toISOString();
  const result = normalizeAbsoluteSearch("tst", {
    stream_key: "tst_workflow",
    from,
  });
  assert.equal(result.from, from);
  const toMilliseconds = Date.parse(result.to);
  assert.ok(toMilliseconds >= Date.now() - 5_000);
  assert.ok(toMilliseconds <= Date.now() + 5_000);
});

test("enforces message_max_chars bounds", () => {
  assert.throws(
    () => normalizeSearch("tst", { stream_key: "tst_workflow", message_max_chars: -1 }),
    /message_max_chars/,
  );
  assert.throws(
    () => normalizeSearch("tst", { stream_key: "tst_workflow", message_max_chars: 100_001 }),
    /message_max_chars/,
  );
  assert.equal(
    normalizeSearch("tst", { stream_key: "tst_workflow", message_max_chars: 0 }).messageMaxChars,
    0,
  );
});
