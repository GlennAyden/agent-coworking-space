#!/usr/bin/env node
/* global console, fetch, process */

const DEFAULT_BASE_URL = "http://127.0.0.1:8790";

const workflows = [
  {
    key: "expandly",
    labels: ["expandly", "project-playboxworld", "playboxworld"],
    envPath: "EXPANDLY_PROJECT_PATH",
    title: "Hermes read-only verification: Expandly",
    description:
      "Inspect the current Expandly project state and produce a concise evidence note covering health, recent changes, risks, touched files, verification commands, and recommended next action. Read-only only; do not mutate files or live systems.",
  },
  {
    key: "arch-viz",
    labels: ["arch viz", "arch-viz", "architecture-visualization", "architecture visualization"],
    envPath: "ARCH_VIZ_PROJECT_PATH",
    title: "Hermes read-only verification: Arch Viz",
    description:
      "Inspect the architecture visualization project and produce a concise evidence note covering health, architecture-map readiness, risks, touched files, verification commands, and recommended next action. Read-only only; do not mutate files or live systems.",
  },
  {
    key: "nexaquant",
    labels: ["nexaquant", "nexa quant", "nexaquants"],
    envPath: "NEXAQUANT_PROJECT_PATH",
    title: "Hermes read-only verification: NexaQuant",
    description:
      "Inspect the NexaQuant project and produce a concise evidence note covering health, data/source assumptions, risks, touched files, verification commands, and recommended next action. Read-only only; do not mutate files or live systems.",
  },
];

function parseArgs(argv) {
  return {
    run: argv.includes("--run"),
    baseUrl:
      valueAfter(argv, "--base-url") ||
      process.env.AGENT_COWORKING_BASE_URL ||
      process.env.CLAW_EMPIRE_BASE_URL ||
      DEFAULT_BASE_URL,
  };
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return "";
  return argv[index + 1] || "";
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeSearch(value) {
  return normalizeText(value).toLowerCase();
}

function projectMatches(project, workflow) {
  const haystack = normalizeSearch(`${project.name ?? ""}\n${project.project_path ?? ""}\n${project.core_goal ?? ""}`);
  return workflow.labels.some((label) => haystack.includes(label));
}

function findProject(projects, workflow) {
  const envPath = normalizeText(process.env[workflow.envPath]);
  if (envPath) {
    const exact = projects.find((project) => normalizeText(project.project_path).toLowerCase() === envPath.toLowerCase());
    if (exact) return exact;
    return {
      id: null,
      name: workflow.key,
      project_path: envPath,
    };
  }
  return projects.find((project) => projectMatches(project, workflow)) ?? null;
}

function findHermesAgent(agents) {
  return (
    agents.find((agent) => normalizeSearch(agent.cli_provider) === "hermes" && normalizeSearch(agent.status) !== "disabled") ??
    agents.find((agent) => normalizeSearch(agent.cli_provider) === "hermes") ??
    null
  );
}

function hasExistingTask(tasks, workflow, project) {
  const projectId = normalizeText(project.id);
  const projectPath = normalizeText(project.project_path);
  return tasks.some((task) => {
    if (normalizeText(task.title) !== workflow.title) return false;
    if (projectId && normalizeText(task.project_id) === projectId) return true;
    return projectPath && normalizeText(task.project_path).toLowerCase() === projectPath.toLowerCase();
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = await createClient(options.baseUrl);

  const [{ projects }, { agents }, { tasks }] = await Promise.all([
    client.get("/api/projects?page=1&page_size=50"),
    client.get("/api/agents?include_seed=true"),
    client.get("/api/tasks"),
  ]);

  const hermes = findHermesAgent(Array.isArray(agents) ? agents : []);
  if (!hermes) {
    throw new Error("No Hermes agent found. Add or configure an agent with cli_provider=hermes first.");
  }

  const created = [];
  const skipped = [];
  for (const workflow of workflows) {
    const project = findProject(Array.isArray(projects) ? projects : [], workflow);
    if (!project?.project_path && !project?.id) {
      skipped.push(`${workflow.key}: project not found (set ${workflow.envPath} or add it to Office Manager)`);
      continue;
    }
    if (hasExistingTask(Array.isArray(tasks) ? tasks : [], workflow, project)) {
      skipped.push(`${workflow.key}: existing task found`);
      continue;
    }

    const payload = {
      title: workflow.title,
      description: workflow.description,
      assigned_agent_id: hermes.id,
      department_id: hermes.department_id ?? null,
      project_id: project.id ?? undefined,
      project_path: project.project_path ?? undefined,
      status: "planned",
      priority: 2,
      task_type: "analysis",
      workflow_meta_json: {
        source: "seed-hermes-workflows",
        hermes_workflow_key: workflow.key,
        read_only: true,
      },
    };
    const result = await client.post("/api/tasks", payload);
    created.push({ key: workflow.key, id: result.id, title: workflow.title });
    if (options.run) {
      await client.post(`/api/tasks/${result.id}/run`, {});
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        hermes_agent_id: hermes.id,
        created,
        skipped,
        run: options.run,
      },
      null,
      2,
    ),
  );
}

async function createClient(baseUrlRaw) {
  const baseUrl = String(baseUrlRaw || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const bearer = normalizeText(process.env.API_AUTH_TOKEN || process.env.SESSION_AUTH_TOKEN);
  let cookie = "";

  async function request(path, options = {}) {
    const headers = {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    };
    if (bearer) {
      headers.authorization = `Bearer ${bearer}`;
    } else if (cookie) {
      headers.cookie = cookie;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${path}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }
    return body;
  }

  if (!bearer) {
    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`);
    if (!sessionResponse.ok) {
      throw new Error(`HTTP ${sessionResponse.status} /api/auth/session: unable to bootstrap local session`);
    }
    cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
  }

  return {
    get(path) {
      return request(path);
    },
    post(path, payload) {
      return request(path, {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      });
    },
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
