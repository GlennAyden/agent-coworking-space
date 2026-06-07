import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHermesAgentTools } from "./hermes-agent-tools.ts";

const HERMES_ENV_KEYS = [
  "HERMES_API_BASE_URL",
  "HERMES_BASE_URL",
  "HERMES_API_KEY",
  "API_SERVER_KEY",
  "HERMES_API_MODEL",
  "HERMES_REMOTE_PROJECT_PATH",
  "HERMES_REMOTE_CWD",
  "HERMES_AUTO_APPROVAL",
  "HERMES_AUTO_APPROVE",
];

function sseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function createTestTools() {
  const dbRuns: unknown[][] = [];
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  const tools = createHermesAgentTools({
    db: {
      prepare: () => ({
        run: (...args: unknown[]) => {
          dbRuns.push(args);
        },
      }),
    },
    logsDir: ".",
    activeProcesses: new Map(),
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    normalizeStreamChunk: (raw) => String(raw ?? ""),
    handleTaskRunComplete: () => undefined,
    createSafeLogStreamOps: () => ({
      safeWrite: () => true,
      safeEnd: (onDone?: () => void) => onDone?.(),
    }),
  });
  return { tools, dbRuns, broadcasts };
}

describe("createHermesAgentTools", () => {
  beforeEach(() => {
    for (const key of HERMES_ENV_KEYS) delete process.env[key];
    process.env.HERMES_API_BASE_URL = "https://hermes.example.test/";
    process.env.HERMES_API_KEY = "test-hermes-key";
    process.env.HERMES_REMOTE_PROJECT_PATH = "/srv/agent-coworking-space/workspaces/project";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of HERMES_ENV_KEYS) delete process.env[key];
  });

  it("starts a Hermes run, streams events, and reports completion", async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        if (String(url).endsWith("/v1/runs")) {
          return new Response(JSON.stringify({ run_id: "run-123", status: "queued" }), { status: 202 });
        }
        if (String(url).endsWith("/v1/runs/run-123/events")) {
          return sseResponse([
            { event: "message.delta", run_id: "run-123", delta: "hello " },
            { event: "message.delta", run_id: "run-123", delta: "world" },
            { event: "run.completed", run_id: "run-123" },
          ]);
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { tools, dbRuns, broadcasts } = createTestTools();
    let log = "";
    const result = await tools.executeHermesAgent(
      "do the task",
      "C:\\local\\project",
      {} as any,
      new AbortController().signal,
      "task-1",
      "gpt-test",
      (text) => {
        log += text;
        return true;
      },
    );

    expect(result).toEqual({ runId: "run-123", exitCode: 0 });
    expect(log).toContain("[hermes] Base: https://hermes.example.test, Model: gpt-test");
    expect(log).toContain("[hermes] Project path: /srv/agent-coworking-space/workspaces/project");
    expect(log).toContain("hello world");
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].init?.headers).toMatchObject({
      Authorization: "Bearer test-hermes-key",
      "X-Hermes-Session-Key": "agent-coworking-space:task-1",
    });
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toMatchObject({
      input: "do the task",
      session_id: "agent-coworking-space-task-1",
      model: "gpt-test",
    });
    expect(dbRuns.some((args) => args.includes("completed"))).toBe(true);
    expect(
      broadcasts.some((entry) => entry.event === "cli_output" && JSON.stringify(entry.payload).includes("hello ")),
    ).toBe(true);
  });

  it("maps failed Hermes events to a non-zero exit code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/v1/runs")) {
          return new Response(JSON.stringify({ run_id: "run-fail", status: "queued" }), { status: 202 });
        }
        if (String(url).endsWith("/v1/runs/run-fail/events")) {
          return sseResponse([{ event: "run.failed", run_id: "run-fail", error: "remote workspace missing" }]);
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { tools } = createTestTools();
    let log = "";
    const result = await tools.executeHermesAgent(
      "do the task",
      "C:\\local\\project",
      {} as any,
      new AbortController().signal,
      "task-2",
      null,
      (text) => {
        log += text;
        return true;
      },
    );

    expect(result).toEqual({ runId: "run-fail", exitCode: 1 });
    expect(log).toContain("[hermes] Failed: remote workspace missing");
  });
});
