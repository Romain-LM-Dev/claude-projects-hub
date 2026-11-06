<div align="center">

🇬🇧 English | 🇫🇷 [Français](README.md)

</div>

# Projects Hub for Claude Code

A VS Code extension and Claude Code plugin (package `claude-projects-hub`, publisher `romain-lm-dev`). It lists the
Claude Code projects and sessions on the machine and provides topic-based memory, shared across a project's sessions
and across projects, which Claude reads and writes through an MCP server `hub` and a SessionStart hook.

## Project status

Version `0.0.1`, in development. The design is done (`docs/architecture.md`, ADRs 0001 to 0006, `docs/plan.md`) and
only the repository groundwork (task T0) is in place: the extension's activation (`src/extension/extension.ts`) is
empty and `package.json` does not declare any command or setting yet. Resume point: `docs/reprise.md`.

## Planned features (v1)

Described in `docs/architecture.md`, not implemented yet:

- **Projects and sessions**: list in VS Code every Claude Code project on the machine and its sessions (CLI and
  official extension alike), including running sessions and subagents.
- **Topic-based memory**: project topics and global topics, stored as plain Markdown files in
  `~/.claude-projects-hub`, readable and editable by the user.
- **MCP tools** `memory_list`, `memory_read`, `memory_write` and `memory_append`, used by Claude during sessions.
- **SessionStart hook**: injects the topic index at the start of each session (4,000 characters at most).
- **Project identity**: memory stays attached to the right project when its folder is moved or renamed, and Claude
  transcripts and auto-memory left orphaned are reattached.
- **VS Code views**: a "Claude Hub" container with the "Projets" and "Mémoire globale" views.
- **Privacy**: nothing leaves the machine, no network calls; a few secret formats are detected before any topic is
  written.

## Requirements

- VS Code `^1.100.0` (the `engines.vscode` field of `package.json`).
- Node.js 20 or later on the PATH for the hook and the MCP server; development uses Node 24
  (`node --test` on `.ts` files).
- Claude Code (CLI or official extension).

## Installation and build

```powershell
npm install
npm run typecheck
npm run build
npm test
```

| Script | Purpose |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | esbuild: `dist/extension.js`, `claude-plugin/projects-hub/dist/hook.js`, `claude-plugin/projects-hub/dist/mcp.js` (missing entries are skipped) |
| `npm test` | `node --test "src/**/*.test.ts"` |
| `npm run test:ext` | extension tests in a VS Code host |
| `npm run probe` | read-only probe of the real `CLAUDE_HOME` |
| `npm run package` | `.vsix` file (`vsce package --no-dependencies --skip-license`) |

The entry files for `test:ext` (`test/extension/run.ts`) and `probe` (`scripts/probe.ts`) are not written yet.

## Usage

No command or setting is declared in `package.json` yet. The planned commands (Rafraîchir, Nouveau topic, Installer
l'intégration Claude, Aperçu de l'injection, etc.) and the `claudeProjectsHub.showTemporaryProjects` setting are
described in §9 and §10 of `docs/architecture.md`.

## Architecture

A pure Node core (`src/core/`) is shared by three executables: the VS Code extension (`src/extension/`), the
SessionStart hook (`src/hook/`) and the stdio MCP server (`src/mcp/`). The hook and the MCP server ship as a Claude
Code plugin (`projects-hub`) served by a local marketplace.

- Contracts: [docs/architecture.md](docs/architecture.md)
- Decisions: [docs/decisions/](docs/decisions/)
- Execution plan: [docs/plan.md](docs/plan.md)
