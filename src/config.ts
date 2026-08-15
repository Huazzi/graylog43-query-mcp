/// <reference types="node" />
import { allowedStreamKeys, type Profile, type StreamKey } from "./policy.js";

export type ServerConfig = {
  profile: Profile;
  baseUrl: URL;
  token: string;
  streamIds: Record<StreamKey, string>;
};

export function loadConfig(argv = process.argv.slice(2), env = process.env): ServerConfig {
  const profile = loadProfile(argv, env.GRAYLOG_PROFILE);
  const prefix = profile.toUpperCase();
  const baseUrl = parseBaseUrl(required(env, `GRAYLOG_${prefix}_BASE_URL`));
  const token = required(env, `GRAYLOG_${prefix}_TOKEN`);
  const streamIds = {} as Record<StreamKey, string>;

  for (const streamKey of allowedStreamKeys(profile)) {
    const suffix = streamKey.endsWith("precision") ? "PRECISION" : "WORKFLOW";
    streamIds[streamKey] = required(env, `GRAYLOG_${prefix}_${suffix}_STREAM_ID`);
  }

  return { profile, baseUrl, token, streamIds };
}

function loadProfile(argv: string[], environmentProfile: string | undefined): Profile {
  const profileArgument = argv.find((argument, index) => argv[index - 1] === "--profile");
  const profile = profileArgument ?? environmentProfile;

  if (profile === "tst" || profile === "prd") {
    return profile;
  }

  throw new Error("Set --profile to tst or prd, or set GRAYLOG_PROFILE.");
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new Error("GRAYLOG_*_BASE_URL must be a valid http(s) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GRAYLOG_*_BASE_URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("GRAYLOG_*_BASE_URL must not include credentials, query parameters, or fragments.");
  }
  return url;
}
