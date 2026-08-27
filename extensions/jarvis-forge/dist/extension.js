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
var vscode13 = __toESM(require("vscode"));

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
  costs(signal) {
    return this.getJson("/api/v1/costs", signal);
  }
  /**
   * The Model Council's route for a directive, without running anything. This
   * is what the Intent Bar previews live as you type: `explain` is a pure
   * query — it records a decision id but engages no agent and spends nothing.
   *
   * `fast` skips the local-model second opinion and answers from the heuristic
   * classifier alone — ~6-8 ms of daemon work against 0.14-0.22 s warm and up
   * to ~1.5 s cold. It is the same policy over a cheaper classification, so it
   * can disagree with the full answer; anything rendered from it must say so.
   */
  explainRoute(directive, options = {}, signal) {
    const params = new URLSearchParams({ directive, role: options.role ?? "implementer" });
    if (options.projectId) params.set("projectId", options.projectId);
    if (options.localOnly) params.set("localOnly", "true");
    if (options.fast) params.set("fast", "true");
    return this.getJson(`/api/v1/routing/explain?${params.toString()}`, signal);
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
  resolveApproval(approvalId, approved, actorId3, note) {
    return this.postJson(`/api/v1/approvals/${approvalId}`, {
      approvalId,
      actor: { type: "user", id: actorId3 },
      approved,
      note,
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
function registerCommands(client, store, showOutput, launcher, lens, ghost) {
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
    // The Intent Bar *is* the engage surface — this command is the keyboard
    // route to it, not a second, competing input box.
    reg("jarvis.engage", () => lens.focusIntent()),
    reg("jarvis.lens.focus", () => lens.focusIntent()),
    reg(
      "jarvis.engagePrompt",
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
    reg("jarvis.ghost.accept", (arg) => ghost.accept(arg)),
    reg("jarvis.ghost.reject", (arg) => ghost.reject(arg)),
    reg("jarvis.ghost.why", (arg) => ghost.why(arg)),
    reg("jarvis.ghost.clear", () => ghost.clear()),
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
  if (item && "workflowId" in item) return item.workflowId;
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

// src/ghostDiff.ts
var vscode4 = __toESM(require("vscode"));

// src/lens/diffHunks.ts
var FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
var HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
function stripPrefix(path) {
  return path.replace(/^[ab]\//, "");
}
function parseUnifiedDiff(patch) {
  const files = [];
  let file;
  let hunk;
  let newLine = 0;
  const pushHunk = () => {
    if (file && hunk) file.hunks.push(hunk);
    hunk = void 0;
  };
  const pushFile = () => {
    pushHunk();
    if (file) files.push(file);
    file = void 0;
  };
  for (const raw of patch.split(/\r?\n/)) {
    const header = FILE_HEADER.exec(raw);
    if (header) {
      pushFile();
      file = {
        path: stripPrefix(header[2]),
        oldPath: stripPrefix(header[1]),
        status: header[1] === header[2] ? "modified" : "renamed",
        added: 0,
        removed: 0,
        hunks: []
      };
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("new file mode")) {
      file.status = "added";
      continue;
    }
    if (raw.startsWith("deleted file mode")) {
      file.status = "deleted";
      continue;
    }
    if (raw.startsWith("rename to ")) {
      file.path = stripPrefix(raw.slice("rename to ".length).trim());
      file.status = "renamed";
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      if (target !== "/dev/null") file.path = stripPrefix(target);
      continue;
    }
    const hunkHeader = HUNK_HEADER.exec(raw);
    if (hunkHeader) {
      pushHunk();
      hunk = {
        oldStart: Number(hunkHeader[1]),
        oldLines: hunkHeader[2] === void 0 ? 1 : Number(hunkHeader[2]),
        newStart: Number(hunkHeader[3]),
        newLines: hunkHeader[4] === void 0 ? 1 : Number(hunkHeader[4]),
        added: 0,
        removed: 0,
        context: hunkHeader[5] ?? "",
        addedText: [],
        removedText: [],
        addedLines: []
      };
      newLine = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    if (raw.startsWith("+")) {
      hunk.added += 1;
      file.added += 1;
      hunk.addedText.push(raw.slice(1));
      hunk.addedLines.push(newLine);
      newLine += 1;
    } else if (raw.startsWith("-")) {
      hunk.removed += 1;
      file.removed += 1;
      hunk.removedText.push(raw.slice(1));
    } else if (raw.startsWith(" ") || raw === "") {
      newLine += 1;
    }
  }
  pushFile();
  return {
    files,
    filesChanged: files.length,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0)
  };
}
function addedRuns(hunk) {
  const runs = [];
  for (const line of hunk.addedLines) {
    const last = runs[runs.length - 1];
    if (last && line === last.endLine + 1) last.endLine = line;
    else runs.push({ startLine: line, endLine: line });
  }
  return runs;
}
function hunkRange(hunk) {
  if (hunk.newLines <= 0) {
    const line = Math.max(1, hunk.newStart);
    return { startLine: line, endLine: line };
  }
  return { startLine: hunk.newStart, endLine: hunk.newStart + hunk.newLines - 1 };
}
function findDiffFile(summary, absolutePath) {
  const normalized = absolutePath.replace(/\\/g, "/").toLowerCase();
  let best;
  let bestLength = 0;
  for (const file of summary.files) {
    if (file.status === "deleted") continue;
    const candidate = file.path.toLowerCase();
    if (normalized === candidate || normalized.endsWith(`/${candidate}`)) {
      if (candidate.length > bestLength) {
        best = file;
        bestLength = candidate.length;
      }
    }
  }
  return best;
}
function describeDiff(summary) {
  if (summary.filesChanged === 0) return "no file changes";
  const files = `${summary.filesChanged} file${summary.filesChanged === 1 ? "" : "s"}`;
  return `${files} \xB7 +${summary.added} \u2212${summary.removed}`;
}

// src/ghostDiff.ts
function hunkKey(uri, index) {
  return `${uri.fsPath}:${index}`;
}
function clampRange(document, startLine, endLine) {
  const first = Math.min(Math.max(startLine - 1, 0), Math.max(document.lineCount - 1, 0));
  const last = Math.min(Math.max(endLine - 1, 0), Math.max(document.lineCount - 1, 0));
  return new vscode4.Range(first, 0, last, document.lineAt(last).text.length);
}
function ghostRanges(document, hunk) {
  const runs = addedRuns(hunk);
  if (runs.length === 0) {
    const { startLine, endLine } = hunkRange(hunk);
    return [clampRange(document, startLine, endLine)];
  }
  return runs.map((run) => clampRange(document, run.startLine, run.endLine));
}
var GhostDiffController = class {
  constructor(client, store, seedIntent) {
    this.client = client;
    this.store = store;
    this.seedIntent = seedIntent;
    this.disposables.push(
      this.onDidChangeLensesEmitter,
      vscode4.window.onDidChangeVisibleTextEditors(() => this.render()),
      vscode4.workspace.onDidChangeTextDocument((e) => {
        if (this.state && this.fileFor(e.document)) this.render();
      }),
      vscode4.languages.registerCodeLensProvider({ scheme: "file" }, {
        onDidChangeCodeLenses: this.onDidChangeLensesEmitter.event,
        provideCodeLenses: (document) => this.lensesFor(document)
      })
    );
  }
  state;
  disposables = [];
  onDidChangeLensesEmitter = new vscode4.EventEmitter();
  addedDecoration = vscode4.window.createTextEditorDecorationType({
    isWholeLine: true,
    // A tint, not a fill: the ghost has to read as *proposed*, not as a marker.
    backgroundColor: new vscode4.ThemeColor("jarvis.ghostAddedBackground"),
    borderColor: new vscode4.ThemeColor("jarvis.ghostAddedBorder"),
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    overviewRulerColor: new vscode4.ThemeColor("jarvis.ghostAddedBorder"),
    overviewRulerLane: vscode4.OverviewRulerLane.Right,
    rangeBehavior: vscode4.DecorationRangeBehavior.ClosedClosed
  });
  removedDecoration = vscode4.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode4.ThemeColor("jarvis.ghostRemovedBackground"),
    borderColor: new vscode4.ThemeColor("jarvis.ghostRemovedBorder"),
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    rangeBehavior: vscode4.DecorationRangeBehavior.ClosedClosed
  });
  get activeWorkflowId() {
    return this.state?.workflowId;
  }
  show(workflowId, summary) {
    this.state = { workflowId, summary, dismissed: /* @__PURE__ */ new Set() };
    this.render();
    void vscode4.commands.executeCommand("setContext", "jarvis.ghostActive", true);
  }
  clear() {
    this.state = void 0;
    for (const editor of vscode4.window.visibleTextEditors) {
      editor.setDecorations(this.addedDecoration, []);
      editor.setDecorations(this.removedDecoration, []);
    }
    this.onDidChangeLensesEmitter.fire();
    void vscode4.commands.executeCommand("setContext", "jarvis.ghostActive", false);
  }
  fileFor(document) {
    if (!this.state || document.uri.scheme !== "file") return void 0;
    return findDiffFile(this.state.summary, document.uri.fsPath);
  }
  render() {
    for (const editor of vscode4.window.visibleTextEditors) {
      const file = this.fileFor(editor.document);
      if (!file) {
        editor.setDecorations(this.addedDecoration, []);
        editor.setDecorations(this.removedDecoration, []);
        continue;
      }
      const added = [];
      const removed = [];
      file.hunks.forEach((hunk, index) => {
        if (this.state?.dismissed.has(hunkKey(editor.document.uri, index))) return;
        const target = hunk.added > 0 ? added : removed;
        const hover = this.hover(file, hunk);
        for (const range of ghostRanges(editor.document, hunk)) {
          target.push({ range, hoverMessage: hover });
        }
      });
      editor.setDecorations(this.addedDecoration, added);
      editor.setDecorations(this.removedDecoration, removed);
    }
    this.onDidChangeLensesEmitter.fire();
  }
  hover(file, hunk) {
    const md = new vscode4.MarkdownString();
    md.appendMarkdown(`**Jarvis proposes** \xB7 \`${file.path}\` \xB7 +${hunk.added} \u2212${hunk.removed}

`);
    if (hunk.removedText.length > 0) {
      md.appendCodeblock(hunk.removedText.map((l) => `- ${l}`).join("\n"), "diff");
    }
    if (hunk.addedText.length > 0) {
      md.appendCodeblock(hunk.addedText.map((l) => `+ ${l}`).join("\n"), "diff");
    }
    return md;
  }
  lensesFor(document) {
    const file = this.fileFor(document);
    if (!file || !this.state) return [];
    const lenses = [];
    file.hunks.forEach((hunk, index) => {
      if (this.state?.dismissed.has(hunkKey(document.uri, index))) return;
      const anchor = addedRuns(hunk)[0]?.startLine ?? hunkRange(hunk).startLine;
      const line = Math.min(Math.max(anchor - 1, 0), document.lineCount - 1);
      const range = new vscode4.Range(line, 0, line, 0);
      const args = [{ uri: document.uri.toString(), hunkIndex: index, path: file.path }];
      lenses.push(
        new vscode4.CodeLens(range, {
          title: `$(check) Accept  +${hunk.added} \u2212${hunk.removed}`,
          command: "jarvis.ghost.accept",
          arguments: args
        }),
        new vscode4.CodeLens(range, {
          title: "$(x) Reject",
          command: "jarvis.ghost.reject",
          arguments: args
        }),
        new vscode4.CodeLens(range, {
          title: "$(info) Why",
          command: "jarvis.ghost.why",
          arguments: args
        })
      );
    });
    return lenses;
  }
  resolve(arg) {
    if (!this.state || typeof arg !== "object" || arg === null) return void 0;
    const { uri, hunkIndex } = arg;
    if (typeof uri !== "string" || typeof hunkIndex !== "number") return void 0;
    const parsed = vscode4.Uri.parse(uri);
    const document = vscode4.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    if (!document) return void 0;
    const file = findDiffFile(this.state.summary, parsed.fsPath);
    const hunk = file?.hunks[hunkIndex];
    if (!file || !hunk) return void 0;
    return { document, file, hunk, index: hunkIndex };
  }
  /**
   * Applies the hunk to the open buffer. The old lines come from the patch's
   * `-` side, so we only replace when the buffer actually still holds them —
   * a drifted file gets an honest warning instead of a mangled edit.
   */
  async accept(arg) {
    const resolved = this.resolve(arg);
    if (!resolved) return;
    const { document, hunk, index } = resolved;
    const start = Math.max(hunk.oldStart - 1, 0);
    const end = Math.min(start + hunk.oldLines, document.lineCount);
    if (start >= document.lineCount) {
      void vscode4.window.showWarningMessage(
        "Jarvis: this file has moved past the proposed hunk. Open the full diff instead."
      );
      return;
    }
    const current = document.getText(new vscode4.Range(start, 0, end, 0)).replace(/\r?\n$/, "");
    const expected = hunk.removedText.join("\n");
    if (hunk.removedText.length > 0 && current.trim() !== expected.trim()) {
      const choice = await vscode4.window.showWarningMessage(
        "Jarvis: the open file no longer matches what the agent changed. Apply anyway?",
        { modal: true },
        "Apply anyway"
      );
      if (choice !== "Apply anyway") return;
    }
    const replacement = hunk.addedText.length > 0 ? `${hunk.addedText.join("\n")}
` : "";
    const edit = new vscode4.WorkspaceEdit();
    edit.replace(document.uri, new vscode4.Range(start, 0, end, 0), replacement);
    const applied = await vscode4.workspace.applyEdit(edit);
    if (!applied) {
      void vscode4.window.showErrorMessage("Jarvis: could not apply the hunk.");
      return;
    }
    this.state?.dismissed.add(hunkKey(document.uri, index));
    this.render();
  }
  /** Dismisses the ghost and offers to turn it into a repair directive. */
  async reject(arg) {
    const resolved = this.resolve(arg);
    if (!resolved) return;
    const { document, file, hunk, index } = resolved;
    this.state?.dismissed.add(hunkKey(document.uri, index));
    this.render();
    const what = await vscode4.window.showInputBox({
      title: `Jarvis \xB7 repair ${file.path}:${hunkRange(hunk).startLine}`,
      prompt: "What should Jarvis do differently here? (Esc just dismisses the ghost.)",
      placeHolder: "e.g. keep the existing error handling and add the endpoint below it",
      ignoreFocusOut: true
    });
    if (!what?.trim()) return;
    await this.seedIntent(
      `Repair ${file.path}:${hunkRange(hunk).startLine} \u2014 ${what.trim()}`
    );
  }
  /**
   * "Why" for a hunk: the goal it serves, its acceptance criteria and how the
   * evidence graded them, plus the reviewer's verdict.
   *
   * The daemon publishes no per-step plan text (`PlanCreated.v1` carries only
   * the state transition), so this is the real, sourced answer rather than a
   * fabricated step list.
   */
  async why(arg) {
    const resolved = this.resolve(arg);
    if (!resolved || !this.state) return;
    const { file, hunk } = resolved;
    const workflowId = this.state.workflowId;
    const workflow = this.store.snapshot.workflows.find((w) => w.id === workflowId);
    const goal = this.store.snapshot.goals.find((g) => g.id === workflow?.goalId);
    const manifest = await this.client.evidence(workflowId).catch(() => null);
    const lines = [
      `# Why \xB7 \`${file.path}\`:${hunkRange(hunk).startLine}`,
      "",
      `Workflow \`${workflowId.slice(-8)}\`${workflow?.branchName ? ` \xB7 branch \`${workflow.branchName}\`` : ""}`,
      "",
      "## The goal this serves",
      "",
      goal?.objective ?? goal?.title ?? "_The goal is no longer in the daemon's working set._",
      ""
    ];
    const criteria = goal?.acceptanceCriteria ?? [];
    if (criteria.length > 0) {
      lines.push("## Acceptance criteria", "");
      for (const c of criteria) lines.push(`- ${c}`);
      lines.push("");
    }
    const graded = manifest?.acceptanceCriteria ?? [];
    if (graded.length > 0) {
      lines.push("## How the evidence graded them", "");
      for (const c of graded) {
        lines.push(`- **${c.status}** \u2014 ${c.criterion}${c.note ? ` _(${c.note})_` : ""}`);
      }
      lines.push("");
    }
    const review = (manifest?.items ?? []).find((i) => i.kind === "report");
    if (review) {
      lines.push("## Independent review", "", `${review.title}`, "");
      if (review.summary) lines.push(`> ${review.summary}`, "");
    }
    lines.push(
      "## The hunk",
      "",
      "```diff",
      ...hunk.removedText.map((l) => `-${l}`),
      ...hunk.addedText.map((l) => `+${l}`),
      "```",
      "",
      "_Jarvis publishes no per-step plan text; this is what the goal contract and the sealed evidence actually record._"
    );
    const doc = await vscode4.workspace.openTextDocument({
      content: `${lines.join("\n")}
`,
      language: "markdown"
    });
    await vscode4.window.showTextDocument(doc, { preview: true, viewColumn: vscode4.ViewColumn.Beside });
  }
  dispose() {
    this.addedDecoration.dispose();
    this.removedDecoration.dispose();
    for (const d of this.disposables) d.dispose();
  }
};

// src/lens/lensView.ts
var vscode5 = __toESM(require("vscode"));

// src/lens/capsule.ts
var LENS_STAGES = ["Isolate", "Plan", "Build", "Verify", "Review", "Approve"];
var STATE_STAGE = {
  planned: -1,
  isolating: 0,
  planning: 1,
  executing: 2,
  verifying: 3,
  reviewing: 4,
  awaitingapproval: 5,
  completed: 6,
  failed: -2,
  cancelled: -2,
  discarded: -2
};
var EMPTY_FACTS = { agents: [], planned: false, repairRounds: 0 };
function stageIndexFor(state) {
  return STATE_STAGE[state.toLowerCase()] ?? -1;
}
function toneFor(state) {
  const lower = state.toLowerCase();
  if (lower === "awaitingapproval") return "attention";
  if (lower === "completed") return "done";
  if (lower === "planned") return "queued";
  if (TERMINAL_STATES.has(lower)) return "failed";
  return "running";
}
function stateLabelFor(state) {
  const words = {
    awaitingApproval: "Needs you",
    isolating: "Isolating",
    planning: "Planning",
    executing: "Building",
    verifying: "Verifying",
    reviewing: "Reviewing",
    completed: "Complete",
    discarded: "Discarded",
    cancelled: "Cancelled",
    failed: "Failed",
    planned: "Queued"
  };
  return words[state] ?? state.charAt(0).toUpperCase() + state.slice(1);
}
function stagesFor(stageIndex, tone) {
  return LENS_STAGES.map((name, i) => {
    if (tone === "failed") {
      if (i < stageIndex) return { name, status: "done" };
      if (i === stageIndex) return { name, status: "active" };
      return { name, status: "skipped" };
    }
    if (stageIndex >= LENS_STAGES.length) return { name, status: "done" };
    if (i < stageIndex) return { name, status: "done" };
    if (i === stageIndex) return { name, status: "active" };
    return { name, status: "pending" };
  });
}
function progressFor(state) {
  const idx = stageIndexFor(state);
  if (state.toLowerCase() === "completed") return 100;
  if (idx < 0) return 0;
  return Math.round((idx + 1) / LENS_STAGES.length * 100);
}
function toCapsule({ workflow, title, facts, approvalId }) {
  const f = facts ?? EMPTY_FACTS;
  const tone = toneFor(workflow.state);
  let stageIndex = stageIndexFor(workflow.state);
  if (stageIndex === -2) {
    stageIndex = f.reviewer ? 4 : f.implementer ? 2 : f.planned ? 1 : 0;
  }
  const implementer = f.implementer ?? null;
  const reviewer = f.reviewer ?? null;
  return {
    id: workflow.id,
    shortId: workflow.id.slice(-8),
    goalId: workflow.goalId,
    projectId: workflow.projectId,
    title,
    state: workflow.state,
    stateLabel: stateLabelFor(workflow.state),
    tone,
    stageIndex,
    stages: stagesFor(stageIndex, tone),
    progress: progressFor(workflow.state),
    branch: workflow.branchName ?? null,
    createdAt: workflow.createdAt,
    completedAt: workflow.completedAt ?? null,
    failureReason: workflow.failureReason ?? null,
    agents: f.agents.length > 0 ? f.agents : [implementer, reviewer].filter((a) => !!a),
    implementer,
    reviewer,
    independent: !!implementer && !!reviewer && implementer !== reviewer,
    repairRounds: f.repairRounds,
    // A pending approval is a decision whatever the workflow state says. The
    // integration approval parks the workflow in AwaitingApproval, but a
    // Sentinel escalation (an agent asking for `git.push`, say) can be pending
    // against a workflow that has already completed - and the human is just as
    // needed there.
    needsDecision: workflow.state === "awaitingApproval" || !!approvalId,
    approvalId: approvalId ?? null
  };
}
function sortCapsules(capsules) {
  const rank = (c) => {
    if (c.tone === "attention") return 0;
    if (c.tone === "running") return 1;
    if (c.tone === "queued") return 2;
    return 3;
  };
  return [...capsules].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
function pillStateFor(online, capsules, pendingApprovals) {
  if (!online) {
    return { state: "offline", label: "Jarvis", detail: "daemon offline", progress: 0 };
  }
  const needsYou = capsules.filter((c) => c.needsDecision);
  if (needsYou.length > 0 || pendingApprovals > 0) {
    const count = Math.max(needsYou.length, pendingApprovals);
    return {
      state: "attention",
      label: count === 1 ? "Needs you" : `${count} need you`,
      detail: needsYou[0]?.title ?? "approval waiting",
      progress: 100
    };
  }
  const running = capsules.filter((c) => c.tone === "running");
  if (running.length > 0) {
    const lead = running[0];
    return {
      state: "working",
      label: lead.stateLabel,
      detail: lead.title,
      progress: lead.progress
    };
  }
  return { state: "idle", label: "Jarvis", detail: "ready", progress: 0 };
}

// src/lens/evidence.ts
var KIND_LABEL = {
  build: "build",
  test: "tests",
  lint: "lint",
  diff: "diff",
  report: "review",
  log: "log"
};
function normalizeOutcome(outcome) {
  switch (outcome.toLowerCase()) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    default:
      return "info";
  }
}
function toEvidenceChips(manifest) {
  const items = manifest?.items ?? [];
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    label: KIND_LABEL[item.kind.toLowerCase()] ?? item.kind,
    outcome: normalizeOutcome(item.outcome),
    detail: item.summary ?? item.title,
    hash: item.artifact ? item.artifact.sha256.slice(0, 12) : null
  }));
}
function toAcceptance(manifest) {
  return (manifest?.acceptanceCriteria ?? []).map((c) => ({
    criterion: c.criterion,
    status: c.status,
    note: c.note ?? null
  }));
}
function reviewerFromEvidence(manifest) {
  for (const item of manifest?.items ?? []) {
    const match = /independent review by ([\w.-]+)/i.exec(item.title);
    if (match) return match[1];
  }
  return null;
}

// src/lens/routeSignals.ts
var LOCAL_MODEL_SOURCE = "local-model";
var RAISED_RISK = /^local model \(([^)]*)\) raised risk (\S+) → (\S+)/i;
var RAISED_CLASS = /^local model \(([^)]*)\) raised (\S+) → (\S+)/i;
var AGREED = /^local model \(([^)]*)\) agreed on (\S+)/i;
var DEFERRED_RISK = /^local model \(([^)]*)\) suggested risk (\S+); ignored/i;
var DEFERRED_CLASS = /^local model \(([^)]*)\) suggested (\S+); ignored/i;
function titleCase(value) {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
function localModelVerdict(facts) {
  const classification = facts?.classification;
  if (!classification) return null;
  const signals = classification.signals ?? [];
  const lines = signals.filter((line) => typeof line === "string" && /^local model \(/i.test(line));
  const find = (pattern) => {
    for (const line of lines) {
      const match = pattern.exec(line);
      if (match !== null) return { line, match };
    }
    return null;
  };
  const raisedRisk = find(RAISED_RISK);
  if (raisedRisk !== null) {
    return {
      kind: "raised",
      text: `Local model raised the risk to ${titleCase(raisedRisk.match[3])}`,
      tone: "warn",
      detail: raisedRisk.line
    };
  }
  const raisedClass = find(RAISED_CLASS);
  if (raisedClass !== null) {
    return {
      kind: "raised",
      text: `Local model raised this to ${titleCase(raisedClass.match[3])}`,
      tone: "warn",
      detail: raisedClass.line
    };
  }
  const agreed = find(AGREED);
  if (agreed !== null) {
    return {
      kind: "agreed",
      text: `Local model agreed on ${titleCase(agreed.match[2])}`,
      tone: "ok",
      detail: agreed.line
    };
  }
  const deferredRisk = find(DEFERRED_RISK);
  if (deferredRisk !== null) {
    return {
      kind: "deferred",
      text: `Local model read the risk lower (${titleCase(deferredRisk.match[2])}) \u2014 risk never ratchets down`,
      tone: "neutral",
      detail: deferredRisk.line
    };
  }
  const deferredClass = find(DEFERRED_CLASS);
  if (deferredClass !== null) {
    return {
      kind: "deferred",
      text: `Local model read this as ${titleCase(deferredClass.match[2])} \u2014 the stronger call stands`,
      tone: "neutral",
      detail: deferredClass.line
    };
  }
  if ((classification.source ?? "").toLowerCase() === LOCAL_MODEL_SOURCE) {
    return {
      kind: "agreed",
      text: "Local model weighed in",
      tone: "neutral",
      detail: `classification.source = ${classification.source}`
    };
  }
  return null;
}
function routeFingerprint(facts) {
  if (!facts) return "\u2205";
  const c = facts.classification ?? {};
  const s = facts.selected ?? {};
  const cost = facts.estimatedCostUsd ?? s.estimatedCostUsd ?? null;
  return [
    c.class ?? "",
    c.risk ?? "",
    s.adapterId ?? "",
    s.model ?? "",
    s.tier ?? "",
    cost === null ? "" : cost.toFixed(4),
    facts.estimateBasis ?? ""
  ].join("|");
}

// src/lens/routing.ts
var TITLE_CASE = {
  trivial: "Trivial change",
  standard: "Standard change",
  complex: "Complex change",
  risky: "Risky change",
  research: "Research",
  review: "Review"
};
var ETA_MINUTES = {
  trivial: 2,
  standard: 6,
  complex: 18,
  risky: 22,
  research: 10,
  review: 4
};
function formatCost(value) {
  if (value === null || value === void 0 || !Number.isFinite(value)) return "cost n/a";
  if (value === 0) return "free";
  if (value < 0.01) return "<$0.01";
  return `~$${value.toFixed(2)}`;
}
function titleCase2(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function riskTone(risk) {
  switch (risk.toLowerCase()) {
    case "high":
    case "critical":
      return "danger";
    case "medium":
      return "warn";
    case "low":
      return "ok";
    default:
      return "neutral";
  }
}
function toRoutePreview(decision) {
  const classification = decision.classification ?? {};
  const selected = decision.selected ?? {};
  const taskClass = (classification.class ?? "standard").toLowerCase();
  const risk = classification.risk ?? "low";
  const agentId = selected.adapterId ?? "unrouted";
  const model = selected.model ?? selected.modelFamily ?? "adapter default";
  const tier = titleCase2(selected.tier ?? "unknown");
  const mode = (selected.mode ?? "cloud").toLowerCase();
  const localOnly = mode === "local" || (classification.data ?? "").toLowerCase() === "localonly";
  const cost = decision.estimatedCostUsd ?? selected.estimatedCostUsd ?? null;
  const costLabel = formatCost(cost);
  const eta = ETA_MINUTES[taskClass] ?? 6;
  const etaLabel = `~${eta} min`;
  const chips = [
    {
      id: "class",
      label: "shape",
      value: TITLE_CASE[taskClass] ?? titleCase2(taskClass),
      tone: "accent"
    },
    { id: "risk", label: "risk", value: titleCase2(risk), tone: riskTone(risk) },
    { id: "agent", label: titleCase2(decision.role ?? "implementer"), value: agentId, tone: "neutral" },
    { id: "model", label: tier, value: model, tone: "neutral" },
    { id: "cost", label: "cost", value: costLabel, tone: cost !== null && cost > 1 ? "warn" : "neutral" },
    { id: "eta", label: "time", value: etaLabel, tone: "neutral" },
    {
      id: "locality",
      label: "runs",
      value: localOnly ? "on this machine" : "in the cloud",
      tone: localOnly ? "ok" : "neutral"
    }
  ];
  const headline = `${TITLE_CASE[taskClass] ?? titleCase2(taskClass)} \xB7 ${agentId} ${(decision.role ?? "implements").toLowerCase() === "reviewer" ? "reviews" : "implements"} \xB7 ${costLabel} \xB7 ${etaLabel}`;
  return {
    headline,
    chips,
    agentId,
    model,
    tier,
    mode,
    localOnly,
    costUsd: cost,
    costLabel,
    etaLabel,
    rationale: decision.rationale ?? [],
    signals: classification.signals ?? [],
    source: classification.source ?? "heuristic",
    localModel: localModelVerdict(decision),
    fingerprint: routeFingerprint(decision)
  };
}

// src/lens/lensView.ts
var LENS_VIEW_ID = "jarvis.lens";
var SUGGESTIONS = [
  "Add a /health endpoint returning service status",
  "Write tests for the module I have open",
  "Explain what changed on this branch"
];
function nonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
function actorId2() {
  return process.env.USERNAME ?? process.env.USER ?? "forge";
}
var LensViewProvider = class {
  constructor(context, client, store, launcher, ghost, showOutput) {
    this.context = context;
    this.client = client;
    this.store = store;
    this.launcher = launcher;
    this.ghost = ghost;
    this.showOutput = showOutput;
    this.disposables.push(store.onDidChange(() => this.pushSnapshot()));
  }
  view;
  disposables = [];
  routeFastAbort;
  routeFullAbort;
  expanded = null;
  sheetWorkflowId = null;
  /** workflowId -> parsed patch, so the ghost diffs and the sheet share one fetch. */
  diffCache = /* @__PURE__ */ new Map();
  costCache = /* @__PURE__ */ new Map();
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode5.Uri.joinPath(this.context.extensionUri)]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(
      (message) => void this.onMessage(message),
      void 0,
      this.disposables
    );
    view.onDidDispose(() => this.view = void 0, void 0, this.disposables);
    view.onDidChangeVisibility(
      () => {
        if (view.visible) this.pushSnapshot();
      },
      void 0,
      this.disposables
    );
  }
  /** Reveals the Lens and puts the caret in the Intent Bar. */
  async focusIntent() {
    await vscode5.commands.executeCommand(`${LENS_VIEW_ID}.focus`);
    this.post({ type: "focusIntent" });
  }
  /** Drops a directive into the Intent Bar without engaging it. */
  async seedIntent(directive) {
    await vscode5.commands.executeCommand(`${LENS_VIEW_ID}.focus`);
    this.post({ type: "seedIntent", directive });
  }
  post(message) {
    void this.view?.webview.postMessage(message);
  }
  // --- snapshot ------------------------------------------------------------
  /** The capsules for this workspace, newest and most urgent first. */
  capsules() {
    const snap = this.store.snapshot;
    const project = this.store.workspaceProject;
    const titles = new Map(snap.goals.map((g) => [g.id, g.title]));
    const approvalByWorkflow = new Map(
      snap.approvals.filter((a) => a.workflowId).map((a) => [a.workflowId, a.id])
    );
    const scoped = project ? snap.workflows.filter((w) => w.projectId === project.id) : snap.workflows;
    return sortCapsules(
      scoped.map(
        (workflow) => toCapsule({
          workflow,
          title: titles.get(workflow.goalId) ?? `Workflow ${workflow.id.slice(-8)}`,
          facts: this.store.factsOf(workflow.id),
          approvalId: approvalByWorkflow.get(workflow.id) ?? null
        })
      )
    );
  }
  snapshot() {
    const snap = this.store.snapshot;
    const project = this.store.workspaceProject;
    return {
      online: snap.online,
      connecting: snap.connecting,
      projectName: project?.name ?? null,
      projectId: project?.id ?? null,
      workspaceRegistered: project !== null,
      capsules: this.capsules(),
      pendingApprovals: snap.approvals.length,
      agentsOnline: snap.agents.filter((a) => a.available).length,
      sessionCostUsd: snap.costs?.totalCostUsd ?? null,
      suggestions: SUGGESTIONS,
      daemonVersion: snap.status?.version ?? null
    };
  }
  pushSnapshot() {
    if (!this.view) return;
    this.post({ type: "snapshot", snapshot: this.snapshot() });
    if (this.expanded) void this.pushDetail(this.expanded);
    if (this.sheetWorkflowId) void this.pushSheet(this.sheetWorkflowId);
  }
  // --- messages ------------------------------------------------------------
  async onMessage(message) {
    switch (message.type) {
      case "ready":
        this.pushSnapshot();
        return;
      case "route":
        return this.previewRoute(message.token, message.tier, message.directive);
      case "engage":
        return this.engage(message.directive, message.planOnly);
      case "expand":
        this.expanded = message.workflowId;
        if (message.workflowId) await this.pushDetail(message.workflowId);
        return;
      case "openSheet":
        this.sheetWorkflowId = message.workflowId;
        if (message.workflowId) await this.pushSheet(message.workflowId);
        else this.post({ type: "sheet", sheet: null });
        return;
      case "decide":
        return this.decide(message.approvalId, message.approved);
      case "repair":
        return this.repair(message.workflowId, message.text);
      case "openDiff":
        await vscode5.commands.executeCommand("jarvis.showDiff", { workflowId: message.workflowId });
        return;
      case "openEvidence":
        await vscode5.commands.executeCommand("jarvis.showEvidence", {
          workflowId: message.workflowId
        });
        return;
      case "cancel":
        return this.guard(async () => {
          await this.client.cancelWorkflow(message.workflowId);
          this.toast("warn", `Cancelled ${message.workflowId.slice(-8)}.`);
        });
      case "ghost":
        return this.toggleGhost(message.workflowId, message.on);
      case "register":
        await vscode5.commands.executeCommand("jarvis.registerWorkspace");
        return;
      case "startDaemon":
        await this.launcher.start();
        return;
    }
  }
  toast(tone, text) {
    this.post({ type: "toast", tone, text });
  }
  async guard(fn) {
    try {
      await fn();
      await this.store.refresh();
    } catch (err) {
      this.toast("danger", err instanceof Error ? err.message : String(err));
    }
  }
  // --- intent --------------------------------------------------------------
  /**
   * Live route preview, in two tiers. The webview decides *when* each tier is
   * worth asking for (`previewScheduler`); this side just answers, echoing the
   * token and tier so an out-of-order or superseded reply is dropped rather
   * than flickering an older route onto the strip.
   *
   * The two tiers get their own abort slots: a `fast` call must not cancel the
   * `full` call that is deliberately running behind it.
   */
  async previewRoute(token, tier, directive) {
    const slot = tier === "fast" ? "routeFastAbort" : "routeFullAbort";
    this[slot]?.abort();
    if (!directive.trim()) {
      this.post({ type: "route", token, tier, preview: null, error: null });
      return;
    }
    const controller = new AbortController();
    this[slot] = controller;
    try {
      const projectId = this.store.workspaceProject?.id;
      const decision = await this.client.explainRoute(
        directive.trim(),
        { ...projectId ? { projectId } : {}, fast: tier === "fast" },
        controller.signal
      );
      this.post({ type: "route", token, tier, preview: toRoutePreview(decision), error: null });
    } catch (err) {
      if (controller.signal.aborted) return;
      this.post({
        type: "route",
        token,
        tier,
        preview: null,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  async engage(directive, planOnly) {
    const trimmed = directive.trim();
    if (!trimmed) return;
    const project = this.store.workspaceProject;
    if (!project) {
      this.toast("warn", "Register this workspace as a Jarvis project first.");
      return;
    }
    this.post({ type: "busy", busy: true, message: "Engaging\u2026" });
    try {
      const goal = await this.client.createGoal({
        project: project.id,
        title: trimmed.length > 80 ? `${trimmed.slice(0, 77)}\u2026` : trimmed,
        objective: trimmed,
        skipPlanning: false
      });
      if (planOnly) {
        this.toast("ok", "Goal captured. Run it from the river when you are ready.");
      } else {
        const workflow = await this.client.runGoal(goal.id);
        this.expanded = workflow.id;
        this.toast("ok", `Engaged \xB7 ${workflow.id.slice(-8)}`);
        this.showOutput();
      }
      await this.store.refresh();
    } catch (err) {
      this.toast("danger", err instanceof Error ? err.message : String(err));
    } finally {
      this.post({ type: "busy", busy: false });
    }
  }
  // --- capsule detail ------------------------------------------------------
  async diffFor(workflowId) {
    const cached = this.diffCache.get(workflowId);
    if (cached) return cached;
    const patch = await this.client.diff(workflowId).catch(() => null);
    const summary = parseUnifiedDiff(patch ?? "");
    this.diffCache.set(workflowId, summary);
    return summary;
  }
  async pushDetail(workflowId) {
    this.post({
      type: "detail",
      detail: {
        workflowId,
        diffSummary: "",
        files: [],
        chips: [],
        acceptance: [],
        activity: [],
        manifestHash: null,
        loading: true
      }
    });
    const [manifest, diff] = await Promise.all([
      this.client.evidence(workflowId).catch(() => null),
      this.diffFor(workflowId)
    ]);
    const facts = this.store.factsOf(workflowId);
    const detail = {
      workflowId,
      diffSummary: describeDiff(diff),
      files: diff.files.map((f) => ({
        path: f.path,
        status: f.status,
        added: f.added,
        removed: f.removed
      })),
      chips: toEvidenceChips(manifest),
      acceptance: toAcceptance(manifest),
      activity: facts.lastEventLabel ? [{ at: facts.lastEventAt ?? "", text: facts.lastEventLabel }] : [],
      manifestHash: manifest?.manifestHash ?? null,
      loading: false
    };
    this.post({ type: "detail", detail });
  }
  // --- decision sheet ------------------------------------------------------
  async costEstimate(title) {
    const cached = this.costCache.get(title);
    if (cached) return cached;
    try {
      const decision = await this.client.explainRoute(title, {
        projectId: this.store.workspaceProject?.id
      });
      const label = formatCost(decision.estimatedCostUsd ?? decision.selected?.estimatedCostUsd);
      this.costCache.set(title, label);
      return label;
    } catch {
      return "cost n/a";
    }
  }
  async pushSheet(workflowId) {
    const capsule = this.capsules().find((c) => c.id === workflowId);
    if (!capsule) {
      this.post({ type: "sheet", sheet: null });
      return;
    }
    const approval = this.store.snapshot.approvals.find((a) => a.workflowId === workflowId) ?? null;
    const [manifest, diff, costLabel] = await Promise.all([
      this.client.evidence(workflowId).catch(() => null),
      this.diffFor(workflowId),
      this.costEstimate(capsule.title)
    ]);
    const sheet = {
      workflowId,
      approvalId: approval?.id ?? null,
      title: capsule.title,
      summary: approval?.summary ?? capsule.stateLabel,
      risk: approval?.risk ?? "low",
      branch: capsule.branch,
      diffSummary: describeDiff(diff),
      files: diff.files.map((f) => ({
        path: f.path,
        status: f.status,
        added: f.added,
        removed: f.removed
      })),
      chips: toEvidenceChips(manifest),
      acceptance: toAcceptance(manifest),
      independence: {
        implementer: capsule.implementer,
        reviewer: capsule.reviewer ?? reviewerFromEvidence(manifest),
        independent: capsule.independent || !!capsule.implementer && reviewerFromEvidence(manifest) !== null && reviewerFromEvidence(manifest) !== capsule.implementer
      },
      costLabel,
      // No pending approval means the record is history: show it, do not offer
      // to resolve something the daemon has already closed.
      resolved: approval === null,
      manifestHash: manifest?.manifestHash ?? null
    };
    this.post({ type: "sheet", sheet });
  }
  async decide(approvalId, approved) {
    await this.guard(async () => {
      await this.client.resolveApproval(approvalId, approved, actorId2());
      this.sheetWorkflowId = null;
      this.post({ type: "sheet", sheet: null });
      this.toast(
        approved ? "ok" : "warn",
        approved ? "Approved. The jarvis/* branch is kept; merge when you are ready." : "Denied. Worktree and branch removed; evidence retained."
      );
    });
  }
  /**
   * "Ask for repair" is deliberately NOT a deny.
   *
   * The daemon exposes no repair endpoint — `POST /api/v1/approvals/{id}` only
   * approves (keep the branch) or denies (destroy the worktree AND the branch).
   * Routing a repair request through deny would throw the work away, which is
   * the opposite of what the button says. So a repair is expressed the only
   * honest way available: as a follow-up directive, pre-composed with the
   * workflow reference and dropped into the Intent Bar. The approval stays
   * pending and one keystroke engages the repair.
   */
  async repair(workflowId, text) {
    const capsule = this.capsules().find((c) => c.id === workflowId);
    const reference = capsule?.branch ? `branch ${capsule.branch}` : `workflow ${workflowId.slice(-8)}`;
    const directive = `Repair ${reference}: ${text.trim()}`;
    await this.seedIntent(directive);
    this.toast("warn", "Repair drafted in the intent bar \u2014 press Enter to engage it.");
  }
  async toggleGhost(workflowId, on) {
    if (!on) {
      this.ghost.clear();
      return;
    }
    const diff = await this.diffFor(workflowId);
    this.ghost.show(workflowId, diff);
  }
  /** Drops the cached patch so the next open re-reads it from the daemon. */
  invalidate(workflowId) {
    this.diffCache.delete(workflowId);
  }
  html(webview) {
    const script = webview.asWebviewUri(
      vscode5.Uri.joinPath(this.context.extensionUri, "dist", "lens.js")
    );
    const style = webview.asWebviewUri(
      vscode5.Uri.joinPath(this.context.extensionUri, "dist", "lens.css")
    );
    const n = nonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${n}'`
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${style}" />
<title>Jarvis Lens</title>
</head>
<body>
<div class="ambient" aria-hidden="true"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i></div>
<main id="root"></main>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }
  dispose() {
    this.routeFastAbort?.abort();
    this.routeFullAbort?.abort();
    for (const d of this.disposables) d.dispose();
  }
};

// src/lens/pill.ts
var vscode6 = __toESM(require("vscode"));
var LensPill = class {
  constructor(store, capsulesOf) {
    this.capsulesOf = capsulesOf;
    this.render(store.snapshot);
    this.disposables.push(store.onDidChange((snap) => this.render(snap)));
  }
  disposables = [];
  last = "";
  render(snap) {
    const pill = pillStateFor(snap.online, this.capsulesOf(), snap.approvals.length);
    const signature = `${pill.state}|${pill.label}|${pill.detail}|${pill.progress}`;
    if (signature === this.last) return;
    this.last = signature;
    void vscode6.commands.executeCommand("setContext", "jarvis.lens.state", pill.state);
    void vscode6.commands.executeCommand("setContext", "jarvis.lens.label", pill.label);
    void vscode6.commands.executeCommand("setContext", "jarvis.lens.detail", pill.detail);
    void vscode6.commands.executeCommand("setContext", "jarvis.lens.progress", pill.progress);
  }
  dispose() {
    for (const d of this.disposables) d.dispose();
    void vscode6.commands.executeCommand("setContext", "jarvis.lens.state", "offline");
  }
};

// src/pollService.ts
var vscode7 = __toESM(require("vscode"));
var PollService = class {
  constructor(store, client) {
    this.store = store;
    this.client = client;
    this.output = vscode7.window.createOutputChannel("Jarvis Forge");
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
          const material = this.store.ingestEvents(batch);
          if (material) this.store.touch();
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
var vscode8 = __toESM(require("vscode"));
var StatusBar = class {
  item;
  constructor(store) {
    this.item = vscode8.window.createStatusBarItem(vscode8.StatusBarAlignment.Left, 100);
    this.item.command = "jarvis.workflows.focus";
    this.render(store.snapshot);
    this.item.show();
    store.onDidChange((snap) => this.render(snap));
  }
  render(snap) {
    if (!snap.online && snap.connecting) {
      this.item.text = "$(sync~spin) Jarvis: starting daemon\u2026";
      this.item.tooltip = "Waiting for jarvisd to answer the health probe.";
      this.item.backgroundColor = new vscode8.ThemeColor("statusBarItem.warningBackground");
      this.item.command = "jarvis.startDaemon";
      return;
    }
    if (!snap.online) {
      this.item.text = "$(debug-disconnect) Jarvis: daemon offline";
      this.item.tooltip = "jarvisd is not reachable. Click to start it (Jarvis: Start Daemon).";
      this.item.backgroundColor = new vscode8.ThemeColor("statusBarItem.warningBackground");
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
var vscode9 = __toESM(require("vscode"));

// src/lens/facts.ts
function ensure(map, workflowId) {
  const existing = map[workflowId];
  if (existing) return existing;
  const created = { ...EMPTY_FACTS, agents: [] };
  map[workflowId] = created;
  return created;
}
function stringField(event, key) {
  const value = (event.data ?? {})[key];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function applyEvent(map, event) {
  const workflowId = stringField(event, "workflowId") ?? event.correlationId;
  if (!workflowId || !workflowId.startsWith("wf_")) return false;
  const facts = ensure(map, workflowId);
  facts.lastEventAt = event.occurredAt;
  switch (event.eventType) {
    case "AgentSelected.v1": {
      const agentId = stringField(event, "agentId");
      const role = (stringField(event, "role") ?? "").toLowerCase();
      if (!agentId) return false;
      if (!facts.agents.includes(agentId)) facts.agents.push(agentId);
      if (role === "reviewer") facts.reviewer = agentId;
      else if (role === "implementer") facts.implementer = agentId;
      facts.lastEventLabel = `router \u2192 ${agentId}`;
      return true;
    }
    case "PlanCreated.v1":
      facts.planned = true;
      facts.lastEventLabel = "plan sealed";
      return true;
    case "ReviewRepairRequested.v1":
      facts.repairRounds += 1;
      facts.lastEventLabel = `repair round ${facts.repairRounds}`;
      return true;
    case "WorkspaceIsolated.v1":
      facts.lastEventLabel = "worktree isolated";
      return true;
    case "VerificationCompleted.v1":
      facts.lastEventLabel = "verification green";
      return true;
    case "ReviewCompleted.v1":
      facts.lastEventLabel = "review complete";
      return true;
    case "EvidencePublished.v1":
      facts.lastEventLabel = "evidence sealed";
      return true;
    default:
      return false;
  }
}
function applyEvents(map, events) {
  let changed = false;
  for (const event of events) {
    if (applyEvent(map, event)) changed = true;
  }
  return changed;
}
function factsFor(map, workflowId) {
  return map[workflowId] ?? EMPTY_FACTS;
}

// src/store.ts
var EMPTY = {
  online: false,
  connecting: false,
  status: null,
  projects: [],
  workflows: [],
  approvals: [],
  agents: [],
  goals: [],
  costs: null
};
function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
var Store = class {
  constructor(client) {
    this.client = client;
  }
  emitter = new vscode9.EventEmitter();
  onDidChange = this.emitter.event;
  current = EMPTY;
  facts = {};
  get snapshot() {
    return this.current;
  }
  /**
   * The registered project whose root contains (or equals) the open folder.
   * Longest match wins so a nested project beats its parent.
   */
  get workspaceProject() {
    const folders = vscode9.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return null;
    let best = null;
    for (const folder of folders) {
      const open = normalizePath(folder.uri.fsPath);
      for (const project of this.current.projects) {
        const root = normalizePath(project.rootPath);
        if (open === root || open.startsWith(`${root}/`) || root.startsWith(`${open}/`)) {
          if (!best || root.length > normalizePath(best.rootPath).length) best = project;
        }
      }
    }
    return best;
  }
  factsOf(workflowId) {
    return factsFor(this.facts, workflowId);
  }
  /** Folds the event batch into the per-workflow facts. True when a redraw is warranted. */
  ingestEvents(events) {
    return applyEvents(this.facts, events);
  }
  async refresh() {
    try {
      const [status, projects, workflows, approvals, agents, costs] = await Promise.all([
        this.client.status(),
        this.client.projects(),
        this.client.workflows(),
        this.client.approvals(),
        this.client.agents(),
        this.client.costs().catch(() => null)
      ]);
      this.current = {
        online: true,
        connecting: false,
        status,
        projects,
        workflows,
        approvals,
        agents,
        goals: this.current.goals,
        costs
      };
      const project = this.workspaceProject;
      this.current = {
        ...this.current,
        goals: project ? await this.client.goals(project.id).catch(() => []) : []
      };
    } catch {
      this.current = { ...EMPTY, online: false, connecting: this.current.connecting };
    }
    this.emitter.fire(this.current);
  }
  /** Re-publishes the current snapshot without hitting the daemon. */
  touch() {
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
var vscode10 = __toESM(require("vscode"));
var ApprovalItem = class extends vscode10.TreeItem {
  constructor(approval) {
    super(approval.summary.split(" \u2014 ")[0] ?? approval.summary, vscode10.TreeItemCollapsibleState.None);
    this.approval = approval;
    this.description = approval.risk;
    this.tooltip = approval.summary;
    this.contextValue = "jarvisApproval";
    this.iconPath = new vscode10.ThemeIcon(
      "clock",
      new vscode10.ThemeColor("notificationsWarningIcon.foreground")
    );
    this.id = `approval:${approval.id}`;
  }
};
var ApprovalsView = class {
  constructor(store) {
    this.store = store;
    store.onDidChange(() => this.emitter.fire());
  }
  emitter = new vscode10.EventEmitter();
  onDidChangeTreeData = this.emitter.event;
  getTreeItem(element) {
    return element;
  }
  getChildren() {
    const snap = this.store.snapshot;
    if (!snap.online) {
      const item = new vscode10.TreeItem("Daemon offline", vscode10.TreeItemCollapsibleState.None);
      item.iconPath = new vscode10.ThemeIcon("debug-disconnect");
      return [item];
    }
    if (snap.approvals.length === 0) {
      const item = new vscode10.TreeItem("Nothing waiting on you", vscode10.TreeItemCollapsibleState.None);
      item.iconPath = new vscode10.ThemeIcon("check-all");
      return [item];
    }
    return snap.approvals.map((a) => new ApprovalItem(a));
  }
};

// src/views/projectsView.ts
var vscode11 = __toESM(require("vscode"));
var ProjectItem = class extends vscode11.TreeItem {
  constructor(project) {
    super(project.name, vscode11.TreeItemCollapsibleState.Collapsed);
    this.project = project;
    this.description = project.buildProfile?.kind ?? "no build profile";
    this.tooltip = `${project.rootPath}
branch: ${project.defaultBranch}`;
    this.contextValue = "jarvisProject";
    this.iconPath = new vscode11.ThemeIcon("repo");
    this.id = `project:${project.id}`;
  }
};
var GoalItem = class extends vscode11.TreeItem {
  constructor(goal) {
    super(goal.title, vscode11.TreeItemCollapsibleState.None);
    this.goal = goal;
    this.description = goal.status;
    this.contextValue = "jarvisGoal";
    this.iconPath = new vscode11.ThemeIcon("target");
    this.id = `goal:${goal.id}`;
  }
};
var ProjectsView = class {
  constructor(store) {
    this.store = store;
    store.onDidChange(() => this.emitter.fire());
  }
  emitter = new vscode11.EventEmitter();
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
  const item = new vscode11.TreeItem("Daemon offline", vscode11.TreeItemCollapsibleState.None);
  item.iconPath = new vscode11.ThemeIcon("debug-disconnect");
  item.description = "start jarvisd";
  return item;
}
function hint(label, command) {
  const item = new vscode11.TreeItem(label, vscode11.TreeItemCollapsibleState.None);
  item.iconPath = new vscode11.ThemeIcon("info");
  if (command) item.command = { command, title: label };
  return item;
}

// src/views/workflowsView.ts
var vscode12 = __toESM(require("vscode"));
var WorkflowItem = class extends vscode12.TreeItem {
  constructor(workflow) {
    super(shortId(workflow), vscode12.TreeItemCollapsibleState.None);
    this.workflow = workflow;
    this.description = workflowDescription(workflow);
    this.tooltip = buildTooltip(workflow);
    const active = isActiveWorkflow(workflow);
    this.contextValue = active ? "jarvisWorkflowActive" : "jarvisWorkflowDone";
    const { icon, color } = workflowIcon(workflow.state);
    this.iconPath = new vscode12.ThemeIcon(icon, color ? new vscode12.ThemeColor(color) : void 0);
    this.id = `workflow:${workflow.id}`;
  }
};
var WorkflowsView = class {
  constructor(store) {
    this.store = store;
    store.onDidChange(() => this.emitter.fire());
  }
  emitter = new vscode12.EventEmitter();
  onDidChangeTreeData = this.emitter.event;
  getTreeItem(element) {
    return element;
  }
  getChildren() {
    const snap = this.store.snapshot;
    if (!snap.online) {
      const item = new vscode12.TreeItem("Daemon offline", vscode12.TreeItemCollapsibleState.None);
      item.iconPath = new vscode12.ThemeIcon("debug-disconnect");
      return [item];
    }
    if (snap.workflows.length === 0) {
      const item = new vscode12.TreeItem("No workflows \u2014 engage a directive", vscode12.TreeItemCollapsibleState.None);
      item.iconPath = new vscode12.ThemeIcon("info");
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
  let lens;
  const ghost = new GhostDiffController(client, store, (directive) => lens.seedIntent(directive));
  lens = new LensViewProvider(context, client, store, launcher, ghost, () => poll.show());
  context.subscriptions.push(
    store,
    poll,
    launcher,
    ghost,
    lens,
    new StatusBar(store),
    new LensPill(store, () => lens.capsules()),
    vscode13.window.registerWebviewViewProvider(LENS_VIEW_ID, lens, {
      // The Lens holds a typed directive and an open decision sheet; losing
      // either because the user glanced at another view would be hostile.
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode13.window.registerTreeDataProvider("jarvis.projects", new ProjectsView(store)),
    vscode13.window.registerTreeDataProvider("jarvis.workflows", new WorkflowsView(store)),
    vscode13.window.registerTreeDataProvider("jarvis.approvals", new ApprovalsView(store)),
    ...registerCommands(client, store, () => poll.show(), launcher, lens, ghost)
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
