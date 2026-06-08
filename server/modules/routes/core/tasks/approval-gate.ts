export type RiskApprovalSubject = {
  title?: string | null;
  description?: string | null;
  workflowMetaJson?: string | null;
  taskType?: string | null;
};

export type ApprovalRequestBody = {
  approval_confirmed?: unknown;
  approval?: unknown;
};

export function detectRiskyTaskReasons(subject: RiskApprovalSubject): string[] {
  const text = [
    subject.title,
    subject.description,
    subject.workflowMetaJson,
    subject.taskType,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
    .toLowerCase();

  if (!text) return [];

  const checks: Array<{ reason: string; pattern: RegExp }> = [
    {
      reason: "Production or deployment operation",
      pattern:
        /\b(deploy|deployment|production|prod|vps|restart|systemctl|pm2|nginx|cloudflare|tunnel|docker\s+compose|docker-compose)\b/i,
    },
    {
      reason: "Database or schema migration",
      pattern: /\b(migrate|migration|schema|database|sqlite|postgres|sql|drop\s+table|truncate\s+table)\b/i,
    },
    {
      reason: "Remote publish or repository state change",
      pattern: /\b(git\s+push|force\s+push|publish|release|gh\s+release|tag\s+-a|npm\s+publish)\b/i,
    },
    {
      reason: "Destructive delete/remove operation",
      pattern: /\b(delete|remove|erase|destroy|rm\s+-rf|del\s+\/s|rmdir|truncate|drop)\b/i,
    },
    {
      reason: "Security-sensitive configuration",
      pattern: /\b(secret|token|credential|password|firewall|ssl|tls|auth|oauth|api[_-]?key)\b/i,
    },
  ];

  const reasons = new Set<string>();
  for (const check of checks) {
    if (check.pattern.test(text)) reasons.add(check.reason);
  }
  return [...reasons];
}

export function isApprovalConfirmed(body: ApprovalRequestBody | undefined): boolean {
  return body?.approval_confirmed === true || body?.approval === "confirmed";
}

export function formatApprovalGateLog(reasons: string[]): string {
  return `Approval gate: execution blocked pending CEO approval. Reasons: ${reasons.join("; ")}`;
}

export function buildApprovalWorkflowMeta(existingMetaJson: string | null | undefined, reasons: string[]): string {
  let meta: Record<string, unknown> = {};
  const raw = typeof existingMetaJson === "string" ? existingMetaJson.trim() : "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      } else {
        meta.previous_workflow_meta_json = raw;
      }
    } catch {
      meta.previous_workflow_meta_json = raw;
    }
  }

  meta.approval_required = true;
  meta.risk_approval = {
    required: true,
    reasons,
    requested_at: Date.now(),
  };
  return JSON.stringify(meta);
}

export function clearApprovalRequiredWorkflowMeta(existingMetaJson: string | null | undefined): string | null {
  const raw = typeof existingMetaJson === "string" ? existingMetaJson.trim() : "";
  if (!raw) return existingMetaJson ?? null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return existingMetaJson ?? null;
    const meta = parsed as Record<string, unknown>;
    delete meta.approval_required;
    delete meta.risk_approval;
    return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
  } catch {
    return existingMetaJson ?? null;
  }
}
