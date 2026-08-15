/// <reference types="node" />
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const DEFAULT_LOG_LEVEL: LogLevel = "warn";

export type LogFields = Record<string, unknown>;

export function createLogger(environment: NodeJS.ProcessEnv = process.env): Logger {
  return new Logger(readLogLevel(environment));
}

function readLogLevel(environment: NodeJS.ProcessEnv): LogLevel {
  const value = environment.GRAYLOG_LOG_LEVEL?.trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return DEFAULT_LOG_LEVEL;
}

export class Logger {
  public constructor(
    public readonly level: LogLevel,
    private readonly writeLine: (line: string) => void = (line) => {
      process.stderr.write(`${line}\n`);
    },
  ) {}

  public debug(message: string, fields: LogFields = {}): void {
    this.write("debug", message, fields);
  }

  public info(message: string, fields: LogFields = {}): void {
    this.write("info", message, fields);
  }

  public warn(message: string, fields: LogFields = {}): void {
    this.write("warn", message, fields);
  }

  public error(message: string, fields: LogFields = {}): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    this.writeLine(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        logger: "graylog43-query-mcp",
        message,
        ...fields,
      }),
    );
  }
}
