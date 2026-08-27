# Jarvis Forge — VS Code extension

Forge is the AI-native IDE surface, built on **VS Code OSS** (ADR-0013). Rather
than rebuilding an editor, Forge is a VS Code extension: you keep VS Code's
editor, terminal, Git, search and diff, and gain Jarvis's engineering loop.

## What it adds

- **Activity bar → Jarvis Forge**: Projects & Goals, Workflows, Approvals.
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
pnpm -C apps/forge-ide build      # esbuild bundle → dist/extension.js
pnpm -C apps/forge-ide typecheck  # tsc --noEmit
pnpm -C apps/forge-ide test       # vitest (pure logic)
```

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
