import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

type DbLike = {
  prepare: (sql: string) => {
    run?: (...args: any[]) => unknown;
  };
};

type CreateHermesAgentToolsDeps = {
  db: DbLike;
  logsDir: string;
  activeProcesses: Map<string, ChildProcess>;
  broadcast: (event: string, payload: unknown) => void;
  normalizeStreamChunk: (raw: Buffer | string, opts?: { dropCliNoise?: boolean }) => string;
  handleTaskRunComplete: (taskId: string, exitCode: number) => void;
  createSafeLogStreamOps: (logStream: any) => {
    safeWrite: (text: string) => boolean;
    safeEnd: (onDone?: () => void) => void;
  };
  parseHttpAgentSubtasks?: (taskId: string, textChunk: string, accum: { buf: string }) => void;
};

type HermesRunEvent = {
  event?: string;
  run_id?: string;
  timestamp?: number;
  delta?: string;
  text?: string;
  output?: string;
  error?: string | boolean;
  tool?: string;
  preview?: string;
  duration?: number;
  usage?: unknown;
  choices?: string[];
};

type HermesConfig = {
  baseUrl: string;
  apiKey: string;
  model: string | null;
  remoteProjectPath: string | null;
  approvalChoice: "once" | "session" | "always" | "deny" | null;
};

type HermesExecutionResult = {
  runId: string;
  exitCode: number;
};

const VALID_APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);

function readEnv(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function normalizeHermesBaseUrl(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, "");
}

function resolveHermesConfig(modelOverride?: string | null): HermesConfig {
  const rawBaseUrl = readEnv("HERMES_API_BASE_URL") || readEnv("HERMES_BASE_URL");
  if (!rawBaseUrl) {
    throw new Error("Hermes API base URL is not configured. Set HERMES_API_BASE_URL.");
  }

  const apiKey = readEnv("HERMES_API_KEY") || readEnv("API_SERVER_KEY");
  if (!apiKey) {
    throw new Error("Hermes API key is not configured. Set HERMES_API_KEY.");
  }

  const rawApprovalChoice = (readEnv("HERMES_AUTO_APPROVAL") || readEnv("HERMES_AUTO_APPROVE")).toLowerCase();
  const approvalChoice = VALID_APPROVAL_CHOICES.has(rawApprovalChoice)
    ? (rawApprovalChoice as HermesConfig["approvalChoice"])
    : null;

  return {
    baseUrl: normalizeHermesBaseUrl(rawBaseUrl),
    apiKey,
    model: modelOverride || readEnv("HERMES_API_MODEL") || null,
    remoteProjectPath: readEnv("HERMES_REMOTE_PROJECT_PATH") || readEnv("HERMES_REMOTE_CWD") || null,
    approvalChoice,
  };
}

function buildHermesHeaders(config: HermesConfig, taskId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (taskId) {
    headers["X-Hermes-Session-Key"] = `agent-coworking-space:${taskId}`;
  }
  return headers;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 800 ? `${text.slice(0, 800)}...` : text;
  } catch {
    return "";
  }
}

function remoteStatusForEvent(eventName: string): string | null {
  if (eventName === "run.completed") return "completed";
  if (eventName === "run.failed") return "failed";
  if (eventName === "run.cancelled") return "cancelled";
  if (eventName === "approval.request") return "waiting_for_approval";
  if (eventName === "run.stopping") return "stopping";
  if (eventName === "message.delta" || eventName.startsWith("tool.") || eventName === "reasoning.available") {
    return "running";
  }
  return null;
}

