"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode10 = __toESM(require("vscode"));

// src/commands.ts
var vscode2 = __toESM(require("vscode"));

// src/config.ts
var vscode = __toESM(require("vscode"));
var DEFAULT_DAEMON_URL = "http://localhost:5178";
var DEFAULT_COMMAND_BRIDGE_URL = "http://localhost:1420";
function getDaemonUrl() {
  const value = vscode.workspace.getConfiguration("jarvis").get("daemonUrl", DEFAULT_DAEMON_URL);
  return value?.trim() ? value.trim() : DEFAULT_DAEMON_URL;
}
function getCommandBridgeUrl() {
  return vscode.workspace.getConfiguration("jarvis").get("commandBridgeUrl", DEFAULT_COMMAND_BRIDGE_URL) ?? DEFAULT_COMMAND_BRIDGE_URL;
}
function getDaemonLaunchSetting() {
  return vscode.workspace.getConfiguration("jarvis").get("daemonLaunch") ?? null;
}
async function openLaunchSetting() {
  await vscode.commands.executeCommand("workbench.action.openSettings", "jarvis.daemonLaunch");
}

// src/daemonHealth.ts
var HEALTH_PATH = "/healthz";
var STATUS_PATH = "/api/v1/status";
var DEFAULT_PROBE_TIMEOUT_MS = 2e3;
var DEFAULT_PROBE_INTERVAL_MS = 2e3;
var DEFAULT_STARTUP_TIMEOUT_MS = 6e4;
function healthUrl(baseUrl, path = HEALTH_PATH) {
  return `${baseUrl.trim().replace(/\/+$/, "")}${path}`;
}
function parseHealthPayload(status, body) {
  if (status < 200 || status >= 300) {
    return { online: false, detail: `HTTP ${status}` };
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) return { online: true };
  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return { online: true, detail: "non-JSON health payload" };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { online: true, detail: "unrecognized health payload" };
  }
  const record = payload;
  const reported = typeof record["status"] === "string" ? String(record["status"]) : null;
  if (reported !== null && !["ok", "healthy", "up"].includes(reported.toLowerCase())) {
    return { online: false, detail: `daemon reports status "${reported}"` };
  }
  const version = typeof record["version"] === "string" ? String(record["version"]) : void 0;
  return version === void 0 ? { online: true } : { online: true, version };
}
async function probeDaemonHealth(baseUrl, options = {}) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const signal = options.signal ?? timeoutSignal(options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  const primary = await requestHealth(doFetch, healthUrl(baseUrl, HEALTH_PATH), signal);
  if ("error" in primary) return { online: false, detail: primary.error };
  if (primary.status !== 404) return parseHealthPayload(primary.status, primary.body);
  const fallback = await requestHealth(doFetch, healthUrl(baseUrl, STATUS_PATH), signal);
  if ("error" in fallback) return { online: false, detail: fallback.error };
  return parseHealthPayload(fallback.status, fallback.body);
}
async function waitForDaemon(options) {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? (() => Date.now());
  const intervalMs = options.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const startedAt = now();
  let attempts = 0;
  for (; ; ) {
    attempts += 1;
    const health = await options.probe();
    options.onAttempt?.(attempts, health);
    if (health.online) {
      return { ...health, attempts, timedOut: false, cancelled: false };
    }
    if (options.isCancelled?.() === true) {
      return { ...health, attempts, timedOut: false, cancelled: true };
    }
    if (now() - startedAt >= timeoutMs) {
      return { ...health, attempts, timedOut: true, cancelled: false };
    }
    await sleep(intervalMs);
  }
}
async function requestHealth(doFetch, url, signal) {
  try {
    const response = await doFetch(url, { signal });
    const body = await response.text().catch(() => "");
    return { status: response.status, body };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}
function timeoutSignal(ms) {
  const factory = AbortSignal;
  return typeof factory.timeout === "function" ? factory.timeout(ms) : void 0;
}
function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/daemonClient.ts
var DaemonUnreachableError = class extends Error {
  constructor(cause) {
    super(`Jarvis daemon is not reachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DaemonUnreachableError";
  }
};
var DaemonClient = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  url(path) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }
  async getJson(path, signal) {
    let response;
    try {
      response = await fetch(this.url(path), { signal });
    } catch (cause) {
      throw new DaemonUnreachableError(cause);
    }
    if (!response.ok) {
      throw new Error(`GET ${path} \u2192 ${response.status}`);
    }
    return await response.json();
  }
  async postJson(path, body) {
    let response;
    try {
      response = await fetch(this.url(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === void 0 ? void 0 : JSON.stringify(body)
      });
    } catch (cause) {
      throw new DaemonUnreachableError(cause);
    }
    if (!response.ok) {
      throw new Error(`POST ${path} \u2192 ${response.status}: ${await response.text().catch(() => "")}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : void 0;
  }
  /** Health probe (`/healthz`, falling back to `/api/v1/status`). Never throws. */
  health(signal) {
    return probeDaemonHealth(this.baseUrl, signal ? { signal } : {});
  }
  async isReachable(signal) {
    return (await this.health(signal)).online;
  }
  status(signal) {
    return this.getJson("/api/v1/status", signal);
  }
  projects(signal) {
    return this.getJson("/api/v1/projects", signal);
  }
  goals(projectId, signal) {
    return this.getJson(`/api/v1/goals?project=${encodeURIComponent(projectId)}`, signal);
  }
  workflows(signal) {
    return this.getJson("/api/v1/workflows", signal);
  }
  approvals(signal) {
    return this.getJson("/api/v1/approvals", signal);
  }
  agents(signal) {
    return this.getJson("/api/v1/agents", signal);
  }
  /** Long-poll event feed. Returns events after the cursor, waiting up to waitSeconds. */
  events(after, waitSeconds, signal) {
    return this.getJson(
      `/api/v1/events?after=${after}&waitSeconds=${waitSeconds}&max=500`,
      signal
    );
  }
  /** Latest evidence manifest for a workflow; null when none has been published. */
  async evidence(workflowId, signal) {
    try {
      return await this.getJson(`/api/v1/workflows/${workflowId}/evidence`, signal);
    } catch (cause) {
      if (cause instanceof DaemonUnreachableError) throw cause;
      return null;
    }
  }
  async diff(workflowId) {
    try {
      const r = await fetch(this.url(`/api/v1/workflows/${workflowId}/diff`));
      return r.ok ? await r.text() : null;
    } catch (cause) {
      throw new DaemonUnreachableError(cause);
    }
  }
  registerProject(path, name) {
    return this.postJson("/api/v1/projects", { path, name });
  }
  createGoal(request) {
    return this.postJson("/api/v1/goals", request);
  }
  runGoal(goalId) {
    return this.postJson(`/api/v1/goals/${goalId}/run`);
  }
  cancelWorkflow(workflowId) {
    return this.postJson(`/api/v1/workflows/${workflowId}/cancel`);
  }
  resolveApproval(approvalId, approved, actorId2) {
    return this.postJson(`/api/v1/approvals/${approvalId}`, {
      approvalId,
      actor: { type: "user", id: actorId2 },
      approved,
      respondedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
};

// src/model.ts
var TERMINAL_STATES = /* @__PURE__ */ new Set([
  "completed",
  "discarded",
  "failed",
  "cancelled"
]);
function isActiveWorkflow(w) {
  return !TERMINAL_STATES.has(w.state);
}

// src/presentation.ts
var PIPELINE_STAGES = [
  "planned",
  "isolating",
  "planning",
  "executing",
  "verifying",
  "reviewing",
  "awaitingApproval"
];
function workflowIcon(state) {
  switch (state) {
    case "completed":
      return { icon: "pass-filled", color: "testing.iconPassed" };
    case "awaitingApproval":
      return { icon: "clock", color: "notificationsWarningIcon.foreground" };
    case "failed":
      return { icon: "error", color: "testing.iconFailed" };
    case "discarded":
    case "cancelled":
      return { icon: "circle-slash", color: "descriptionForeground" };
    default:
      return { icon: "sync~spin", color: "charts.blue" };
  }
}
function workflowStateLabel(state) {
  const words = {
    awaitingApproval: "Awaiting approval"
  };
  if (words[state]) return words[state];
  return state.charAt(0).toUpperCase() + state.slice(1);
}
function pipelineProgress(state) {
  if (state === "completed") return 100;
  if (TERMINAL_STATES.has(state)) return 0;
  const idx = PIPELINE_STAGES.indexOf(state);
  if (idx < 0) return 0;
  return Math.round(idx / (PIPELINE_STAGES.length - 1) * 100);
}
function workflowDescription(w) {
  const parts = [workflowStateLabel(w.state)];
  if (!TERMINAL_STATES.has(w.state)) {
    parts[0] = `${parts[0]} \xB7 ${pipelineProgress(w.state)}%`;
  }
  if (w.branchName) parts.push(w.branchName.replace(/^jarvis\//, ""));
  if (w.failureReason && (w.state === "failed" || w.state === "discarded")) {
    parts.push(truncate(w.failureReason, 60));
  }
  return parts.join(" \xB7 ");
}
function describeEvent(e) {
  const data = e.data ?? {};
  const s = (k) => typeof data[k] === "string" ? String(data[k]) : null;
  const wf = e.correlationId?.slice(-8) ?? "";
  switch (e.eventType) {
    case "GoalCreated.v1":
      return `Goal created`;
    case "WorkflowStarted.v1":
      return `[${wf}] workflow engaged`;
    case "WorkspaceIsolated.v1":
      return `[${wf}] worktree isolated \xB7 network deny-default`;
    case "AgentSelected.v1":
      return `[${wf}] router \u2192 ${s("agentId")} (${s("role")?.toLowerCase() ?? "role"}) \xB7 ${s("rationale") ?? ""}`;
    case "PlanCreated.v1":
      return `[${wf}] implementation plan sealed`;
    case "AgentSessionCompleted.v1":
      return `[${wf}] agent session complete`;
    case "EvidencePublished.v1":
      return `[${wf}] evidence bundle published`;
    case "VerificationCompleted.v1":
      return `[${wf}] verification green \u2192 review`;
    case "ReviewCompleted.v1":
      return `[${wf}] review complete \xB7 approval requested`;
    case "ReviewRepairRequested.v1":
      return `[${wf}] repair round engaged`;
    case "PolicyDecisionMade.v1":
      return `[${wf}] sentinel decision recorded`;
    case "WorkflowCompleted.v1":
      return `[${wf}] \u2713 complete \xB7 branch preserved`;
    case "WorkflowDiscarded.v1":
      return `[${wf}] \u2715 discarded \xB7 worktree destroyed`;
    case "WorkflowFailed.v1":
      return `[${wf}] workflow failed`;
    case "WorkflowCancelled.v1":
      return `[${wf}] workflow cancelled`;
    default:
      return `[${wf}] ${e.eventType.replace(/\.v1$/, "")}`;
  }
}
function renderEvidenceManifest(manifest) {
  const items = manifest.items ?? [];
  const criteria = manifest.acceptanceCriteria ?? [];
  const lines = [
    `# Evidence \xB7 workflow ${manifest.workflowId}`,
    "",
    `- Manifest: \`${manifest.id}\``,
    `- Published: ${manifest.createdAt}`
  ];
  if (manifest.manifestHash) lines.push(`- Manifest hash: \`${manifest.manifestHash}\``);
  lines.push("", `## Items (${items.length})`, "");
  if (items.length === 0) {
    lines.push("_No evidence items._");
  } else {
    for (const item of items) {
      lines.push(`- **${item.kind}** \xB7 ${outcomeMark(item.outcome)} ${item.title}`);
      if (item.summary) lines.push(`  - ${item.summary}`);
      if (item.artifact) {
        const size = item.artifact.sizeBytes === void 0 ? "" : ` \xB7 ${item.artifact.sizeBytes} bytes`;
        lines.push(`  - artifact \`${item.artifact.sha256.slice(0, 12)}\`${size}`);
      }
    }
  }
  lines.push("", `## Acceptance criteria (${criteria.length})`, "");
  if (criteria.length === 0) {
    lines.push("_No acceptance criteria recorded._");
  } else {
    for (const criterion of criteria) {
      lines.push(`- ${outcomeMark(criterion.status)} ${criterion.criterion}`);
      if (criterion.note) lines.push(`  - ${criterion.note}`);
    }
  }
  return `${lines.join("\n")}
`;
}
function outcomeMark(outcome) {
  switch (outcome.toLowerCase()) {
    case "passed":
      return "\u2713";
    case "failed":
      return "\u2715";
    default:
      return "\u2022";
  }
}
function formatTimestamp(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
}

// src/commands.ts
function registerCommands(client, store, showOutput, launcher) {
  const reg = vscode2.commands.registerCommand;
  const withDaemon = async (fn) => {
    try {
      await fn();
      await store.refresh();
    } catch (err) {
      if (err instanceof DaemonUnreachableError) {
        void vscode2.window.showErrorMessage("Jarvis daemon is not reachable.", "Start daemon").then((choice) => {
          if (choice === "Start daemon") void launcher.start();
        });
      } else {
        void vscode2.window.showErrorMessage(`Jarvis: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  return [
    reg("jarvis.refresh", () => withDaemon(async () => {
    })),
    reg(
      "jarvis.registerWorkspace",
      () => withDaemon(async () => {
        const folder = vscode2.workspace.workspaceFolders?.[0];
        if (!folder) {
          void vscode2.window.showWarningMessage("Open a folder to register it as a Jarvis project.");
          return;
        }
        const project = await client.registerProject(folder.uri.fsPath);
        void vscode2.window.showInformationMessage(
          `Registered ${project.name} (${project.buildProfile?.kind ?? "no build profile detected"}).`
        );
      })
    ),
    reg(
      "jarvis.engage",
      () => withDaemon(async () => {
        const project = await pickProject(store);
        if (!project) return;
        const directive = await vscode2.window.showInputBox({
          title: "Jarvis \xB7 Engage a Directive",
          prompt: `Goal for ${project.name}`,
          placeHolder: "e.g. Add a /health endpoint returning service status",
          ignoreFocusOut: true
        });
        if (!directive?.trim()) return;
        const agent = await pickAgent(store);
        const goal = await client.createGoal({
          project: project.id,
          title: directive.length > 80 ? `${directive.slice(0, 77)}...` : directive,
          objective: directive,
          agent: agent ?? void 0
        });
        const workflow = await client.runGoal(goal.id);
        showOutput();
        void vscode2.window.showInformationMessage(`Engaged \xB7 workflow ${workflow.id.slice(-8)} running.`);
      })
    ),
    reg(
      "jarvis.runGoal",
      (item) => withDaemon(async () => {
        const goal = item?.goal;
        if (!goal) return;
        const workflow = await client.runGoal(goal.id);
        showOutput();
        void vscode2.window.showInformationMessage(`Running \xB7 workflow ${workflow.id.slice(-8)}.`);
      })
    ),
    reg(
      "jarvis.cancelWorkflow",
      (item) => withDaemon(async () => {
        const workflow = item?.workflow ?? await pickActiveWorkflow(store);
        if (!workflow) return;
        await client.cancelWorkflow(workflow.id);
        void vscode2.window.showInformationMessage(`Cancelled workflow ${workflow.id.slice(-8)}.`);
      })
    ),
    reg(
      "jarvis.approve",
      (item) => withDaemon(async () => {
        const approval = item?.approval ?? await pickApproval(store);
        if (!approval) return;
        await client.resolveApproval(approval.id, true, actorId());
        void vscode2.window.showInformationMessage("Approved. The jarvis/* branch is kept; merge when ready.");
      })
    ),
    reg(
      "jarvis.deny",
      (item) => withDaemon(async () => {
        const approval = item?.approval ?? await pickApproval(store);
        if (!approval) return;
        await client.resolveApproval(approval.id, false, actorId());
        void vscode2.window.showInformationMessage("Denied. Worktree and branch removed; evidence retained.");
      })
    ),
    reg("jarvis.showDiff", (item) => showDiff(client, store, item)),
    reg(
      "jarvis.showEvidence",
      (item) => withDaemon(async () => {
        const workflowId = workflowIdOf(item) ?? (await pickActiveWorkflow(store, true))?.id;
        if (!workflowId) return;
        const manifest = await client.evidence(workflowId);
        if (!manifest) {
          void vscode2.window.showInformationMessage("No evidence published for this workflow yet.");
          return;
        }
        const doc = await vscode2.workspace.openTextDocument({
          content: renderEvidenceManifest(manifest),
          language: "markdown"
        });
        await vscode2.window.showTextDocument(doc, { preview: true });
      })
    ),
    reg("jarvis.openCommandBridge", async () => {
      await vscode2.env.openExternal(vscode2.Uri.parse(getCommandBridgeUrl()));
    }),
    reg("jarvis.startDaemon", () => launcher.start())
  ];
}
function workflowIdOf(item) {
  if (item && "workflow" in item) return item.workflow.id;
  if (item && "approval" in item) return item.approval.workflowId;
  return void 0;
}
async function showDiff(client, store, item) {
  const workflowId = workflowIdOf(item) ?? (await pickActiveWorkflow(store, true))?.id;
  if (!workflowId) return;
  try {
    const patch = await client.diff(workflowId);
    if (!patch) {
      void vscode2.window.showInformationMessage("No diff available for this workflow yet.");
      return;
    }
    const doc = await vscode2.workspace.openTextDocument({ content: patch, language: "diff" });
    await vscode2.window.showTextDocument(doc, { preview: true });
  } catch (err) {
    void vscode2.window.showErrorMessage(`Jarvis: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function pickProject(store) {
  const projects = store.snapshot.projects;
  if (projects.length === 0) {
    void vscode2.window.showWarningMessage("No projects registered. Run 'Jarvis: Register This Workspace'.");
    return void 0;
  }
  if (projects.length === 1) return projects[0];
  const pick = await vscode2.window.showQuickPick(
    projects.map((p) => ({ label: p.name, description: p.rootPath, project: p })),
    { title: "Target project" }
  );
  return pick?.project;
}
async function pickAgent(store) {
  const available = store.snapshot.agents.filter((a) => a.available);
  if (available.length <= 1) return null;
  const pick = await vscode2.window.showQuickPick(
    [
      { label: "Auto (router decides)", id: null },
      ...available.map((a) => ({ label: a.id, id: a.id }))
    ],
    { title: "Routing (optional)" }
  );
  return pick?.id ?? null;
}
async function pickActiveWorkflow(store, includeDone = false) {
  const candidates = includeDone ? store.snapshot.workflows : store.snapshot.workflows.filter((w) => !["completed", "discarded", "failed", "cancelled"].includes(w.state));
  if (candidates.length === 0) return void 0;
  if (candidates.length === 1) return candidates[0];
  const pick = await vscode2.window.showQuickPick(
    candidates.map((w) => ({ label: `wf ${w.id.slice(-8)}`, description: w.state, workflow: w })),
    { title: "Workflow" }
  );
  return pick?.workflow;
}
async function pickApproval(store) {
  const approvals = store.snapshot.approvals;
  if (approvals.length === 0) {
    void vscode2.window.showInformationMessage("No pending approvals.");
    return void 0;
  }
  if (approvals.length === 1) return approvals[0];
  const pick = await vscode2.window.showQuickPick(
    approvals.map((a) => ({ label: a.summary.split(" \u2014 ")[0], description: a.risk, approval: a })),
    { title: "Approval" }
  );
  return pick?.approval;
}
function actorId() {
  return process.env.USERNAME ?? process.env.USER ?? "forge";
}

// src/daemonLauncher.ts
var fs = __toESM(require("node:fs"));
var vscode3 = __toESM(require("vscode"));

// src/daemonLaunch.ts
var HOST_PROJECT_SEGMENTS = ["src", "Jarvis.Host", "Jarvis.Host.csproj"];
var DEFAULT_DAEMON_COMMAND = "jarvisd";
var BARE_COMMAND = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;
var ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]|\/)/;
var SHELL_METACHARACTERS = /[&|;<>$`(){}\[\]!*?"'\s]/;
var CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
function validateLaunchSpec(raw) {
  if (raw === null || raw === void 0) {
    return { ok: false, reason: "no launch spec configured" };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "jarvis.daemonLaunch must be an object" };
  }
  const record = raw;
  const command = record["command"];
  if (typeof command !== "string" || command.trim().length === 0) {
    return { ok: false, reason: "jarvis.daemonLaunch.command must be a non-empty string" };
  }
  const trimmedCommand = command.trim();
  if (SHELL_METACHARACTERS.test(trimmedCommand) || CONTROL_CHARACTERS.test(trimmedCommand)) {
    return {
      ok: false,
      reason: "jarvis.daemonLaunch.command must not contain shell metacharacters or spaces"
    };
  }
  if (!BARE_COMMAND.test(trimmedCommand) && !ABSOLUTE_PATH.test(trimmedCommand)) {
    return {
      ok: false,
      reason: "jarvis.daemonLaunch.command must be a bare executable name or an absolute path"
    };
  }
  const rawArgs = record["args"];
  let args = [];
  if (rawArgs !== void 0 && rawArgs !== null) {
    if (!Array.isArray(rawArgs)) {
      return { ok: false, reason: "jarvis.daemonLaunch.args must be an array of strings" };
    }
    if (!rawArgs.every((a) => typeof a === "string")) {
      return { ok: false, reason: "jarvis.daemonLaunch.args must contain strings only" };
    }
    if (rawArgs.some((a) => CONTROL_CHARACTERS.test(a))) {
      return { ok: false, reason: "jarvis.daemonLaunch.args must not contain control characters" };
    }
    args = [...rawArgs];
  }
  const rawCwd = record["cwd"];
  if (rawCwd !== void 0 && rawCwd !== null) {
    if (typeof rawCwd !== "string" || rawCwd.trim().length === 0) {
      return { ok: false, reason: "jarvis.daemonLaunch.cwd must be a non-empty string" };
    }
    if (CONTROL_CHARACTERS.test(rawCwd)) {
      return { ok: false, reason: "jarvis.daemonLaunch.cwd must not contain control characters" };
    }
    return { ok: true, spec: { command: trimmedCommand, args, cwd: rawCwd } };
  }
  return { ok: true, spec: { command: trimmedCommand, args } };
}
function resolveLaunchSpec(input = {}) {
  if (input.configured !== void 0 && input.configured !== null) {
    const validated = validateLaunchSpec(input.configured);
    return validated.ok ? { kind: "configured", spec: validated.spec } : { kind: "invalid", reason: validated.reason };
  }
  const exists = input.exists;
  if (exists) {
    for (const folder of input.workspaceFolders ?? []) {
      if (typeof folder !== "string" || folder.length === 0) continue;
      const project = joinPath(folder, ...HOST_PROJECT_SEGMENTS);
      if (exists(project)) {
        return {
          kind: "workspace",
          spec: { command: "dotnet", args: ["run", "--project", project], cwd: folder }
        };
      }
    }
  }
  return { kind: "path", spec: { command: DEFAULT_DAEMON_COMMAND, args: [] } };
}
function isSpeculative(resolution) {
  return resolution.kind === "path";
}
function formatLaunchCommand(spec) {
  return [spec.command, ...spec.args].map(quoteForDisplay).join(" ");
}
function joinPath(base, ...segments) {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  return [trimmed, ...segments].join(separator);
}
function quoteForDisplay(token) {
  return /\s/.test(token) ? `"${token}"` : token;
}

// src/daemonLauncher.ts
var TERMINAL_NAME = "Jarvis Daemon";
var DaemonLauncher = class {
  constructor(store, log) {
    this.store = store;
    this.log = log;
    this.closeListener = vscode3.window.onDidCloseTerminal((closed) => {
      if (closed === this.terminal) this.terminal = void 0;
    });
  }
  terminal;
  closeListener;
  starting = false;
  offlineNoticeShown = false;
  /** Implementation of `jarvis.startDaemon`. */
  async start() {
    if (this.starting) {
      this.terminal?.show(true);
      return;
    }
    const url = getDaemonUrl();
    const existing = await probeDaemonHealth(url);
    if (existing.online) {
      void vscode3.window.showInformationMessage(`Jarvis daemon is already running at ${url}.`);
      await this.store.refresh();
      return;
    }
    const resolution = resolveLaunchSpec({
      configured: getDaemonLaunchSetting(),
      workspaceFolders: (vscode3.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      exists: fileExists
    });
    if (resolution.kind === "invalid") {
      this.log(`daemon launch spec rejected: ${resolution.reason}`);
      const choice = await vscode3.window.showErrorMessage(
        `Jarvis: ${resolution.reason}`,
        "Configure"
      );
      if (choice === "Configure") await openLaunchSetting();
      return;
    }
    const spec = resolution.spec;
    this.log(`starting daemon (${resolution.kind}): ${formatLaunchCommand(spec)}`);
    this.launchTerminal(spec);
    this.starting = true;
    this.store.setConnecting(true);
    try {
      const result = await vscode3.window.withProgress(
        {
          location: vscode3.ProgressLocation.Notification,
          title: "Jarvis: starting the daemon\u2026",
          cancellable: true
        },
        (progress, token) => waitForDaemon({
          probe: () => probeDaemonHealth(url),
          intervalMs: DEFAULT_PROBE_INTERVAL_MS,
          timeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
          isCancelled: () => token.isCancellationRequested,
          onAttempt: (attempt) => progress.report({ message: `probe ${attempt} \xB7 ${url}` })
        })
      );
      if (result.online) {
        this.log(`daemon online at ${url}${result.version ? ` \xB7 v${result.version}` : ""}`);
        void vscode3.window.showInformationMessage(
          `Jarvis daemon is online${result.version ? ` (v${result.version})` : ""}.`
        );
        return;
      }
      if (result.cancelled) {
        this.log("daemon startup wait cancelled by the user");
        return;
      }
      this.log(`daemon did not answer at ${url} after ${result.attempts} probes`);
      const hint2 = isSpeculative(resolution) ? " `jarvisd` may not be on PATH \u2014 set `jarvis.daemonLaunch` to how you run it." : " Check the Jarvis Daemon terminal for the failure.";
      const choice = await vscode3.window.showErrorMessage(
        `Jarvis daemon did not come online within ${Math.round(DEFAULT_STARTUP_TIMEOUT_MS / 1e3)}s at ${url}.${hint2}`,
        "Show Terminal",
        "Configure"
      );
      if (choice === "Show Terminal") this.terminal?.show(true);
      else if (choice === "Configure") await openLaunchSetting();
    } finally {
      this.starting = false;
      this.store.setConnecting(false);
      await this.store.refresh();
    }
  }
  /**
   * Activation probe. When the daemon is not running, offers to start it once
   * per session — Forge is inert without it.
   */
  async offerStartIfOffline() {
    const url = getDaemonUrl();
    const health = await probeDaemonHealth(url);
    if (health.online) {
      this.log(`daemon online at ${url}${health.version ? ` \xB7 v${health.version}` : ""}`);
      return;
    }
    this.log(`daemon offline at ${url}${health.detail ? ` (${health.detail})` : ""}`);
    if (this.offlineNoticeShown) return;
    this.offlineNoticeShown = true;
    const choice = await vscode3.window.showInformationMessage(
      `Jarvis daemon (jarvisd) is not running at ${url}. Forge needs it for projects, workflows and approvals.`,
      "Start daemon",
      "Configure"
    );
    if (choice === "Start daemon") await this.start();
    else if (choice === "Configure") await openLaunchSetting();
  }
  launchTerminal(spec) {
    this.terminal?.dispose();
    this.terminal = vscode3.window.createTerminal({
      name: TERMINAL_NAME,
      shellPath: spec.command,
      shellArgs: [...spec.args],
      cwd: spec.cwd
    });
    this.terminal.show(true);
  }
  /** Disposes the close listener only — the daemon terminal outlives the launcher. */
  dispose() {
    this.closeListener.dispose();
  }
};
function fileExists(path) {
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

// src/pollService.ts
var vscode4 = __toESM(require("vscode"));
var PollService = class {
  constructor(store, client) {
    this.store = store;
    this.client = client;
    this.output = vscode4.window.createOutputChannel("Jarvis Forge");
  }
  output;
  timer;
  abort;
  cursor = 0;
  stopped = false;
  start() {
    void this.store.refresh();
    this.timer = setInterval(() => void this.store.refresh(), 4e3);
    void this.pumpEvents();
  }
  async pumpEvents() {
    while (!this.stopped) {
      this.abort = new AbortController();
      try {
        const batch = await this.client.events(this.cursor, 25, this.abort.signal);
        if (batch.length > 0) {
          this.cursor = Math.max(this.cursor, ...batch.map((e) => e.sequence));
          for (const event of batch) {
            this.output.appendLine(`${formatTimestamp(event.occurredAt)}  ${describeEvent(event)}`);
          }
          void this.store.refresh();
        }
      } catch {
        await delay(3e3);
      }
    }
  }
  show() {
    this.output.show(true);
  }
  /** Writes a timestamped extension-side line (daemon launch, probes) to the channel. */
  log(message) {
    this.output.appendLine(`${formatTimestamp((/* @__PURE__ */ new Date()).toISOString())}  ${message}`);
  }
  dispose() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.abort?.abort();
    this.output.dispose();
  }
};
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/statusBar.ts
var vscode5 = __toESM(require("vscode"));
var StatusBar = class {
  item;
  constructor(store) {
    this.item = vscode5.window.createStatusBarItem(vscode5.StatusBarAlignment.Left, 100);
    this.item.command = "jarvis.workflows.focus";
    this.render(store.snapshot);
    this.item.show();
    store.onDidChange((snap) => this.render(snap));
  }
  render(snap) {
    if (!snap.online && snap.connecting) {
      this.item.text = "$(sync~spin) Jarvis: starting daemon\u2026";
      this.item.tooltip = "Waiting for jarvisd to answer the health probe.";
      this.item.backgroundColor = new vscode5.ThemeColor("statusBarItem.warningBackground");
      this.item.command = "jarvis.startDaemon";
      return;
    }
    if (!snap.online) {
      this.item.text = "$(debug-disconnect) Jarvis: daemon offline";
      this.item.tooltip = "jarvisd is not reachable. Click to start it (Jarvis: Start Daemon).";
      this.item.backgroundColor = new vscode5.ThemeColor("statusBarItem.warningBackground");
      this.item.command = "jarvis.startDaemon";
      return;
    }
    this.item.backgroundColor = void 0;
    this.item.command = "jarvis.workflows.focus";
    const active = snap.workflows.find(isActiveWorkflow);
    const pending = snap.approvals.length;
    if (active) {
      this.item.text = `$(sync~spin) Jarvis \xB7 ${workflowStateLabel(active.state)} ${pipelineProgress(active.state)}%`;
      this.item.tooltip = `Workflow ${active.id} \xB7 ${active.state}`;
    } else if (pending > 0) {
      this.item.text = `$(clock) Jarvis \xB7 ${pending} approval${pending > 1 ? "s" : ""}`;
      this.item.tooltip = "Approvals waiting \u2014 open the Jarvis Forge view";
    } else {
      this.item.text = "$(rocket) Jarvis ready";
      this.item.tooltip = `${snap.status?.projectCount ?? 0} projects \xB7 ${snap.agents.filter((a) => a.available).length} agents online`;
    }
  }
  dispose() {
    this.item.dispose();
  }
};

// src/store.ts
var vscode6 = __toESM(require("vscode"));
var EMPTY = {
  online: false,
  connecting: false,
  status: null,
  projects: [],
  workflows: [],
  approvals: [],
  agents: []
};
var Store = class {
  constructor(client) {
    this.client = client;
  }
  emitter = new vscode6.EventEmitter();
  onDidChange = this.emitter.event;
  current = EMPTY;
  get snapshot() {
    return this.current;
  }
  async refresh() {
    try {
      const [status, projects, workflows, approvals, agents] = await Promise.all([
        this.client.status(),
        this.client.projects(),
        this.client.workflows(),
        this.client.approvals(),
        this.client.agents()
      ]);
      this.current = { online: true, connecting: false, status, projects, workflows, approvals, agents };
    } catch {
      this.current = { ...EMPTY, online: false, connecting: this.current.connecting };
    }
    this.emitter.fire(this.current);
  }
  /** Marks a daemon launch as in flight so the status bar can show it. */
  setConnecting(connecting) {
    if (this.current.connecting === connecting) return;
    this.current = { ...this.current, connecting };
    this.emitter.fire(this.current);
  }
  dispose() {
    this.emitter.dispose();
  }
};

// src/views/approvalsView.ts
var vscode7 = __toESM(require("vscode"));
var ApprovalItem = class extends vscode7.TreeItem {
  constructor(approval) {
    super(approval.summary.split(" \u2014 ")[0] ?? approval.summary, vscode7.TreeItemCollapsibleState.None);
    this.approval = approval;
    this.description = approval.risk;
    this.tooltip = approval.summary;
    this.contextValue = "jarvisApproval";
    this.iconPath = new vscode7.ThemeIcon(
      "clock",
      new vscode7.ThemeColor("notificationsWarningIcon.foreground")
    );
    this.id = `approval:${approval.id}`;
  }
};
var ApprovalsView = class {
  constructor(store) {
    this.store = store;
    store.onDidChange(() => this.emitter.fire());
  }
  emitter = new vscode7.EventEmitter();
  onDidChangeTreeData = this.emitter.event;
  getTreeItem(element) {
    return element;
  }
  getChildren() {
    const snap = this.store.snapshot;
    if (!snap.online) {
      const item = new vscode7.TreeItem("Daemon offline", vscode7.TreeItemCollapsibleState.None);
      item.iconPath = new vscode7.ThemeIcon("debug-disconnect");
      return [item];
    }
    if (snap.approvals.length === 0) {
      const item = new vscode7.TreeItem("Nothing waiting on you", vscode7.TreeItemCollapsibleState.None);
      item.iconPath = new vscode7.ThemeIcon("check-all");
      return [item];
    }
    return snap.approvals.map((a) => new ApprovalItem(a));
  }
};

// src/views/projectsView.ts
var vscode8 = __toESM(require("vscode"));
var ProjectItem = class extends vscode8.TreeItem {
  constructor(project) {
    super(project.name, vscode8.TreeItemCollapsibleState.Collapsed);
    this.project = project;
    this.description = project.buildProfile?.kind ?? "no build profile";
    this.tooltip = `${project.rootPath}
branch: ${project.defaultBranch}`;
    this.contextValue = "jarvisProject";
    this.iconPath = new vscode8.ThemeIcon("repo");
    this.id = `project:${project.id}`;
  }
};
var GoalItem = class extends vscode8.TreeItem {
  constructor(goal) {
    super(goal.title, vscode8.TreeItemCollapsibleState.None);
    this.goal = goal;
    this.description = goal.status;
    this.contextValue = "jarvisGoal";
    this.iconPath = new vscode8.ThemeIcon("target");
    this.id = `goal:${goal.id}`;
  }
};
var ProjectsView = class {
  constructor(store) {
    this.store = store;
    store.onDidChange(() => this.emitter.fire());
  }
  emitter = new vscode8.EventEmitter();
  onDidChangeTreeData = this.emitter.event;
  getTreeItem(element) {
    return element;
  }
  async getChildren(element) {
    if (!this.store.snapshot.online) {
      return [offline()];
    }
    if (!element) {
      const projects = this.store.snapshot.projects;
      return projects.length > 0 ? projects.map((p) => new ProjectItem(p)) : [hint("No projects \u2014 register this workspace", "jarvis.registerWorkspace")];
    }
    if (element instanceof ProjectItem) {
      try {
        const goals = await this.store.client.goals(element.project.id);
        return goals.length > 0 ? goals.map((g) => new GoalItem(g)) : [hint("No goals yet")];
      } catch {
        return [offline()];
      }
    }
    return [];
  }
};
function offline() {
  const item = new vscode8.TreeItem("Daemon offline", vscode8.TreeItemCollapsibleState.None);
  item.iconPath = new vscode8.ThemeIcon("debug-disconnect");
  item.description = "start jarvisd";
  return item;
}
function hint(label, command) {
  const item = new vscode8.TreeItem(label, vscode8.TreeItemCollapsibleState.None);
  item.iconPath = new vscode8.ThemeIcon("info");
  if (command) item.command = { command, title: label };
  return item;
}

// src/views/workflowsView.ts
var vscode9 = __toESM(require("vscode"));
var WorkflowItem = class extends vscode9.TreeItem {
  constructor(workflow) {
    super(shortId(workflow), vscode9.TreeItemCollapsibleState.None);
    this.workflow = workflow;
    this.description = workflowDescription(workflow);
    this.tooltip = buildTooltip(workflow);
    const active = isActiveWorkflow(workflow);
    this.contextValue = active ? "jarvisWorkflowActive" : "jarvisWorkflowDone";
    const { icon, color } = workflowIcon(workflow.state);
    this.iconPath = new vscode9.ThemeIcon(icon, color ? new vscode9.ThemeColor(color) : void 0);
    this.id = `workflow:${workflow.id}`;
  }
};
var WorkflowsView = class {
  constructor(store) {
    this.store = store;
    store.onDidChange(() => this.emitter.fire());
  }
  emitter = new vscode9.EventEmitter();
  onDidChangeTreeData = this.emitter.event;
  getTreeItem(element) {
    return element;
  }
  getChildren() {
    const snap = this.store.snapshot;
    if (!snap.online) {
      const item = new vscode9.TreeItem("Daemon offline", vscode9.TreeItemCollapsibleState.None);
      item.iconPath = new vscode9.ThemeIcon("debug-disconnect");
      return [item];
    }
    if (snap.workflows.length === 0) {
      const item = new vscode9.TreeItem("No workflows \u2014 engage a directive", vscode9.TreeItemCollapsibleState.None);
      item.iconPath = new vscode9.ThemeIcon("info");
      item.command = { command: "jarvis.engage", title: "Engage" };
      return [item];
    }
    const sorted = [...snap.workflows].sort((a, b) => {
      const activeDelta = Number(isActiveWorkflow(b)) - Number(isActiveWorkflow(a));
      return activeDelta !== 0 ? activeDelta : b.id.localeCompare(a.id);
    });
    return sorted.map((w) => new WorkflowItem(w));
  }
};
function shortId(w) {
  return `wf ${w.id.slice(-8)}`;
}
function buildTooltip(w) {
  const lines = [`Workflow ${w.id}`, `State: ${w.state}`];
  if (w.branchName) lines.push(`Branch: ${w.branchName}`);
  if (w.baselineCommit) lines.push(`Baseline: ${w.baselineCommit.slice(0, 10)}`);
  if (w.failureReason) lines.push(`Reason: ${w.failureReason}`);
  return lines.join("\n");
}

// src/extension.ts
function activate(context) {
  const client = new DaemonClient(getDaemonUrl());
  const store = new Store(client);
  const poll = new PollService(store, client);
  const launcher = new DaemonLauncher(store, (line) => poll.log(line));
  context.subscriptions.push(
    store,
    poll,
    launcher,
    new StatusBar(store),
    vscode10.window.registerTreeDataProvider("jarvis.projects", new ProjectsView(store)),
    vscode10.window.registerTreeDataProvider("jarvis.workflows", new WorkflowsView(store)),
    vscode10.window.registerTreeDataProvider("jarvis.approvals", new ApprovalsView(store)),
    ...registerCommands(client, store, () => poll.show(), launcher)
  );
  poll.start();
  void launcher.offerStartIfOffline();
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
