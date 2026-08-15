import assert from "node:assert/strict";
import test from "node:test";

import { createLogger, Logger } from "../src/logger.js";

test("createLogger parses GRAYLOG_LOG_LEVEL and falls back to warn", () => {
  assert.equal(createLogger({}).level, "warn");
  assert.equal(createLogger({ GRAYLOG_LOG_LEVEL: "debug" }).level, "debug");
  assert.equal(createLogger({ GRAYLOG_LOG_LEVEL: "DEBUG" }).level, "debug");
  assert.equal(createLogger({ GRAYLOG_LOG_LEVEL: "verbose" }).level, "warn");
});

test("logger suppresses messages below the configured level", () => {
  const lines: string[] = [];
  const logger = new Logger("info", (line) => lines.push(line));

  logger.debug("hidden");
  logger.info("shown");
  logger.error("also shown");

  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /"level":"info"/);
  assert.match(lines[0] ?? "", /"message":"shown"/);
  assert.match(lines[1] ?? "", /"level":"error"/);
  assert.match(lines[1] ?? "", /"message":"also shown"/);
});

test("logger emits structured fields without touching the message", () => {
  const lines: string[] = [];
  const logger = new Logger("warn", (line) => lines.push(line));

  logger.warn("request failed", { status: 503, took_ms: 42 });

  const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(entry.status, 503);
  assert.equal(entry.took_ms, 42);
  assert.equal(entry.logger, "graylog43-query-mcp");
  assert.equal(entry.message, "request failed");
});
