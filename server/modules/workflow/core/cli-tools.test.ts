import { describe, expect, it } from "vitest";
import { createCliTools } from "./cli-tools.ts";

function createTools() {
  return createCliTools({
    nowMs: () => 0,
    cliOutputDedupWindowMs: 1000,
  });
}

describe("buildAgentArgs", () => {
  it("claude noTools mode uses --tools= without empty argv", () => {
    const tools = createTools();
    const args = tools.buildAgentArgs("claude", "claude-opus-4-6", undefined, { noTools: true });

    expect(args).toContain("--tools=");
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("");
  });
});

describe("sanitizeCliChildEnv", () => {
  it("strips Claw runtime env before spawning project agents", () => {
    const tools = createTools();
    const env = tools.sanitizeCliChildEnv({
      API_AUTH_TOKEN: "server-token",
      HOST: "127.0.0.1",
      INBOX_WEBHOOK_SECRET: "inbox-secret",
      PATH: "C:\\Tools",
      PORT: "8790",
      VITE_DEV: "1",
      USERPROFILE: "C:\\Users\\king",
    });

    expect(env).toMatchObject({
      PATH: "C:\\Tools",
      USERPROFILE: "C:\\Users\\king",
    });
    expect(env).not.toHaveProperty("API_AUTH_TOKEN");
    expect(env).not.toHaveProperty("HOST");
    expect(env).not.toHaveProperty("INBOX_WEBHOOK_SECRET");
    expect(env).not.toHaveProperty("PORT");
    expect(env).not.toHaveProperty("VITE_DEV");
  });
});
