export type Profile = "tst" | "prd";

export type StreamKey =
  | "tst_precision"
  | "tst_workflow"
  | "prd_precision"
  | "prd_workflow";

export type SearchArguments = {
  stream_key: StreamKey;
  query?: string | undefined;
  range_seconds?: number | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  message_max_chars?: number | undefined;
};

export type AbsoluteSearchArguments = {
  stream_key: StreamKey;
  from: string;
  to?: string | undefined;
  query?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  message_max_chars?: number | undefined;
};

export type SearchPolicy = {
  defaultRangeSeconds: number;
  maxRangeSeconds: number;
  maxWildcardRangeSeconds: number;
  defaultLimit: number;
  maxLimit: number;
  maxOffset: number;
};

export const POLICIES: Record<Profile, SearchPolicy> = {
  tst: {
    defaultRangeSeconds: 5_400,
    maxRangeSeconds: 259_200,
    maxWildcardRangeSeconds: 43_200,
    defaultLimit: 50,
    maxLimit: 500,
    maxOffset: 1_000,
  },
  prd: {
    defaultRangeSeconds: 3_600,
    maxRangeSeconds: 86_400,
    maxWildcardRangeSeconds: 7_200,
    defaultLimit: 50,
    maxLimit: 500,
    maxOffset: 1_000,
  },
};

export const DEFAULT_MESSAGE_MAX_CHARS = 1_024;
export const MAX_MESSAGE_MAX_CHARS = 100_000;

export const STREAM_METADATA: Record<StreamKey, { title: string; profile: Profile }> = {
  tst_precision: { title: "【非正式】精准教学", profile: "tst" },
  tst_workflow: { title: "【非正式】业务流", profile: "tst" },
  prd_precision: { title: "【正式】精准教学", profile: "prd" },
  prd_workflow: { title: "【正式】业务流", profile: "prd" },
};

export type NormalizedSearch = {
  streamKey: StreamKey;
  query: string;
  rangeSeconds: number;
  limit: number;
  offset: number;
  messageMaxChars: number;
};

export type NormalizedAbsoluteSearch = {
  streamKey: StreamKey;
  query: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
  messageMaxChars: number;
};

export function allowedStreamKeys(profile: Profile): StreamKey[] {
  return (Object.keys(STREAM_METADATA) as StreamKey[]).filter(
    (streamKey) => STREAM_METADATA[streamKey].profile === profile,
  );
}

export function normalizeSearch(profile: Profile, input: SearchArguments): NormalizedSearch {
  if (!allowedStreamKeys(profile).includes(input.stream_key)) {
    throw new Error(`Stream ${input.stream_key} is not allowed for profile ${profile}.`);
  }

  const query = input.query?.trim() || "*";
  if (query.length > 1_024) {
    throw new Error("query must not exceed 1024 characters.");
  }

  const policy = POLICIES[profile];
  const rangeSeconds = input.range_seconds ?? policy.defaultRangeSeconds;
  assertIntegerInRange("range_seconds", rangeSeconds, 1, policy.maxRangeSeconds);

  if (query === "*" && rangeSeconds > policy.maxWildcardRangeSeconds) {
    throw new Error(
      `query=* is limited to ${policy.maxWildcardRangeSeconds} seconds for profile ${profile}. Add a query condition to search a longer time range.`,
    );
  }

  const limit = input.limit ?? policy.defaultLimit;
  assertIntegerInRange("limit", limit, 1, policy.maxLimit);

  const offset = input.offset ?? 0;
  assertIntegerInRange("offset", offset, 0, policy.maxOffset);

  const messageMaxChars = input.message_max_chars ?? DEFAULT_MESSAGE_MAX_CHARS;
  assertIntegerInRange("message_max_chars", messageMaxChars, 0, MAX_MESSAGE_MAX_CHARS);

  return { streamKey: input.stream_key, query, rangeSeconds, limit, offset, messageMaxChars };
}

export function normalizeAbsoluteSearch(profile: Profile, input: AbsoluteSearchArguments): NormalizedAbsoluteSearch {
  if (!allowedStreamKeys(profile).includes(input.stream_key)) {
    throw new Error(`Stream ${input.stream_key} is not allowed for profile ${profile}.`);
  }

  const query = input.query?.trim() || "*";
  if (query.length > 1_024) {
    throw new Error("query must not exceed 1024 characters.");
  }

  const now = Date.now();
  const futureToleranceMs = 5_000;
  const from = parseTimestamp("from", input.from);
  const to = input.to === undefined ? now : parseTimestamp("to", input.to);
  if (from > now + futureToleranceMs) {
    throw new Error("from must not be in the future.");
  }
  if (to > now + futureToleranceMs) {
    throw new Error("to must not be in the future.");
  }
  if (from >= to) {
    throw new Error("from must be earlier than to.");
  }

  const policy = POLICIES[profile];
  const windowSeconds = Math.floor((to - from) / 1_000);
  if (windowSeconds > policy.maxRangeSeconds) {
    throw new Error(
      `The from/to window must not exceed ${policy.maxRangeSeconds} seconds for profile ${profile}.`,
    );
  }
  if (query === "*" && windowSeconds > policy.maxWildcardRangeSeconds) {
    throw new Error(
      `query=* is limited to ${policy.maxWildcardRangeSeconds} seconds for profile ${profile}. Add a query condition to search a longer time range.`,
    );
  }

  const limit = input.limit ?? policy.defaultLimit;
  assertIntegerInRange("limit", limit, 1, policy.maxLimit);

  const offset = input.offset ?? 0;
  assertIntegerInRange("offset", offset, 0, policy.maxOffset);

  const messageMaxChars = input.message_max_chars ?? DEFAULT_MESSAGE_MAX_CHARS;
  assertIntegerInRange("message_max_chars", messageMaxChars, 0, MAX_MESSAGE_MAX_CHARS);

  return {
    streamKey: input.stream_key,
    query,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    limit,
    offset,
    messageMaxChars,
  };
}

function parseTimestamp(name: string, value: string): number {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`${name} must be a valid ISO 8601 timestamp.`);
  }
  return milliseconds;
}

function assertIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}
