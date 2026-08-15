import type { ServerConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import type { NormalizedAbsoluteSearch, NormalizedSearch, StreamKey } from "./policy.js";

const SEARCH_FIELDS = ["timestamp", "source", "level", "app_name", "message"] as const;

type GraylogMessage = {
  timestamp?: unknown;
  source?: unknown;
  level?: unknown;
  app_name?: unknown;
  message?: unknown;
};

type GraylogSearchResponse = {
  messages?: Array<{ message?: GraylogMessage }>;
  total_results?: unknown;
  from?: unknown;
  to?: unknown;
  time?: unknown;
};

export type SearchResult = {
  stream_key: string;
  query: string;
  total_results: number;
  returned: number;
  from: string | null;
  to: string | null;
  took_ms: number | null;
  messages: Array<{
    timestamp: string | null;
    source: string | null;
    level: number | null;
    app_name: string | null;
    message: string | null;
  }>;
};

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type RequestOptions = { timeoutMs?: number; label?: string };

export type ExportQuery = {
  streamKey: StreamKey;
  query: string;
  from: string;
  to: string;
  fields?: string[] | undefined;
};

export class GraylogClient {
  public constructor(
    private readonly config: ServerConfig,
    private readonly fetchImpl: FetchFunction = fetch,
    private readonly logger: Logger = createLogger(),
  ) {}

  public async getSystemInfo(): Promise<{ profile: string; version: string | null }> {
    const response = await this.getJson<Record<string, unknown>>("api/system");
    return {
      profile: this.config.profile,
      version: readString(response.version),
    };
  }

  public async search(search: NormalizedSearch): Promise<SearchResult> {
    const streamId = this.requireStreamId(search.streamKey);

    const url = this.apiUrl("api/search/universal/relative");
    url.search = new URLSearchParams({
      query: search.query,
      range: String(search.rangeSeconds),
      limit: String(search.limit),
      offset: String(search.offset),
      sort: "timestamp:desc",
      decorate: "false",
      filter: `streams:${streamId}`,
      fields: SEARCH_FIELDS.join(","),
    }).toString();

    return this.mapSearchResponse(url, search);
  }

  public async searchAbsolute(search: NormalizedAbsoluteSearch): Promise<SearchResult> {
    const streamId = this.requireStreamId(search.streamKey);

    const url = this.apiUrl("api/search/universal/absolute");
    url.search = new URLSearchParams({
      query: search.query,
      from: search.from,
      to: search.to,
      limit: String(search.limit),
      offset: String(search.offset),
      sort: "timestamp:desc",
      decorate: "false",
      filter: `streams:${streamId}`,
      fields: SEARCH_FIELDS.join(","),
    }).toString();

    return this.mapSearchResponse(url, search);
  }

  public async exportMessages(query: ExportQuery): Promise<ReadableStream<Uint8Array>> {
    const response = await this.requestStream(this.buildExportUrl(query));
    if (!response.body) {
      throw new Error("Graylog export returned an empty body.");
    }
    return response.body;
  }

  public async probeExport(query: ExportQuery): Promise<void> {
    const response = await this.requestStream(this.buildExportUrl({ ...query, limit: 1 }));
    await response.body?.cancel();
  }

  private buildExportUrl(query: ExportQuery & { limit?: number }): URL {
    const streamId = this.requireStreamId(query.streamKey);
    const url = this.apiUrl("api/search/universal/absolute/export");
    const params = new URLSearchParams({
      query: query.query,
      from: query.from,
      to: query.to,
      format: "json",
      filter: `streams:${streamId}`,
    });
    if (query.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query.fields !== undefined && query.fields.length > 0) {
      params.set("fields", query.fields.join(","));
    }
    url.search = params.toString();
    return url;
  }

  private requireStreamId(streamKey: string): string {
    const streamId = this.config.streamIds[streamKey as keyof ServerConfig["streamIds"]];
    if (!streamId) {
      throw new Error(`No stream ID is configured for ${streamKey}.`);
    }
    return streamId;
  }

  private async mapSearchResponse(
    url: URL,
    search: NormalizedSearch | NormalizedAbsoluteSearch,
  ): Promise<SearchResult> {
    const response = await this.requestJson<GraylogSearchResponse>(url);
    const messages = (response.messages ?? []).map(({ message = {} }) => ({
      timestamp: readString(message.timestamp),
      source: readString(message.source),
      level: readNumber(message.level),
      app_name: readString(message.app_name),
      message: truncateMessage(readString(message.message), search.messageMaxChars),
    }));

    return {
      stream_key: search.streamKey,
      query: search.query,
      total_results: readNumber(response.total_results) ?? 0,
      returned: messages.length,
      from: readString(response.from),
      to: readString(response.to),
      took_ms: readNumber(response.time),
      messages,
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.requestJson<T>(this.apiUrl(path));
  }

  private apiUrl(path: string): URL {
    return new URL(path, this.config.baseUrl);
  }

  private async requestJson<T>(url: URL): Promise<T> {
    const response = await this.request(url);
    try {
      return (await response.json()) as T;
    } catch {
      this.logger.warn("Graylog returned an invalid JSON response.", { path: url.pathname });
      throw new Error("Graylog returned an invalid JSON response.");
    }
  }

  private async request(url: URL, options: RequestOptions = {}): Promise<Response> {
    const { timeoutMs = 20_000, label = "request" } = options;
    const authorization = `Basic ${Buffer.from(`${this.config.token}:token`).toString("base64")}`;
    const startedAt = Date.now();
    const timing = (status?: number) => ({ path: url.pathname, status, took_ms: Date.now() - startedAt });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          "X-Requested-By": "graylog43-query-mcp",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      this.logger.warn(`Graylog ${label} failed before receiving a response.`, timing());
      throw new Error(`Graylog ${label} failed before receiving a response.`);
    }

    if (!response.ok) {
      this.logger.warn(`Graylog ${label} failed with an HTTP error status.`, timing(response.status));
      throw new Error(`Graylog ${label} failed with HTTP ${response.status}.`);
    }

    this.logger.debug(`Graylog ${label} succeeded.`, timing(response.status));
    return response;
  }

  private async requestStream(url: URL): Promise<Response> {
    return this.request(url, { timeoutMs: 300_000, label: "export" });
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function truncateMessage(value: string | null, maxChars: number): string | null {
  if (value === null || maxChars === 0) {
    return value;
  }
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
