#!/usr/bin/env node
/* global console, process */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function normalizePath(raw, fallback) {
  const value = String(raw ?? "").trim().replace(/^['"]|['"]$/g, "");
  return path.resolve(value || fallback);
}

function parseRetentionDays(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 14;
  return Math.max(1, Math.min(365, Math.trunc(parsed)));
}

function timestampLabel(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

function checkpointSqlite(dbPath) {
  if (!fs.existsSync(dbPath)) return false;
  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return true;
  } catch (err) {
    console.warn(`[backup] SQLite checkpoint skipped: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
  }
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyLogs(logsDir, destDir) {
  if (!fs.existsSync(logsDir)) return 0;
  const stats = fs.statSync(logsDir);
  if (!stats.isDirectory()) return 0;
  fs.cpSync(logsDir, destDir, { recursive: true, force: true });
  let count = 0;
  const stack = [destDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function pruneOldBackups(backupRoot, retentionDays, now = Date.now()) {
  if (!fs.existsSync(backupRoot)) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
    const full = path.join(backupRoot, entry.name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs >= cutoff) continue;
    fs.rmSync(full, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

const dbPath = normalizePath(process.env.DB_PATH, "agent-coworking-space.sqlite");
const logsDir = normalizePath(process.env.LOGS_DIR, "logs");
const backupRoot = normalizePath(process.env.BACKUP_DIR, "backups");
const retentionDays = parseRetentionDays(process.env.BACKUP_RETENTION_DAYS);
const label = timestampLabel();
const targetDir = path.join(backupRoot, `backup-${label}`);
const dbTargetDir = path.join(targetDir, "db");
const logsTargetDir = path.join(targetDir, "logs");

fs.mkdirSync(targetDir, { recursive: true });
const checkpointed = checkpointSqlite(dbPath);
const copiedDb = copyIfExists(dbPath, path.join(dbTargetDir, path.basename(dbPath)));
const copiedWal = copyIfExists(`${dbPath}-wal`, path.join(dbTargetDir, `${path.basename(dbPath)}-wal`));
const copiedShm = copyIfExists(`${dbPath}-shm`, path.join(dbTargetDir, `${path.basename(dbPath)}-shm`));
const copiedLogs = copyLogs(logsDir, logsTargetDir);
const removed = pruneOldBackups(backupRoot, retentionDays);

const manifest = {
  ok: copiedDb,
  generated_at: new Date().toISOString(),
  backup_dir: targetDir,
  db_path: dbPath,
  logs_dir: logsDir,
  checkpointed,
  copied: {
    db: copiedDb,
    wal: copiedWal,
    shm: copiedShm,
    logs: copiedLogs,
  },
  retention_days: retentionDays,
  pruned: removed,
};

fs.writeFileSync(path.join(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

if (!copiedDb) {
  console.error(`[backup] database not found: ${dbPath}`);
  process.exitCode = 2;
} else {
  console.log(`[backup] created ${targetDir}`);
  console.log(`[backup] copied logs=${copiedLogs}, pruned=${removed.length}`);
}
