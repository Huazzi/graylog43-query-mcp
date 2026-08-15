import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ServerConfig } from "../src/config.js";
import { chunkWindows, downloadMessages, parseArgs, readNdJsonLines, resolveStreamKey } from "../src/download.js";
import { GraylogClient } from "../src/graylog-client.js";
import { Logger } from "../src/logger.js";

test("parseArgs parses required options and defaults", () => {
  const args = parseArgs([
    "--profile",
    "tst",
    "--stream",
    "precision",
    "--from",
    "2026-08-14T10:00:00.000Z",
    "--to",
    "2026-08-14T12:00:00.000Z",
    "--query",
    "level:3",
    "--fields",
    "app_name,message",
    "--out",
    "logs/out.jsonl",
    "--chunk-minutes",
    "30",
  ]);
  assert.deepEqual(args, {
    profile: "tst",
    streamKey: "tst_precision",
    from: "2026-08-14T10:00:00.000Z",
    to: "2026-08-14T12:00:00.000Z",
    query: "level:3",
    fields: ["app_name", "message"],
    out: "logs/out.jsonl",
    chunkMinutes: 30,
    dedup: true,
  });
});

test("parseArgs defaults query and chunk size, and honours --no-dedup", () => {
  const args = parseArgs([
    "--profile",
    "prd",
    "--stream",
    "workflow",
    "--from",
    "2026-08-14T10:00:00.000Z",
    "--to",
    "2026-08-14T11:00:00.000Z",
    "--no-dedup",
  ]);
  assert.equal(args.query, "*");
  assert.equal(args.chunkMinutes, 60);
  assert.equal(args.dedup, false);
  assert.equal(args.streamKey, "prd_workflow");
});

test("parseArgs rejects invalid input", () => {
  const base = ["--from", "2026-08-14T10:00:00.000Z", "--to", "2026-08-14T11:00:00.000Z"];
  assert.throws(
    () => parseArgs(["--profile", "prod", "--stream", "precision", ...base]),
    /--profile must be tst or prd/,
  );
  assert.throws(
    () => parseArgs(["--profile", "tst", "--stream", "accuracy", ...base]),
    /--stream must be/,
  );
  assert.throws(
    () => parseArgs(["--profile", "tst", "--stream", "precision", "--to", "2026-08-14T11:00:00.000Z"]),
    /Missing required --from/,
  );
  assert.throws(
    () => parseArgs(["--profile", "tst", "--stream", "precision", ...base, "--chunk-minutes", "0"]),
    /--chunk-minutes must be a positive integer/,
  );
  assert.throws(() => parseArgs(["tst", "precision", "extra"]), /Unexpected argument/);
  assert.throws(() => parseArgs(["foo"]), /--profile must be tst or prd/);
  assert.throws(
    () => parseArgs(["tst", "precision", "--from", "not-a-time", "--to", "2026-08-14T11:00:00.000Z"]),
    /--from must be a valid ISO/,
  );
});

test("parseArgs accepts positional profile and stream", () => {
  const args = parseArgs([
    "tst",
    "precision",
    "--from",
    "2026-08-14T10:00:00.000Z",
    "--to",
    "2026-08-14T11:00:00.000Z",
  ]);
  assert.equal(args.profile, "tst");
  assert.equal(args.streamKey, "tst_precision");
  assert.equal(args.from, "2026-08-14T10:00:00.000Z");
});

test("parseArgs rejects mixing positional and flag forms", () => {
  assert.throws(
    () =>
      parseArgs([
        "tst",
        "--profile",
        "tst",
        "--stream",
        "precision",
        "--from",
        "2026-08-14T10:00:00.000Z",
        "--to",
        "2026-08-14T11:00:00.000Z",
      ]),
    /not both/,
  );
});

