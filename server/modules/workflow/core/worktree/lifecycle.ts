import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isSafeUntrackedPathForWorktreeSync, normalizeRepoRelativePath } from "./shared.ts";

export type WorktreeInfo = {
  worktreePath: string;
  branchName: string;
  projectPath: string;
};

type CreateWorktreeLifecycleToolsDeps = {
  appendTaskLog: (taskId: string, kind: string, message: string) => void;
  taskWorktrees: Map<string, WorktreeInfo>;
};

type WorktreeSyncSummary = {
  trackedChanged: number;
  trackedDeleted: number;
  untrackedCopied: number;
  restrictedUntracked: string[];
};

export function createWorktreeLifecycleTools(deps: CreateWorktreeLifecycleToolsDeps) {
  const { appendTaskLog, taskWorktrees } = deps;

  function isGitRepo(dir: string): boolean {
    try {
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  function ensureWorktreeBootstrapRepo(projectPath: string, taskId: string): boolean {
    if (isGitRepo(projectPath)) return true;
    const shortId = taskId.slice(0, 8);
    try {
      if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
        appendTaskLog(taskId, "system", `Git bootstrap skipped: invalid project path (${projectPath})`);
        return false;
      }
    } catch {
      appendTaskLog(taskId, "system", `Git bootstrap skipped: cannot access project path (${projectPath})`);
      return false;
    }

    try {
      appendTaskLog(
        taskId,
        "system",
        "Git repository not found. Bootstrapping local repository for worktree execution...",
      );

      try {
        execFileSync("git", ["init", "-b", "main"], { cwd: projectPath, stdio: "pipe", timeout: 10000 });
      } catch {
        execFileSync("git", ["init"], { cwd: projectPath, stdio: "pipe", timeout: 10000 });
      }

      const excludePath = path.join(projectPath, ".git", "info", "exclude");
      const baseIgnore = ["node_modules/", "dist/", ".climpire-worktrees/", ".climpire/", ".DS_Store", "*.log"];
      let existingExclude = "";
      try {
        existingExclude = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
      } catch {
        existingExclude = "";
      }
      const appendLines = baseIgnore.filter((line) => !existingExclude.includes(line));
      if (appendLines.length > 0) {
        const prefix = existingExclude && !existingExclude.endsWith("\n") ? "\n" : "";
        fs.appendFileSync(excludePath, `${prefix}${appendLines.join("\n")}\n`, "utf8");
      }

      const readConfig = (key: string): string => {
        try {
          return execFileSync("git", ["config", "--get", key], { cwd: projectPath, stdio: "pipe", timeout: 3000 })
            .toString()
            .trim();
        } catch {
          return "";
        }
      };
      if (!readConfig("user.name")) {
        execFileSync("git", ["config", "user.name", "Claw-Empire Bot"], {
          cwd: projectPath,
          stdio: "pipe",
          timeout: 3000,
        });
      }
      if (!readConfig("user.email")) {
        execFileSync("git", ["config", "user.email", "claw-empire@local"], {
          cwd: projectPath,
          stdio: "pipe",
          timeout: 3000,
        });
      }

      execFileSync("git", ["add", "-A"], { cwd: projectPath, stdio: "pipe", timeout: 20000 });
      const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd: projectPath,
        stdio: "pipe",
        timeout: 5000,
      })
        .toString()
        .trim();
      if (staged) {
        execFileSync("git", ["commit", "-m", "chore: initialize project for Claw-Empire worktrees"], {
          cwd: projectPath,
          stdio: "pipe",
          timeout: 20000,
        });
      } else {
        execFileSync("git", ["commit", "--allow-empty", "-m", "chore: initialize project for Claw-Empire worktrees"], {
          cwd: projectPath,
          stdio: "pipe",
          timeout: 10000,
        });
      }

      appendTaskLog(taskId, "system", "Git repository initialized automatically for worktree execution.");
      console.log(`[Claw-Empire] Auto-initialized git repo for task ${shortId} at ${projectPath}`);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appendTaskLog(taskId, "system", `Git bootstrap failed: ${msg}`);
      console.error(`[Claw-Empire] Failed git bootstrap for task ${shortId}: ${msg}`);
      return false;
    }
  }

  function readGitNullSeparated(projectPath: string, args: string[]): string[] {
    try {
      return execFileSync("git", args, { cwd: projectPath, stdio: "pipe", timeout: 10000 })
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function resolveInside(root: string, relativePath: string): string | null {
    const normalized = normalizeRepoRelativePath(relativePath);
    if (!normalized || normalized.startsWith("/") || normalized.includes("..")) return null;
    const rootPath = path.resolve(root);
    const resolved = path.resolve(rootPath, normalized);
    if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) return null;
    return resolved;
  }

  function removeWorktreePath(worktreePath: string, relativePath: string): boolean {
    const target = resolveInside(worktreePath, relativePath);
    if (!target || !fs.existsSync(target)) return false;
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  }

  function copyFileIntoWorktree(projectPath: string, worktreePath: string, relativePath: string): boolean {
    const source = resolveInside(projectPath, relativePath);
    const target = resolveInside(worktreePath, relativePath);
    if (!source || !target || !fs.existsSync(source)) return false;
    const stat = fs.lstatSync(source);
    if (!stat.isFile()) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    try {
      fs.chmodSync(target, stat.mode);
    } catch {
      // Best effort: preserving executable bits should not block task execution.
    }
    return true;
  }

  function syncCurrentWorkspaceChangesToWorktree(
    projectPath: string,
    worktreePath: string,
    taskId: string,
  ): WorktreeSyncSummary {
    const summary: WorktreeSyncSummary = {
      trackedChanged: 0,
      trackedDeleted: 0,
      untrackedCopied: 0,
      restrictedUntracked: [],
    };

    const changed = readGitNullSeparated(projectPath, ["diff", "--name-status", "-z", "HEAD", "--"]);
    for (let index = 0; index < changed.length; index += 1) {
      const status = changed[index] ?? "";
      if (!status) continue;

      if (status.startsWith("R") || status.startsWith("C")) {
        const oldPath = changed[index + 1] ?? "";
        const newPath = changed[index + 2] ?? "";
        index += 2;
        if (status.startsWith("R") && removeWorktreePath(worktreePath, oldPath)) summary.trackedDeleted += 1;
        if (copyFileIntoWorktree(projectPath, worktreePath, newPath)) summary.trackedChanged += 1;
        continue;
      }

      const relPath = changed[index + 1] ?? "";
      index += 1;
      if (!relPath) continue;

      if (status.startsWith("D")) {
        if (removeWorktreePath(worktreePath, relPath)) summary.trackedDeleted += 1;
        continue;
      }

      if (copyFileIntoWorktree(projectPath, worktreePath, relPath)) summary.trackedChanged += 1;
    }

    const untracked = readGitNullSeparated(projectPath, ["ls-files", "--others", "--exclude-standard", "-z", "--"]);
    for (const rawPath of untracked) {
      const relPath = normalizeRepoRelativePath(rawPath);
      if (!relPath) continue;
      if (!isSafeUntrackedPathForWorktreeSync(relPath)) {
        summary.restrictedUntracked.push(relPath);
        continue;
      }
      if (copyFileIntoWorktree(projectPath, worktreePath, relPath)) summary.untrackedCopied += 1;
    }

    if (summary.trackedChanged || summary.trackedDeleted || summary.untrackedCopied || summary.restrictedUntracked.length) {
      const blockedPreview = summary.restrictedUntracked.slice(0, 8).join(", ");
      const blockedSuffix = summary.restrictedUntracked.length > 8 ? " ..." : "";
      const blockedText = summary.restrictedUntracked.length
        ? `; blocked restricted untracked=${summary.restrictedUntracked.length} (${blockedPreview}${blockedSuffix})`
        : "";
      appendTaskLog(
        taskId,
        "system",
        `Synced current workspace changes into worktree: tracked=${summary.trackedChanged}, deleted=${summary.trackedDeleted}, untracked=${summary.untrackedCopied}${blockedText}`,
      );
    }

    return summary;
  }

  function createWorktree(projectPath: string, taskId: string, agentName: string, baseBranch?: string): string | null {
    if (!ensureWorktreeBootstrapRepo(projectPath, taskId)) return null;
    if (!isGitRepo(projectPath)) return null;

    const shortId = taskId.slice(0, 8);
    const branchName = `climpire/${shortId}`;
    const worktreeBase = path.join(projectPath, ".climpire-worktrees");
    const worktreePath = path.join(worktreeBase, shortId);

    try {
      fs.mkdirSync(worktreeBase, { recursive: true });
      execFileSync("git", ["worktree", "prune"], { cwd: projectPath, stdio: "pipe", timeout: 5000 });

      // Get current branch/HEAD as base
      let base: string;
      if (baseBranch) {
        try {
          base = execFileSync("git", ["rev-parse", baseBranch], { cwd: projectPath, stdio: "pipe", timeout: 5000 })
            .toString()
            .trim();
        } catch {
          base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectPath, stdio: "pipe", timeout: 5000 })
            .toString()
            .trim();
        }
      } else {
        base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectPath, stdio: "pipe", timeout: 5000 })
          .toString()
          .trim();
      }

      const branchCandidates = [branchName, `${branchName}-1`, `${branchName}-2`, `${branchName}-3`];
      let created = false;
      let selectedBranch = branchName;
      let selectedWorktreePath = worktreePath;
      let lastError: unknown = null;

      for (let idx = 0; idx < branchCandidates.length; idx += 1) {
        const candidateBranch = branchCandidates[idx]!;
        const candidatePath = idx === 0 ? worktreePath : path.join(worktreeBase, `${shortId}-${idx}`);
        try {
          if (fs.existsSync(candidatePath)) {
            fs.rmSync(candidatePath, { recursive: true, force: true });
          }
        } catch {
          // best effort cleanup
        }

        const branchExists = (() => {
          try {
            execFileSync("git", ["show-ref", "--verify", `refs/heads/${candidateBranch}`], {
              cwd: projectPath,
              stdio: "pipe",
              timeout: 5000,
            });
            return true;
          } catch {
            return false;
          }
        })();

        const addArgs = branchExists
          ? ["worktree", "add", candidatePath, candidateBranch]
          : ["worktree", "add", candidatePath, "-b", candidateBranch, base];

        try {
          execFileSync("git", addArgs, {
            cwd: projectPath,
            stdio: "pipe",
            timeout: 15000,
          });
          selectedBranch = candidateBranch;
          selectedWorktreePath = candidatePath;
          created = true;
          break;
        } catch (err: unknown) {
          lastError = err;
        }
      }

      if (!created) throw lastError instanceof Error ? lastError : new Error("worktree_add_failed");

      syncCurrentWorkspaceChangesToWorktree(projectPath, selectedWorktreePath, taskId);

      // Propagate .claude/skills into the worktree so agents can resolve installed skills
      try {
        const serverSkillsDir = path.join(process.cwd(), ".claude", "skills");
        if (fs.existsSync(serverSkillsDir)) {
          const wtClaudeDir = path.join(selectedWorktreePath, ".claude");
          const wtSkillsLink = path.join(wtClaudeDir, "skills");
          if (!fs.existsSync(wtSkillsLink)) {
            fs.mkdirSync(wtClaudeDir, { recursive: true });
            fs.symlinkSync(serverSkillsDir, wtSkillsLink, "junction");
          }
        }
      } catch {
        // best effort — skill propagation failure should not block execution
      }

      taskWorktrees.set(taskId, { worktreePath: selectedWorktreePath, branchName: selectedBranch, projectPath });
      console.log(
        `[Claw-Empire] Created worktree for task ${shortId}: ${selectedWorktreePath} (branch: ${selectedBranch}, agent: ${agentName})`,
      );
      return selectedWorktreePath;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Claw-Empire] Failed to create worktree for task ${shortId}: ${msg}`);
      return null;
    }
  }

  function cleanupWorktree(projectPath: string, taskId: string): void {
    const info = taskWorktrees.get(taskId);
    if (!info) return;

    const shortId = taskId.slice(0, 8);

    try {
      execFileSync("git", ["worktree", "remove", info.worktreePath, "--force"], {
        cwd: projectPath,
        stdio: "pipe",
        timeout: 10000,
      });
    } catch {
      console.warn(`[Claw-Empire] git worktree remove failed for ${shortId}, falling back to manual cleanup`);
      try {
        if (fs.existsSync(info.worktreePath)) {
          fs.rmSync(info.worktreePath, { recursive: true, force: true });
        }
        execFileSync("git", ["worktree", "prune"], { cwd: projectPath, stdio: "pipe", timeout: 5000 });
      } catch {
        /* ignore */
      }
    }

    try {
      execFileSync("git", ["branch", "-D", info.branchName], {
        cwd: projectPath,
        stdio: "pipe",
        timeout: 5000,
      });
    } catch {
      console.warn(`[Claw-Empire] Failed to delete branch ${info.branchName} — may need manual cleanup`);
    }

    taskWorktrees.delete(taskId);
    console.log(`[Claw-Empire] Cleaned up worktree for task ${shortId}`);
  }

  return {
    isGitRepo,
    createWorktree,
    cleanupWorktree,
  };
}
