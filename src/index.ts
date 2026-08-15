import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import pkg from "../package.json" with { type: "json" };

import type { ServerConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { GraylogClient } from "./graylog-client.js";
import { createLogger } from "./logger.js";
import {
  allowedStreamKeys,
  MAX_MESSAGE_MAX_CHARS,
  normalizeAbsoluteSearch,
  normalizeSearch,
  STREAM_METADATA,
} from "./policy.js";

const logger = createLogger();
const config = loadServerConfig();
const graylog = new GraylogClient(config, fetch, logger);
const allowedKeys = allowedStreamKeys(config.profile);
const firstAllowedKey = allowedKeys[0];
if (!firstAllowedKey) {
  throw new Error(`No streams are configured for profile ${config.profile}.`);
}
const streamKeySchema = z.enum([firstAllowedKey, ...allowedKeys.slice(1)]);

logger.info("MCP server started", {
  profile: config.profile,
  base_url_host: config.baseUrl.host,
  streams: allowedKeys.join(","),
});

function createServer(): McpServer {
  const server = new McpServer(
    { name: "graylog43-query-mcp", version: pkg.version },
    {
      instructions:
        "本服务器为只读。仅可搜索返回的逻辑 Stream key。查询条件越具体，允许搜索的时间范围越长；通配符查询的时间范围较短。search_stream 按相对时间范围搜索；search_stream_absolute 按绝对的 from/to 时间窗口搜索。",
    },
  );

  server.registerTool(
    "get_system_info",
    {
      title: "获取 Graylog 系统信息",
      description: "验证所配置的 Graylog profile 是否可达，并返回其上报的版本号。",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => toolResult(await graylog.getSystemInfo()),
  );

  server.registerTool(
    "list_allowed_streams",
    {
      title: "列出允许的 Graylog Stream",
      description: "列出本 MCP 进程可用的逻辑 Stream 名称。有意不返回 Stream ID。",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const streams = allowedStreamKeys(config.profile).map((streamKey) => ({
        stream_key: streamKey,
        title: STREAM_METADATA[streamKey].title,
        environment: config.profile === "prd" ? "正式" : "非正式",
      }));
      return toolResult({ profile: config.profile, streams });
    },
  );

  server.registerTool(
    "search_stream",
    {
      title: "搜索允许的 Graylog Stream",
      description:
        "通过 Graylog 4.3 的 JSON 消息 API 搜索一个允许的 Stream。结果按时间倒序，仅包含 timestamp、source、level、app_name 和 message 字段。",
      inputSchema: z.object({
        stream_key: streamKeySchema.describe("list_allowed_streams 返回的逻辑 Stream key。"),
        query: z.string().max(1_024).optional().describe("Graylog/Lucene 查询语句。默认为 *。"),
        range_seconds: z.number().int().positive().optional().describe("相对时间范围（秒）。"),
        limit: z.number().int().positive().optional().describe("返回的最大消息条数。"),
        offset: z.number().int().nonnegative().optional().describe("结果偏移量，上限由服务器决定。"),
        message_max_chars: z
          .number()
          .int()
          .min(0)
          .max(MAX_MESSAGE_MAX_CHARS)
          .optional()
          .describe("每个消息字段的最大字符数。0 表示不截断。"),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const normalized = normalizeSearch(config.profile, input);
        return toolResult(await graylog.search(normalized));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "search_stream_absolute",
    {
      title: "按绝对时间窗口搜索允许的 Graylog Stream",
      description:
        "通过 Graylog 4.3 的 JSON 消息 API，使用绝对的 from/to 时间窗口搜索一个允许的 Stream。结果按时间倒序，仅包含 timestamp、source、level、app_name 和 message 字段。",
      inputSchema: z.object({
        stream_key: streamKeySchema.describe("list_allowed_streams 返回的逻辑 Stream key。"),
        from: z.string().describe("ISO 8601 格式的开始时间戳，例如 2026-08-14T10:00:00.000Z。"),
        to: z.string().optional().describe("ISO 8601 格式的结束时间戳。默认为当前时间。"),
        query: z.string().max(1_024).optional().describe("Graylog/Lucene 查询语句。默认为 *。"),
        limit: z.number().int().positive().optional().describe("返回的最大消息条数。"),
        offset: z.number().int().nonnegative().optional().describe("结果偏移量，上限由服务器决定。"),
        message_max_chars: z
          .number()
          .int()
          .min(0)
          .max(MAX_MESSAGE_MAX_CHARS)
          .optional()
          .describe("每个消息字段的最大字符数。0 表示不截断。"),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const normalized = normalizeAbsoluteSearch(config.profile, input);
        return toolResult(await graylog.searchAbsolute(normalized));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Graylog tool error.";
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function loadServerConfig(): ServerConfig {
  try {
    return loadConfig();
  } catch (error) {
    logger.error("Failed to load configuration.", {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

serveStdio(createServer);
