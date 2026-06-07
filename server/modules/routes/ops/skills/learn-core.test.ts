import { describe, expect, it, vi } from "vitest";
import { createSkillLearnCore } from "./learn-core.ts";

function createCore(execWithTimeout: ReturnType<typeof vi.fn>) {
  return createSkillLearnCore({
    db: {} as never,
    execWithTimeout,
  } as never);
}

describe("skill unlearn core", () => {
  it("skips remove when the target CLI agent is already not linked", async () => {
    const execWithTimeout = vi.fn().mockResolvedValue(`
Project Skills

vercel-react-best-practices .\\.agents\\skills\\vercel-react-best-practices Agents: not linked
`);
    const core = createCore(execWithTimeout);

    const result = await core.runSkillUnlearnForProvider(
      "claude",
      "vercel-labs/agent-skills",
      "vercel-react-best-practices",
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toBe("skill_already_unlinked");
    expect(result.agent).toBe("claude-code");
    expect(execWithTimeout).toHaveBeenCalledTimes(1);
    expect(execWithTimeout.mock.calls[0][1]).toEqual(["--yes", "skills@latest", "list", "--agent", "claude-code"]);
  });

  it("removes and verifies the exact skill candidate for a linked CLI agent", async () => {
    const linkedList = `
Project Skills

vercel-react-best-practices .\\.agents\\skills\\vercel-react-best-practices Agents: Codex
`;
    const unlinkedList = `
Project Skills

vercel-react-best-practices .\\.agents\\skills\\vercel-react-best-practices Agents: not linked
`;
    const execWithTimeout = vi
      .fn()
      .mockResolvedValueOnce(linkedList)
      .mockResolvedValueOnce("Successfully removed 1 skill(s)")
      .mockResolvedValueOnce(unlinkedList);
    const core = createCore(execWithTimeout);

    const result = await core.runSkillUnlearnForProvider(
      "codex",
      "vercel-labs/agent-skills",
      "vercel-react-best-practices",
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.removedSkill).toBe("vercel-react-best-practices");
    expect(execWithTimeout.mock.calls[1][1]).toEqual([
      "--yes",
      "skills@latest",
      "remove",
      "--yes",
      "--agent",
      "codex",
      "--skill",
      "vercel-react-best-practices",
    ]);
  });

  it("fails loudly when CLI remove reports success but the skill remains linked", async () => {
    const linkedList = `
Project Skills

vercel-react-best-practices .\\.agents\\skills\\vercel-react-best-practices Agents: Codex
`;
    const execWithTimeout = vi
      .fn()
      .mockResolvedValueOnce(linkedList)
      .mockResolvedValueOnce("Successfully removed 1 skill(s)")
      .mockResolvedValueOnce(linkedList);
    const core = createCore(execWithTimeout);

    const result = await core.runSkillUnlearnForProvider(
      "codex",
      "vercel-labs/agent-skills",
      "vercel-react-best-practices",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe("cli_unlearn_verify_failed_fs_still_linked");
  });
});
