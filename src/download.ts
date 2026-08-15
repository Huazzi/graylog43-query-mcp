#!/usr/bin/env node
/// <reference types="node" />
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "./config.js";
import { GraylogClient, type ExportQuery } from "./graylog-client.js";
import { createLogger, type Logger } from "./logger.js";
import { allowedStreamKeys, type Profile, type StreamKey } from "./policy.js";

const DEFAULT_CHUNK_MINUTES = 60;

type DownloadArgs = {
  profile: Profile;
  streamKey: StreamKey;
  from: string;
  to: string;
  query: string;
  fields: string[] | undefined;
  out: string | undefined;
  chunkMinutes: number;
  dedup: boolean;
};

export type DownloadSummary = {
  file: string;
  total: number;
  deduped: number;
  windows: number;
};

export type DownloadOptions = {
  streamKey: StreamKey;
  query: string;
  fromMs: number;
  toMs: number;
  fields?: string[] | undefined;
  chunkMinutes: number;
  dedup: boolean;
  outPath: string;
};

export function parseArgs(argv: string[]): DownloadArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === undefined || argument === "") {
      continue;
    }
    if (argument.startsWith("--no-")) {
      flags.add(argument.slice(5));
      continue;
    }
    if (argument.startsWith("--")) {
      const key = argument.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}.`);
      }
      values.set(key, value);
      i += 1;
    } else {
      positionals.push(argument);
    }
  }

  if (positionals.length > 2) {
    throw new Error(`Unexpected argument: ${positionals[2]}.`);
  }

  const profileFlag = values.get("profile");
  const streamFlag = values.get("stream");
  if (positionals.length > 0 && (profileFlag !== undefined || streamFlag !== undefined)) {
    throw new Error("Use either positional profile/stream or --profile/--stream, not both.");
  }

  const profile = positionals[0] ?? profileFlag;
  if (profile !== "tst" && profile !== "prd") {
    throw new Error("--profile must be tst or prd.");
  }

  const stream = positionals[1] ?? streamFlag;
  if (stream === undefined) {
    throw new Error("Missing required stream (positional or --stream).");
  }

  const query = values.get("query")?.trim() || "*";
  if (query.length > 1_024) {
    throw new Error("--query must not exceed 1024 characters.");
  }

  const fields = values
    .get("fields")
    ?.split(",")
    .map((field) => field.trim())
    .filter((field) => field !== "");

  const { from, to } = resolveTimeRange(values);

  return {
    profile: profile as Profile,
    streamKey: resolveStreamKey(profile as Profile, stream),
    from,
    to,
    query,
    fields: fields !== undefined && fields.length > 0 ? fields : undefined,
    out: values.get("out"),
    chunkMinutes: parsePositiveInt(values.get("chunk-minutes") ?? String(DEFAULT_CHUNK_MINUTES), "chunk-minutes"),
    dedup: !flags.has("dedup"),
  };
}

function resolveTimeRange(values: Map<string, string>): { from: string; to: string } {
  const hasAbsolute = values.has("from") || values.has("to");
  const hasRelative = values.has("since") || values.has("until");
  if (hasAbsolute && hasRelative) {
    throw new Error("Use either --from/--to or --since/--until, not both.");
  }
  if (hasAbsolute) {
    const fromMs = parseIso(requireValue(values, "from"), "--from");
    const toMs = values.get("to") === undefined ? Date.now() : parseIso(values.get("to")!, "--to");
    return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
  }
  if (hasRelative) {
    const now = Date.now();
    const fromMs = now - parseDuration(requireValue(values, "since"));
    const toMs = values.get("until") === undefined ? now : resolveUntil(values.get("until")!, now);
    return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
  }
  throw new Error("Missing time range: provide --from/--to or --since/--until.");
}

function resolveUntil(raw: string, now: number): number {
  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) {
    return iso;
  }
  return now - parseDuration(raw);
}

function parseDuration(raw: string): number {
  const match = /^(\d+)([mhd])$/.exec(raw);
  if (match === null) {
    throw new Error("--since/--until must be a duration like 30m, 3h, or 2d, or an ISO timestamp.");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * factor;
}

export function resolveStreamKey(profile: Profile, stream: string): StreamKey {
  const candidates = allowedStreamKeys(profile);
  if (candidates.includes(stream as StreamKey)) {
    return stream as StreamKey;
  }
  const mapped = `${profile}_${stream}` as StreamKey;
  if (candidates.includes(mapped)) {
    return mapped;
  }
  const shortNames = candidates.map((key) => key.replace(`${profile}_`, ""));
  throw new Error(`--stream must be ${shortNames.join(" or ")} for profile ${profile}.`);
}

export function chunkWindows(fromMs: number, toMs: number, chunkMs: number): Array<{ from: string; to: string }> {
  const windows: Array<{ from: string; to: string }> = [];
  for (let start = fromMs; start < toMs; start += chunkMs) {
    const end = Math.min(start + chunkMs, toMs);
    windows.push({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
  }
  return windows;
}

export async function* readNdJsonLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== "") {
          yield line;
        }
        newline = buffer.indexOf("\n");
      }
    }
    const remainder = buffer.trim();
    if (remainder !== "") {
      yield remainder;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function downloadMessages(
  client: GraylogClient,
  options: DownloadOptions,
  logger: Logger,
): Promise<DownloadSummary> {
  const { streamKey, query, fromMs, toMs, fields, chunkMinutes, dedup, outPath } = options;
  const queryForExport: ExportQuery = {
    streamKey,
    query,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    fields,
  };

  await client.probeExport(queryForExport);

  const windows = chunkWindows(fromMs, toMs, chunkMinutes * 60_000);
  await mkdir(dirname(outPath), { recursive: true });

  const writer = createWriteStream(outPath);
  const seen = new Set<string>();
  let total = 0;
  let deduped = 0;

  try {
    for (const window of windows) {
      const body = await client.exportMessages({ ...queryForExport, from: window.from, to: window.to });
      for await (const line of readNdJsonLines(body)) {
        let id: unknown;
        try {
          id = (JSON.parse(line) as { _id?: unknown })._id;
        } catch {
          throw new Error("Graylog export returned an unexpected line; expected JSON Lines (NDJSON) messages.");
        }
        if (dedup && typeof id === "string") {
          if (seen.has(id)) {
            deduped += 1;
            continue;
          }
          seen.add(id);
        }
        await writeLine(writer, line);
        total += 1;
      }
      logger.info("Downloaded chunk.", { from: window.from, to: window.to });
    }
  } finally {
    await new Promise<void>((resolve) => {
      writer.end(resolve);
    });
  }

  return { file: outPath, total, deduped, windows: windows.length };
}

function requireValue(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined || value === "") {
    throw new Error(`Missing required --${key}.`);
  }
  return value;
}

function parsePositiveInt(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return value;
}

function parseIso(value: string, name: string): number {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`${name} must be a valid ISO 8601 timestamp.`);
  }
  return milliseconds;
}

function defaultOutPath(profile: Profile, streamKey: StreamKey, fromMs: number, toMs: number): string {
  const stamp = `${compactIso(fromMs)}-${compactIso(toMs)}`;
  return join("downloads", `${profile}-${streamKey}-${stamp}.jsonl`);
}

function compactIso(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveFields(fields: string[] | undefined, dedup: boolean): string[] | undefined {
  if (fields === undefined || dedup === false || fields.includes("_id")) {
    return fields;
  }
  return [...fields, "_id"];
}

function writeLine(stream: WriteStream, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = () => {
      reject(new Error("Failed to write download file."));
    };
    stream.once("error", onError);
    if (stream.write(`${line}\n`)) {
      stream.off("error", onError);
      resolve();
    } else {
      stream.once("drain", () => {
        stream.off("error", onError);
        resolve();
      });
    }
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const logger = createLogger();
  const config = loadConfig(["--profile", args.profile]);
  const client = new GraylogClient(config, fetch, logger);

  const fromMs = parseIso(args.from, "from");
  const toMs = parseIso(args.to, "to");
  if (fromMs >= toMs) {
    throw new Error("The download time range is inverted: the start must be earlier than the end.");
  }

  const outPath = args.out ?? defaultOutPath(args.profile, args.streamKey, fromMs, toMs);
  const fields = resolveFields(args.fields, args.dedup);

  logger.info("Starting Graylog download.", {
    profile: args.profile,
    stream_key: args.streamKey,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    out: outPath,
    chunk_minutes: args.chunkMinutes,
  });

  const summary = await downloadMessages(
    client,
    {
      streamKey: args.streamKey,
      query: args.query,
      fromMs,
      toMs,
      fields,
      chunkMinutes: args.chunkMinutes,
      dedup: args.dedup,
      outPath,
    },
    logger,
  );

  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    createLogger().error("Download failed.", { reason: message });
    process.exitCode = 1;
  });
}
