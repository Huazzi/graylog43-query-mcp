import assert from "node:assert/strict";
import test from "node:test";

import type { ServerConfig } from "../src/config.js";
import { GraylogClient } from "../src/graylog-client.js";
import { Logger } from "../src/logger.js";

function makeConfig(): ServerConfig {
  return {
    profile: "tst",
    baseUrl: new URL("http://graylog.example:9000/"),
    token: "read-only-token",
    streamIds: {
      tst_precision: "precision-stream",
      tst_workflow: "workflow-stream",
      prd_precision: "unused",
      prd_workflow: "unused",
    },
  };
}

test("search uses the fixed JSON endpoint, Stream filter, and field allowlist", async () => {
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  const config = makeConfig();
  const client = new GraylogClient(config, async (input, init) => {
    capturedUrl = new URL(input instanceof Request ? input.url : input.toString());
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({
      messages: [{
        index: "must-not-leak",
        message: {
          timestamp: "2026-08-04T11:14:26.440Z",
          source: "example-host",
          level: 4,
          app_name: "example-app",
          message: "example-message",
          _id: "must-not-leak",
        },
      }],
      total_results: 94,
      from: "2026-08-04T11:09:30.409Z",
      to: "2026-08-04T11:14:30.409Z",
      time: 831,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const result = await client.search({
    streamKey: "tst_precision",
    query: "level:3",
    rangeSeconds: 5_400,
    limit: 50,
    offset: 0,
    messageMaxChars: 1_024,
  });

  assert.equal(capturedUrl?.pathname, "/api/search/universal/relative");
  assert.equal(capturedUrl?.searchParams.get("filter"), "streams:precision-stream");
  assert.equal(
    capturedUrl?.searchParams.get("fields"),
    "timestamp,source,level,app_name,message",
  );
  assert.equal(capturedUrl?.searchParams.get("decorate"), "false");
  assert.equal(capturedHeaders?.get("Accept"), "application/json");
  assert.equal(
    capturedHeaders?.get("Authorization"),
    `Basic ${Buffer.from("read-only-token:token").toString("base64")}`,
  );
  assert.deepEqual(Object.keys(result.messages[0] ?? {}).sort(), [
    "app_name",
    "level",
    "message",
    "source",
    "timestamp",
  ]);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("absolute search uses the absolute endpoint with from/to instead of range", async () => {
  let capturedUrl: URL | undefined;
  const client = new GraylogClient(makeConfig(), async (input) => {
    capturedUrl = new URL(input instanceof Request ? input.url : input.toString());
    return new Response(
      JSON.stringify({
        messages: [],
        total_results: 0,
        from: "2026-08-14T00:00:00.000Z",
        to: "2026-08-14T01:00:00.000Z",
        time: 5,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  await client.searchAbsolute({
    streamKey: "tst_precision",
    query: "level:3",
    from: "2026-08-14T00:00:00.000Z",
    to: "2026-08-14T01:00:00.000Z",
    limit: 50,
    offset: 0,
    messageMaxChars: 1_024,
  });

  assert.equal(capturedUrl?.pathname, "/api/search/universal/absolute");
  assert.equal(capturedUrl?.searchParams.get("from"), "2026-08-14T00:00:00.000Z");
  assert.equal(capturedUrl?.searchParams.get("to"), "2026-08-14T01:00:00.000Z");
  assert.equal(capturedUrl?.searchParams.has("range"), false);
  assert.equal(capturedUrl?.searchParams.get("filter"), "streams:precision-stream");
});

test("truncates message fields according to message_max_chars", async () => {
  let messageText = "";
  let messageIsNull = false;
  const client = new GraylogClient(makeConfig(), async () => {
    return new Response(
      JSON.stringify({
        messages: [
          {
            message: {
              timestamp: "2026-08-04T11:14:26.440Z",
              source: "example-host",
              level: 4,
              app_name: "example-app",
              message: messageIsNull ? null : messageText,
            },
          },
        ],
        total_results: 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const base = {
    streamKey: "tst_precision" as const,
    query: "*",
    rangeSeconds: 5_400,
    limit: 50,
    offset: 0,
  };

  messageText = "x".repeat(50);
  assert.equal(
    (await client.search({ ...base, messageMaxChars: 10 })).messages[0]?.message,
    `${"x".repeat(10)}…`,
  );

  messageText = "x".repeat(10);
  assert.equal(
    (await client.search({ ...base, messageMaxChars: 10 })).messages[0]?.message,
    "x".repeat(10),
  );

  messageText = "x".repeat(50);
  assert.equal(
    (await client.search({ ...base, messageMaxChars: 0 })).messages[0]?.message,
    "x".repeat(50),
  );

  messageIsNull = true;
  assert.equal(
    (await client.search({ ...base, messageMaxChars: 10 })).messages[0]?.message,
    null,
  );
});

test("logs a warning with the HTTP status when Graylog returns an error", async () => {
  const lines: string[] = [];
  const client = new GraylogClient(
    makeConfig(),
    async () => new Response("boom", { status: 503 }),
    new Logger("warn", (line) => lines.push(line)),
  );

  await assert.rejects(
    () =>
      client.search({
        streamKey: "tst_precision",
        query: "*",
        rangeSeconds: 5_400,
        limit: 50,
        offset: 0,
        messageMaxChars: 1_024,
      }),
    /HTTP 503/,
  );

  const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(entry.level, "warn");
  assert.equal(entry.status, 503);
  assert.match(String(entry.message), /HTTP error/);
});
