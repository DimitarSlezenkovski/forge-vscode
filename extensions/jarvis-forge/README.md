# Jarvis Forge — VS Code extension

Forge is the AI-native IDE surface, built on **VS Code OSS** (ADR-0013). Rather
than rebuilding an editor, Forge is a VS Code extension: you keep VS Code's
editor, terminal, Git, search and diff, and gain Jarvis's engineering loop.

## What it adds

- **The Jarvis Lens** owns the **secondary side bar** — the primary surface, and
  the one thing to read first:
  - **Intent Bar.** Type a directive; the Model Council previews the route live
    (`GET /api/v1/routing/explain`, debounced 220 ms) as chips — shape, risk,
    which agent implements, model and tier, estimated cost, time, and whether it
    runs locally. `Enter` engages (goal + run); `Shift+Enter` captures the goal
    without running it; `Esc` clears.
  - **Flow River.** This workspace's workflows as glass capsules flowing the six
    stages *Isolate · Plan · Build · Verify · Review · Approve*, with agent orbs,
    an independence badge, the branch and the age. Click (or `Enter`) expands a
    capsule **in place** into its files, evidence chips, acceptance criteria and
    actions; `Esc` collapses it. Anything needing a decision floats to the top.
  - **Decision Sheet.** When a workflow needs you, a glass sheet rises inside the
    view: the change summary, the cost, the branch, the independence badge
    (*"claude-code built · codex reviewed"*), the evidence chips with their
    sealed hashes, and **Approve / Ask for repair / Deny**, plus a button to open
    the patch in the native diff editor.
  - Reached from anywhere with **`Ctrl+J`** (`Jarvis: Focus the Lens`).
- **Inline ghost diffs.** From an expanded capsule, *Show in editor* projects the
  agent's hunks onto your open files as glass-tinted ghost blocks with
  **Accept / Reject / Why** above each one. The agent worked in a worktree, so
  your file is untouched until *Accept* applies the hunk as an ordinary undoable
  edit — and it refuses if the buffer has drifted from what the patch removed.
  *Reject* dismisses the ghost and offers to turn it into a repair directive.
  *Why* opens the goal it serves, its acceptance criteria, how the sealed
  evidence graded them and the reviewer's verdict.
- **Activity bar → Jarvis Forge**: Projects & Goals, Workflows, Approvals — kept
  as the secondary, tree-shaped view of the same state.
- **Engage a directive** → creates a goal and runs the real workflow
  (plan → implement → verify → review → approval), pinned to an agent if you pick one.
- **Workflows** show live state + pipeline progress; **Show Diff** opens the
  cumulative patch in VS Code's native diff view.
- **Approvals** with Approve / Deny inline; the branch is kept on approve, the
  worktree removed on deny — same rules as the CLI and Command Bridge.
- **Show Evidence** renders the workflow's evidence manifest (items, artifacts,
  acceptance criteria, manifest hash) as Markdown.
- **Status bar** shows daemon reachability, the active workflow's stage, or
  pending-approval count. When jarvisd is down it reads **Jarvis: daemon
  offline** on a warning background and clicking it runs **Jarvis: Start
  Daemon**.
- **Daemon awareness**: activation probes `GET /healthz` (falling back to
  `/api/v1/status`); if the daemon is offline, Forge offers **Start daemon** /
  **Configure** once, launches jarvisd in a visible integrated terminal, then
  re-probes every 2 s for up to 60 s and flips to connected.
- **Output → Jarvis Forge** streams the live event feed (router decisions,
  evidence, review, completion).

Everything goes through the same daemon endpoints and Sentinel policy as the CLI
— the extension never bypasses the security layer.

## Develop

```bash
pnpm install
pnpm -C apps/forge-ide build      # esbuild → dist/extension.js + dist/lens.js + dist/lens.css
pnpm -C apps/forge-ide typecheck  # tsc --noEmit, twice: host and webview
pnpm -C apps/forge-ide test       # vitest (pure logic)
```

Three bundles, because the Lens webview runs in a sandboxed iframe rather than
the extension host: `src/lens/webview/**` is browser/IIFE and must never see
`vscode`, which is why it has its own `tsconfig.json` (DOM lib, `types: []`) and
why the root one excludes it. The stylesheet is built to `dist/` rather than
`media/` so the fork's hygiene does not ask a Forge-authored file to carry
Microsoft's copyright header (see `apps/forge-vscode/patches/README.md`).

The webview is locked down: `default-src 'none'`, one nonce'd script, no remote
origin, `postMessage` only, and every string it renders goes in as
`textContent`. It renders daemon data and agent-authored diff text; neither is
trusted input.

Then open `apps/forge-ide` in VS Code and press **F5** to launch an Extension
Development Host with Jarvis Forge loaded. Start the daemon first:
`dotnet run --project src/Jarvis.Host`.

Live smoke against the daemon:
`JARVIS_SMOKE=1 pnpm -C apps/forge-ide test`.

## Built-in mode (Jarvis Forge fork)

The same bundle ships as a **built-in extension** of the branded VS Code OSS
fork: `dist/`, `package.json` and `media/` are staged into the fork's
`extensions/jarvis-forge`, so the extension must stay self-contained —
`main: ./dist/extension.js`, `vscode` as the only bundled external (plus Node
builtins), and no marketplace-only manifest fields. Nothing here is
fork-specific: the identical folder still loads as a normal extension in stock
VS Code.

The fork is useless without jarvisd, so daemon awareness is part of the shell:
the activity bar entry is titled **Forge**, every command is prefixed
**Jarvis:**, and **Jarvis: Start Daemon** is always one click away from the
status bar.

## Starting the daemon from the IDE

`jarvis.startDaemon` (**Jarvis: Start Daemon**) launches jarvisd in a visible
integrated terminal, then waits for the health probe. Launch resolution, in
order:

1. the `jarvis.daemonLaunch` setting, when set — an invalid value is reported
   with a **Configure** action instead of silently falling back;
2. a workspace folder containing `src/Jarvis.Host/Jarvis.Host.csproj` →
   `dotnet run --project <that>` with that folder as cwd;
3. otherwise `jarvisd`, assumed to be on PATH.

If the daemon has not answered after 60 s you get an error with **Show
Terminal** / **Configure**.

This is a user-initiated IDE launch, so it does not pass through the daemon's
Sentinel — that gate exists for agent-issued execution. Nothing model-supplied
reaches it either: the spec is validated (bare executable name or absolute
path, string arguments, no shell metacharacters or control characters) and
spawned as an argv vector via `createTerminal({ shellPath, shellArgs })`, never
as a shell string.

## Config

- `jarvis.daemonUrl` (default `http://localhost:5178`) — the local daemon.
- `jarvis.commandBridgeUrl` (default `http://localhost:1420`) — for **Open Command Bridge**.
- `jarvis.daemonLaunch` (default unset → auto-detect) — how **Jarvis: Start
  Daemon** starts jarvisd:

  ```json
  "jarvis.daemonLaunch": {
    "command": "dotnet",
    "args": ["run", "--project", "C:\\repos\\Jarvis\\src\\Jarvis.Host\\Jarvis.Host.csproj"],
    "cwd": "C:\\repos\\Jarvis"
  }
  ```

Transport is loopback HTTP today (same trust model as the Command Bridge);
named-pipe transport behind the same `DaemonClient` interface is the hardening
path (ADR-0013, threat model T7/T10).
