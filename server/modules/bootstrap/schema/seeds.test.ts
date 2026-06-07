import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { applyBaseSchema } from "./base-schema.ts";
import { applyDefaultSeeds } from "./seeds.ts";

const createdDirs: string[] = [];
const createdDbs: DatabaseSync[] = [];

function createDb(): DatabaseSync {
  const dir = mkdtempSync(path.join(tmpdir(), "claw-seeds-"));
  createdDirs.push(dir);
  const db = new DatabaseSync(path.join(dir, "test.sqlite"));
  createdDbs.push(db);
  applyBaseSchema(db);
  return db;
}

afterEach(() => {
  while (createdDbs.length > 0) {
    const db = createdDbs.pop();
    db?.close();
  }
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("default seeds", () => {
  it("stores development planning defaults in English", () => {
    const db = createDb();

    applyDefaultSeeds(db);

    const rows = db
      .prepare(
        `
        SELECT name, personality
        FROM agents
        WHERE COALESCE(workflow_pack_key, 'development') = 'development'
        ORDER BY name
      `,
      )
      .all() as Array<{ name: string; personality: string | null }>;

    const personalityByName = new Map(rows.map((row) => [row.name, row.personality]));
    expect(personalityByName.get("Aria")).toBe("Meticulous senior developer");
    expect(personalityByName.get("Atlas")).toBe("Operations specialist");
    expect(personalityByName.get("DORO")).toBe("Detail-oriented junior QA analyst");
    expect(personalityByName.get("Sage")).toContain("synthesizes Six Thinking Hats outputs");
    expect(personalityByName.get("Clio")).toContain("converts hat evidence");
    expect(rows.every((row) => !/[\u3131-\uD79D]/.test(row.personality ?? ""))).toBe(true);

    const migration = db
      .prepare("SELECT value FROM settings WHERE key = 'defaultDevAgentPersonalityEnglishV1'")
      .get() as { value?: string } | undefined;
    expect(migration?.value).toBe("true");

    const planning = db
      .prepare("SELECT description, prompt FROM departments WHERE id = 'planning'")
      .get() as { description?: string | null; prompt?: string | null } | undefined;
    expect(planning?.description).toContain("Six Thinking Hats research outputs");
    expect(planning?.prompt).toContain("[Six Hats Intake]");
    expect(planning?.prompt).toContain("White Hat: facts");
    expect(planning?.prompt).toContain("development-ready plan");

    const planningMigration = db
      .prepare("SELECT value FROM settings WHERE key = 'developmentPlanningSixHatsIntakeV1'")
      .get() as { value?: string } | undefined;
    expect(planningMigration?.value).toBe("true");

    const companyName = db.prepare("SELECT value FROM settings WHERE key = 'companyName'").get() as
      | { value?: string }
      | undefined;
    expect(companyName?.value).toBe("Agent Coworking Space");

    const rebrandMigration = db
      .prepare("SELECT value FROM settings WHERE key = 'agentCoworkingSpaceCompanyNameV1'")
      .get() as { value?: string } | undefined;
    expect(rebrandMigration?.value).toBe("true");
  });
});