test("parseArgs supports relative since/until", () => {
  const before = Date.now();
  const args = parseArgs(["tst", "precision", "--since", "3h", "--until", "1h"]);
  const after = Date.now();
  const fromMs = Date.parse(args.from);
  const toMs = Date.parse(args.to);
  assert.ok(fromMs >= before - 3 * 3_600_000 - 5_000);
  assert.ok(fromMs <= after - 3 * 3_600_000 + 5_000);
  assert.ok(toMs >= before - 3_600_000 - 5_000);
  assert.ok(toMs <= after - 3_600_000 + 5_000);
});

test("parseArgs defaults until to now and rejects mixing or bad time forms", () => {
  const args = parseArgs(["tst", "precision", "--since", "30m"]);
  assert.ok(Math.abs(Date.parse(args.to) - Date.now()) < 5_000);
  assert.throws(
    () => parseArgs(["tst", "precision", "--since", "30m", "--from", "2026-08-14T10:00:00.000Z"]),
    /not both/,
  );
  assert.throws(() => parseArgs(["tst", "precision", "--since", "bogus"]), /duration/);
  assert.throws(() => parseArgs(["tst", "precision"]), /Missing time range/);
});

test("resolveStreamKey accepts short names and full keys", () => {
  assert.equal(resolveStreamKey("tst", "precision"), "tst_precision");
  assert.equal(resolveStreamKey("prd", "workflow"), "prd_workflow");
  assert.equal(resolveStreamKey("tst", "tst_precision"), "tst_precision");
  assert.equal(resolveStreamKey("prd", "precision"), "prd_precision");
  assert.throws(() => resolveStreamKey("tst", "prd_precision"), /--stream must be/);
});

test("chunkWindows splits the range and keeps the tail", () => {
  const from = Date.UTC(2026, 7, 14, 10, 0, 0);
  const windows = chunkWindows(from, from + 150_000, 60_000); // 2.5 min in 1-min chunks
  assert.deepEqual(windows, [
    { from: "2026-08-14T10:00:00.000Z", to: "2026-08-14T10:01:00.000Z" },
    { from: "2026-08-14T10:01:00.000Z", to: "2026-08-14T10:02:00.000Z" },
    { from: "2026-08-14T10:02:00.000Z", to: "2026-08-14T10:02:30.000Z" },
  ]);
});

test("readNdJsonLines yields non-empty lines from a response body", async () => {
  const body = new Response('{"_id":"a"}\n\n{"_id":"b"}\n', { status: 200 }).body;
  const lines: string[] = [];
  for await (const line of readNdJsonLines(body!)) {
    lines.push(line);
  }
  assert.deepEqual(lines, ['{"_id":"a"}', '{"_id":"b"}']);
});

test("downloadMessages dedups by _id across chunks and writes JSONL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "graylog-dl-"));
  const outPath = join(dir, "out.jsonl");
  const config: ServerConfig = {
    profile: "tst",
    baseUrl: new URL("http://graylog.invalid:9000/"),
    token: "token",
    streamIds: {
      tst_precision: "p",
      tst_workflow: "w",
      prd_precision: "unused",
      prd_workflow: "unused",
    },
  };

  let callCount = 0;
  const client = new GraylogClient(config, async () => {
    callCount += 1;
    // Call 1 is the probe; calls 2 and 3 are the two time chunks.
    const body =
      callCount === 1
        ? '{"_id":"probe"}\n'
        : callCount === 2
          ? '{"_id":"a","message":"one"}\n{"_id":"c","message":"three"}\n'
          : '{"_id":"a","message":"one-dup"}\n{"_id":"b","message":"two"}\n';
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const from = Date.UTC(2026, 7, 14, 10, 0, 0);
  try {
    const summary = await downloadMessages(
      client,
      {
        streamKey: "tst_precision",
        query: "*",
        fromMs: from,
        toMs: from + 120_000, // 2 minutes → 2 chunks of 60 seconds
        chunkMinutes: 1,
        dedup: true,
        outPath,
      },
      new Logger("error"),
    );

    assert.equal(summary.total, 3);
    assert.equal(summary.deduped, 1);
    assert.equal(summary.windows, 2);

    const content = await readFile(outPath, "utf8");
    const ids = content
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { _id: string })._id)
      .sort();
    assert.deepEqual(ids, ["a", "b", "c"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
