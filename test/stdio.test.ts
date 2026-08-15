import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("stdio server exposes only the four read-only tools", async (context) => {
  const child = spawn(process.execPath, [resolve(projectRoot, "dist/index.js"), "--profile", "tst"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GRAYLOG_TST_BASE_URL: "http://graylog.invalid:9000",
      GRAYLOG_TST_TOKEN: "test-token",
      GRAYLOG_TST_PRECISION_STREAM_ID: "67e3ccf43ed2537593dc8b6d",
      GRAYLOG_TST_WORKFLOW_STREAM_ID: "66d81be43ed253759370e307",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  context.after(() => child.kill());
  const rpc = createRpcClient(child);

  await rpc.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "stdio-smoke-test", version: "1.0.0" },
  });
  rpc.notify("notifications/initialized", {});

  const listed = await rpc.request("tools/list", {}) as {
    tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
  };
  assert.deepEqual(
    listed.tools.map(({ name }) => name).sort(),
    ["get_system_info", "list_allowed_streams", "search_stream", "search_stream_absolute"],
  );
  assert.ok(listed.tools.every(({ annotations }) => annotations?.readOnlyHint === true));

  const called = await rpc.request("tools/call", {
    name: "list_allowed_streams",
    arguments: {},
  }) as { content: Array<{ type: string; text: string }> };
  const payload = JSON.parse(called.content[0]?.text ?? "null") as { streams: unknown[] };
  assert.equal(payload.streams.length, 2);
});

function createRpcClient(child: ReturnType<typeof spawn>) {
  let nextId = 1;
  let buffer = "";
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (message.id !== undefined) {
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) {
            waiter?.reject(new Error(message.error.message ?? "MCP request failed."));
          } else {
            waiter?.resolve(message.result);
          }
        }
      }
      newline = buffer.indexOf("\n");
    }
  });

  function send(message: unknown): void {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  return {
    request(method: string, params: unknown): Promise<unknown> {
      const id = nextId++;
      return new Promise((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectPromise(new Error(`Timed out waiting for ${method}.`));
        }, 5_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolvePromise(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            rejectPromise(error);
          },
        });
        send({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method: string, params: unknown): void {
      send({ jsonrpc: "2.0", method, params });
    },
  };
}
