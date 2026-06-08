import { describe, expect, it } from "vitest";
import {
  buildApprovalWorkflowMeta,
  clearApprovalRequiredWorkflowMeta,
  detectRiskyTaskReasons,
  isApprovalConfirmed,
} from "./approval-gate.ts";

describe("approval gate", () => {
  it("requires approval for production, migration, publish, delete, and secret changes", () => {
    const reasons = detectRiskyTaskReasons({
      title: "Deploy production database migration",
      description: "Run git push, restart nginx, rotate API token, then delete stale files.",
    });

    expect(reasons).toEqual([
      "Production or deployment operation",
      "Database or schema migration",
      "Remote publish or repository state change",
      "Destructive delete/remove operation",
      "Security-sensitive configuration",
    ]);
  });

  it("does not require approval for read-only analysis tasks", () => {
    expect(
      detectRiskyTaskReasons({
        title: "Review report evidence",
        description: "Read files and summarize findings without modifying anything.",
      }),
    ).toEqual([]);
  });

  it("accepts explicit confirmation only", () => {
    expect(isApprovalConfirmed({ approval_confirmed: true })).toBe(true);
    expect(isApprovalConfirmed({ approval: "confirmed" })).toBe(true);
    expect(isApprovalConfirmed({ approval_confirmed: "true" })).toBe(false);
    expect(isApprovalConfirmed(undefined)).toBe(false);
  });

  it("marks and clears workflow metadata for pending approval", () => {
    const marked = buildApprovalWorkflowMeta('{"pack":"dev"}', ["Production or deployment operation"]);
    expect(JSON.parse(marked)).toMatchObject({
      pack: "dev",
      approval_required: true,
      risk_approval: {
        required: true,
        reasons: ["Production or deployment operation"],
      },
    });

    expect(clearApprovalRequiredWorkflowMeta(marked)).toBe('{"pack":"dev"}');
  });
});
