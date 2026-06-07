import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createWorktreeLifecycleTools } from "./lifecycle.ts";

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", timeout: 15000 }).toString().trim();
}

function initRepo(basePrefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), basePrefix));
  try {
    runGit(dir, ["init", "-b", "main"]);
  } catch {
    runGit(dir, ["init"]);
    runGit(dir, ["checkout", "-B", "main"]);
  }
  runGit(dir, ["config", "user.name", "Claw-Empire Test"]);
  runGit(dir, ["config", "user.email", "claw-empire-test@example.local"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n", "utf8");
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-m", "seed"]);
  return dir;
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("worktree lifecycle branch collision handling", () => {
  it("reuses existing task branch when branch already exists", () => {
    const repo = initRepo("climpire-wt-reuse-");
    tempDirs.push(repo);
    const shortId = "reuse001";
    const taskId = `${shortId}-0000-0000-0000-000000000000`;
    runGit(repo, ["branch", `climpire/${shortId}`]);

    const taskWorktrees = new Map();
    const tools = createWorktreeLifecycleTools({
      appendTaskLog: () => {},
      taskWorktrees,
    });

    const worktreePath = tools.createWorktree(repo, taskId, "Tester");
    expect(worktreePath).toBeTruthy();
    const info = taskWorktrees.get(taskId);
    expect(info?.branchName).toBe(`climpire/${shortId}`);
    expect(fs.existsSync(String(info?.worktreePath || ""))).toBe(true);

    tools.cleanupWorktree(repo, taskId);
    expect(taskWorktrees.has(taskId)).toBe(false);
  });

  it("falls back to suffixed branch when existing branch is occupied in another worktree", () => {
    const repo = initRepo("climpire-wt-fallback-");
    tempDirs.push(repo);
    const shortId = "fallback";
    const baseBranch = `climpire/${shortId}`;
    const occupiedPath = path.join(repo, ".occupied-worktree");
    runGit(repo, ["worktree", "add", occupiedPath, "-b", baseBranch, "HEAD"]);

    const taskId = `${shortId}-0000-0000-0000-000000000000`;
    const taskWorktrees = new Map();
    const tools = createWorktreeLifecycleTools({
      appendTaskLog: () => {},
      taskWorktrees,
    });

    const worktreePath = tools.createWorktree(repo, taskId, "Tester");
    expect(worktreePath).toBeTruthy();
    const info = taskWorktrees.get(taskId);
    expect(info?.branchName.startsWith(baseBranch)).toBe(true);
    expect(info?.branchName).not.toBe(baseBranch);

    tools.cleanupWorktree(repo, taskId);
    runGit(repo, ["worktree", "remove", occupiedPath, "--force"]);
    runGit(repo, ["branch", "-D", baseBranch]);
  });

  it("copies current tracked and safe untracked workspace changes into a new worktree", () => {
    const repo = initRepo("climpire-wt-sync-");
    tempDirs.push(repo);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "kept.ts"), "export const kept = 'before';\n", "utf8");
    fs.writeFileSync(path.join(repo, "src", "deleted.ts"), "export const deleted = true;\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "add source"]);

    fs.writeFileSync(path.join(repo, "src", "kept.ts"), "export const kept = 'after';\n", "utf8");
    fs.rmSync(path.join(repo, "src", "deleted.ts"));
    fs.writeFileSync(path.join(repo, "src", "new-helper.ts"), "export const helper = true;\n", "utf8");
    fs.writeFileSync(path.join(repo, "private.pem"), "SECRET=do-not-copy\n", "utf8");

    const taskId = "sync0001-0000-0000-0000-000000000000";
    const taskWorktrees = new Map();
    const logs: string[] = [];
    const tools = createWorktreeLifecycleTools({
      appendTaskLog: (_taskId, _kind, message) => logs.push(message),
      taskWorktrees,
    });

    const worktreePath = tools.createWorktree(repo, taskId, "Tester");
    expect(worktreePath).toBeTruthy();
    const worktreeDir = String(worktreePath);

    expect(fs.readFileSync(path.join(worktreeDir, "src", "kept.ts"), "utf8")).toContain("'after'");
    expect(fs.existsSync(path.join(worktreeDir, "src", "deleted.ts"))).toBe(false);
    expect(fs.existsSync(path.join(worktreeDir, "src", "new-helper.ts"))).toBe(true);
    expect(fs.existsSync(path.join(worktreeDir, "private.pem"))).toBe(false);
    expect(logs.some((line) => line.includes("Synced current workspace changes into worktree"))).toBe(true);
    expect(logs.some((line) => line.includes("blocked restricted untracked="))).toBe(true);

    tools.cleanupWorktree(repo, taskId);
  });
});