export function createHermesAgentTools(deps: CreateHermesAgentToolsDeps) {
  const {
    db,
    logsDir,
    activeProcesses,
    broadcast,
    normalizeStreamChunk,
    handleTaskRunComplete,
    createSafeLogStreamOps,
    parseHttpAgentSubtasks,
  } = deps;

  function rememberHermesRun(taskId: string | undefined, fields: Record<string, unknown>): void {
    if (!taskId) return;
    try {
      const now = Date.now();
      db.prepare(
        `
        INSERT INTO task_remote_runs (
          task_id, provider, remote_run_id, status, base_url, last_event, error, created_at, updated_at
        ) VALUES (?, 'hermes', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, provider) DO UPDATE SET
          remote_run_id = COALESCE(excluded.remote_run_id, task_remote_runs.remote_run_id),
          status = COALESCE(excluded.status, task_remote_runs.status),
          base_url = COALESCE(excluded.base_url, task_remote_runs.base_url),
          last_event = COALESCE(excluded.last_event, task_remote_runs.last_event),
          error = COALESCE(excluded.error, task_remote_runs.error),
          updated_at = excluded.updated_at
      `,
      ).run?.(
        taskId,
        fields.remoteRunId ?? null,
        fields.status ?? null,
        fields.baseUrl ?? null,
        fields.lastEvent ?? null,
        fields.error ?? null,
        now,
        now,
      );
    } catch {
      /* task_remote_runs is best-effort for tests and legacy databases */
    }
  }

  function writeCliOutput(taskId: string | undefined, stream: "stdout" | "stderr", text: string): void {
    const normalized = normalizeStreamChunk(text, { dropCliNoise: false });
    if (!normalized) return;
    if (taskId) {
      broadcast("cli_output", { task_id: taskId, stream, data: normalized });
    }
  }

  async function sendApprovalChoice(
    config: HermesConfig,
    runId: string,
    taskId: string | undefined,
    safeWrite: (text: string) => boolean,
  ): Promise<void> {
    if (!config.approvalChoice) {
      const msg =
        "[hermes] Approval requested. Set HERMES_AUTO_APPROVAL=once|session|always|deny or approve it in Hermes.\n";
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
      return;
    }

    const msg = `[hermes] Approval requested; replying with '${config.approvalChoice}'.\n`;
    safeWrite(msg);
    writeCliOutput(taskId, "stderr", msg);

    const response = await fetch(`${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      headers: buildHermesHeaders(config, taskId),
      body: JSON.stringify({ choice: config.approvalChoice }),
    });

    if (!response.ok) {
      const text = await readErrorBody(response);
      throw new Error(`Hermes approval failed (${response.status})${text ? `: ${text}` : ""}`);
    }
  }

  function handleHermesEvent(
    event: HermesRunEvent,
    state: { sawContent: boolean; exitCode: number | null; subtaskAccum: { buf: string } },
    taskId: string | undefined,
    safeWrite: (text: string) => boolean,
  ): void {
    const eventName = String(event.event ?? "").trim();
    if (!eventName) return;

    const remoteStatus = remoteStatusForEvent(eventName);
    if (remoteStatus) {
      rememberHermesRun(taskId, {
        remoteRunId: event.run_id,
        status: remoteStatus,
        lastEvent: eventName,
        error: typeof event.error === "string" ? event.error : null,
      });
    }

    if (eventName === "message.delta") {
      const text = normalizeStreamChunk(String(event.delta ?? ""), { dropCliNoise: false });
      if (!text) return;
      state.sawContent = true;
      safeWrite(text);
      writeCliOutput(taskId, "stdout", text);
      if (taskId && parseHttpAgentSubtasks) {
        parseHttpAgentSubtasks(taskId, text, state.subtaskAccum);
      }
      return;
    }

    if (eventName === "reasoning.available") {
      const text = normalizeStreamChunk(String(event.text ?? ""), { dropCliNoise: false });
      if (!text) return;
      const msg = `[hermes:reasoning] ${text}\n`;
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
      return;
    }

    if (eventName === "tool.started") {
      const tool = event.tool ? String(event.tool) : "tool";
      const preview = event.preview ? ` ${String(event.preview)}` : "";
      const msg = `[hermes] ${tool} started${preview}\n`;
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
      return;
    }

    if (eventName === "tool.completed") {
      const tool = event.tool ? String(event.tool) : "tool";
      const duration = typeof event.duration === "number" ? ` (${event.duration}s)` : "";
      const suffix = event.error ? " with error" : "";
      const msg = `[hermes] ${tool} completed${duration}${suffix}\n`;
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
      return;
    }

    if (eventName === "approval.request") {
      const choices = Array.isArray(event.choices) && event.choices.length > 0 ? ` choices=${event.choices.join(",")}` : "";
      const msg = `[hermes] approval requested${choices}\n`;
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
      return;
    }

    if (eventName === "run.completed") {
      state.exitCode = 0;
      const output = normalizeStreamChunk(String(event.output ?? ""), { dropCliNoise: false });
      if (output && !state.sawContent) {
        safeWrite(output);
        writeCliOutput(taskId, "stdout", output);
      }
      const msg = "\n---\n[hermes] Done.\n";
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
      return;
    }

    if (eventName === "run.failed") {
      state.exitCode = 1;
      const msg = `[hermes] Failed: ${String(event.error || "agent run failed")}\n`;
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
      return;
    }

    if (eventName === "run.cancelled") {
      state.exitCode = 1;
      const msg = "[hermes] Cancelled.\n";
      safeWrite(msg);
      writeCliOutput(taskId, "stderr", msg);
    }
  }

  async function parseHermesSSEStream(
    body: ReadableStream<Uint8Array>,
    config: HermesConfig,
    runId: string,
    signal: AbortSignal,
    taskId: string | undefined,
    safeWrite: (text: string) => boolean,
  ): Promise<number> {
    const decoder = new TextDecoder();
    const state = { sawContent: false, exitCode: null as number | null, subtaskAccum: { buf: "" } };
    let buffer = "";

    const processLine = async (trimmed: string) => {
      if (!trimmed || trimmed.startsWith(":")) return;
      if (!trimmed.startsWith("data:")) return;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === "[DONE]") return;
      let event: HermesRunEvent;
      try {
        event = JSON.parse(raw) as HermesRunEvent;
      } catch {
        return;
      }
      handleHermesEvent(event, state, taskId, safeWrite);
      if (event.event === "approval.request") {
        await sendApprovalChoice(config, runId, taskId, safeWrite);
      }
    };

    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (signal.aborted) break;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await processLine(line.trim());
      }
    }
    if (buffer.trim()) {
      await processLine(buffer.trim());
    }

    return state.exitCode ?? (signal.aborted ? 1 : 0);
  }

  async function executeHermesAgent(
    prompt: string,
    projectPath: string,
    logStream: fs.WriteStream,
    signal: AbortSignal,
    taskId?: string,
    modelOverride?: string | null,
    safeWriteOverride?: (text: string) => boolean,
    onRunStarted?: (runId: string) => void,
  ): Promise<HermesExecutionResult> {
    const safeWrite = safeWriteOverride ?? createSafeLogStreamOps(logStream).safeWrite;
    const config = resolveHermesConfig(modelOverride);
    const effectiveProjectPath = config.remoteProjectPath || projectPath;
    const modelInfo = config.model ? `, Model: ${config.model}` : "";
    const header = `[hermes] Base: ${config.baseUrl}${modelInfo}\n[hermes] Project path: ${effectiveProjectPath}\n---\n`;
    safeWrite(header);
    writeCliOutput(taskId, "stderr", header);

    const requestBody: Record<string, unknown> = {
      input: prompt,
      session_id: taskId ? `agent-coworking-space-${taskId}` : undefined,
      instructions: [
        "You are executing an Agent Coworking Space task through Hermes Agent.",
        `Project path: ${effectiveProjectPath}`,
        config.remoteProjectPath
          ? `Remote project path is configured explicitly. Use it as the working directory.`
          : "If this path is not available in the Hermes terminal environment, fail loudly and explain the required remote workspace mapping.",
      ].join("\n"),
    };
    if (config.model) requestBody.model = config.model;

    const response = await fetch(`${config.baseUrl}/v1/runs`, {
      method: "POST",
      headers: buildHermesHeaders(config, taskId),
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const text = await readErrorBody(response);
      throw new Error(`Hermes run start failed (${response.status})${text ? `: ${text}` : ""}`);
    }

    const payload = (await response.json()) as { run_id?: unknown; status?: unknown };
    const runId = String(payload.run_id ?? "").trim();
    if (!runId) {
      throw new Error("Hermes run start response did not include run_id.");
    }

    rememberHermesRun(taskId, {
      remoteRunId: runId,
      status: String(payload.status ?? "started"),
      baseUrl: config.baseUrl,
      lastEvent: "run.started",
    });
    onRunStarted?.(runId);
    const accepted = `[hermes] Run accepted: ${runId}\n`;
    safeWrite(accepted);
    writeCliOutput(taskId, "stderr", accepted);

    const eventsResponse = await fetch(`${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
      method: "GET",
      headers: {
        ...buildHermesHeaders(config, taskId),
        Accept: "text/event-stream",
      },
      signal,
    });

    if (!eventsResponse.ok || !eventsResponse.body) {
      const text = await readErrorBody(eventsResponse);
      throw new Error(`Hermes event stream failed (${eventsResponse.status})${text ? `: ${text}` : ""}`);
    }

    const exitCode = await parseHermesSSEStream(eventsResponse.body, config, runId, signal, taskId, safeWrite);
    return { runId, exitCode };
  }

  function launchHermesAgent(
    taskId: string,
    prompt: string,
    projectPath: string,
    logPath: string,
    controller: AbortController,
    fakePid: number,
    modelOverride?: string | null,
    onComplete?: (exitCode: number) => void,
  ): void {
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    const { safeWrite, safeEnd } = createSafeLogStreamOps(logStream);
    safeWrite(`\n===== task run start ${new Date().toISOString()} | provider=hermes =====\n`);

    const promptPath = path.join(logsDir, `${taskId}.prompt.txt`);
    fs.writeFileSync(promptPath, prompt, "utf8");

    let remoteRunId: string | null = null;
    const mockProc = {
      pid: fakePid,
      kill: () => {
        controller.abort();
        try {
          const config = resolveHermesConfig(modelOverride);
          if (remoteRunId) {
            void fetch(`${config.baseUrl}/v1/runs/${encodeURIComponent(remoteRunId)}/stop`, {
              method: "POST",
              headers: buildHermesHeaders(config, taskId),
            }).catch(() => {});
          }
        } catch {
          /* config errors are reported by the running task */
        }
        return true;
      },
    } as unknown as ChildProcess;
    activeProcesses.set(taskId, mockProc);

    const runTask = (async () => {
      let exitCode = 0;
      try {
        const result = await executeHermesAgent(
          prompt,
          projectPath,
          logStream,
          controller.signal,
          taskId,
          modelOverride,
          safeWrite,
          (runId) => {
            remoteRunId = runId;
          },
        );
        exitCode = result.exitCode;
      } catch (err: any) {
        exitCode = 1;
        if (err.name !== "AbortError") {
          const msg = normalizeStreamChunk(`[hermes] Error: ${err.message}\n`, { dropCliNoise: false });
          safeWrite(msg);
          writeCliOutput(taskId, "stderr", msg);
          rememberHermesRun(taskId, {
            remoteRunId,
            status: "failed",
            lastEvent: "adapter.error",
            error: err.message,
          });
          console.error(`[Claw-Empire] Hermes agent error (task ${taskId}): ${err.message}`);
        } else {
          const msg = normalizeStreamChunk("[hermes] Aborted by user\n", { dropCliNoise: false });
          safeWrite(msg);
          writeCliOutput(taskId, "stderr", msg);
          rememberHermesRun(taskId, { remoteRunId, status: "cancelled", lastEvent: "adapter.abort" });
        }
      } finally {
        await new Promise<void>((resolve) => safeEnd(resolve));
        try {
          fs.unlinkSync(promptPath);
        } catch {
          /* ignore */
        }
        if (onComplete) {
          onComplete(exitCode);
        } else {
          handleTaskRunComplete(taskId, exitCode);
        }
      }
    })();

    runTask.catch(() => {});
  }

  return {
    executeHermesAgent,
    launchHermesAgent,
  };
}
