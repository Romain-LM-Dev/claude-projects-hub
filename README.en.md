<div align="center">

🇬🇧 English | 🇫🇷 [Français](README.md)

</div>

# Projects Hub for Claude Code

A VS Code extension and Claude Code plugin (package `claude-projects-hub`, publisher `romain-lm-dev`). It lists the
Claude Code projects and sessions on the machine and provides topic-based memory, shared across a project's sessions
and across projects, which Claude reads and writes through an MCP server `hub` and a SessionStart hook.

Everything follows the VS Code display language: English, or French when VS Code is in French (French language pack). This covers the interface, error messages, the diagnostics log and also what Claude reads (the text injected by the hook, the MCP tool descriptions and replies): the extension writes the language to `~/.claude-projects-hub/settings.json`, the hook rereads it at each session and the MCP server when it starts (restart Claude sessions after a language change).

## Project status

Version 0.7.0 (extension and plugin). Non-commercial source-available license ([LICENSE.md](LICENSE.md)).
See [CHANGELOG.md](CHANGELOG.md). Resume point: `docs/reprise.md`. Français : [README.md](README.md).

## Features

- **Projects and sessions**: every Claude Code project on the machine and its sessions (CLI and official extension
  alike), including running sessions and subagents.
- **Topic-based memory**: project topics and global topics, as Markdown files in `~/.claude-projects-hub`, readable
  and editable by the user.
- **MCP tools** `memory_list`, `memory_read`, `memory_write` and `memory_append`, used by Claude during sessions.
- **SessionStart hook**: injects the topic index at the start of each session (4,000 characters at most). Index line
  dates are in local time.
- **Project identity**: memory follows the project when its folder is moved or renamed; orphaned Claude transcripts
  and auto-memory are reattached.
- **VS Code views**: a "Claude Hub" container with the "Projects" and "Global memory" views.

## Requirements

| Item | Version |
|---|---|
| VS Code | `^1.100.0` (`engines.vscode`) |
| Node.js | 20 or later, on the PATH (hook and MCP server); development uses Node 24 |
| Claude Code | 2.1.223 or later (CLI or official extension) |

## Installation

1. Build the package: `npm install`, `npm run build`, then `npm run package` (produces a `.vsix`).
2. Install the `.vsix` in VS Code: `code --install-extension <file>.vsix`.
3. Run the command "Claude Hub: Install the Claude integration". It checks Node, copies the plugin to
   `~/.claude-projects-hub/marketplace`, then runs `claude plugin marketplace add` and `claude plugin install`
   (plugin `projects-hub`, marketplace `projects-hub-local`).
4. If `claude` is not on the PATH, the command shows two `/plugin …` commands to type in Claude Code instead.
5. "Claude Hub: Remove the integration" uninstalls the plugin.

After an extension update, the plugin is recopied and updated in Claude Code (`claude plugin update`); running "Install the Claude integration" again does the same if `claude` was not found. Open Claude sessions keep the old version until they restart.

### Permission rule

Without a rule, Claude asks permission on every MCP tool call. The tools are named
`mcp__plugin_projects-hub_hub__memory_list`, `…_memory_read`, `…_memory_write` and `…_memory_append`. The rule
`mcp__plugin_projects-hub_hub` allows them all.

- On the developer's machine it is already in `~/.claude/settings.json`.
- Elsewhere, add it yourself to `permissions.allow`:

```json
{
  "permissions": {
    "allow": ["mcp__plugin_projects-hub_hub"]
  }
}
```

The extension never modifies this file.

## Commands

All belong to the "Claude Hub" category. "Attach to a project…", "Detach this folder", "Ignore this candidate",
"Ignore the orphan", "Copy the auto-memory", "What to do with this orphan?", "Delete session…", "Delete the orphan…" and "Delete the project…" exist only in the views' context menus, not in the command palette. Clicking an orphan opens "What to do with this orphan?".

| Command | Purpose |
|---|---|
| Refresh | rereads projects, sessions and topics |
| New topic | creates a project or global topic |
| Delete topic | sends the topic file to the trash |
| Import as topic | turns an auto-memory note into a topic |
| Resume in Claude | reopens the session in the Claude extension |
| Resume in a terminal | `claude --resume <id>` in the project folder |
| Open folder | opens the project folder |
| Attach to a project… | merges an orphan, a candidate or a clone into another project; topics are moved, a clashing slug gets a suffix |
| Detach this folder | gives the folder a fresh identity; topics stay with the original project |
| Ignore this candidate | rejects a proposed attachment |
| Ignore the orphan | hides the orphan; it can still be attached by hand |
| What to do with this orphan? | opens when you click an orphan: a dialog with what is known and the advice, then the recommended action or "Other actions…", including "Point to its new folder…" for a moved project |
| Undo the last attachment | undoes the automatic merges of the last scan; they are not redone on the next scan |
| Copy the auto-memory | copies Claude auto-memory to the new folder after confirmation; nothing is overwritten |
| Delete the project… | like "Delete the orphan…" for a registered project, plus its `.claude/projects-hub.json` marker file; the project folder stays; double confirmation (summary, then typing the exact name) |
| Delete the orphan… | after confirmation, sends an orphan's sessions, Claude folder (auto-memory included) and topics to the trash, then removes it from the hub, after a double confirmation (summary, then typing the name); never with an open session |
| Delete session… | after confirmation, sends the files of the selected sessions (or of a project / orphan) to the trash; never an open session |
| Refresh fingerprints | recomputes the projects' git fingerprints |
| Injection preview | shows the text the hook injects for this project |
| Install the Claude integration | installs the plugin (see Installation) |
| Remove the integration | uninstalls the plugin |
| Diagnostics | output channel: unreadable lines, unknown types, log tails |

Setting: `claudeProjectsHub.showTemporaryProjects` (default `false`) shows the "Temporary" node (sessions of
excluded folders).

## Project marker

On the first Claude session in a folder, the hook writes `.claude/projects-hub.json` (one identifier) at the project
root.

| Rule | Detail |
|---|---|
| Local | never versioned: in a git repository, the line `/.claude/projects-hub.json` is added to `.git/info/exclude`, never to a `.gitignore` |
| Absent | from temporary folders, the home folder, a drive root, `~/.claude` and `~/.claude-projects-hub`: only global topics are injected there |
| Clones and worktrees | separate projects, each with its own identity, unless you merge them with "Attach to a project…" |
| Folder copy | a copy that includes its marker shares the project's identity |

## Locations

| Name | Default | Variable |
|---|---|---|
| `HUB_HOME` | `~/.claude-projects-hub` | `CLAUDE_PROJECTS_HUB_HOME` |
| `CLAUDE_HOME` | `~/.claude` | `CLAUDE_CONFIG_DIR` |

`CLAUDE_HOME` is read-only, except for the auto-memory copy you confirm.

## Privacy

- Nothing leaves the machine; no network calls.
- **Global topics are injected into every project**: information about one client can reach another project. Put
  nothing confidential in them. They are visible and editable in the "Global memory" view.
- Before any topic is written, a few secret formats are refused (private keys, Anthropic keys, GitHub tokens, AWS
  keys, Slack tokens). The list is closed and does not catch everything.

## Deferred (out of v1)

Injection into subagents; UserPromptSubmit reminders; a delete tool for Claude; full-text search in transcripts; a
webview dashboard; archiving transcripts before Claude Code purges them; moving orphaned transcripts; falling back
to the Agent SDK if the JSONL format changes; syncing memory between machines; Node provided by VS Code when Node
is missing; a permission rule written by the extension; GitHub Actions CI; Marketplace publication.

## Development

```powershell
npm install
npm run typecheck
npm run build
npm test
```

| Script | Purpose |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | esbuild: `dist/extension.js`, `claude-plugin/projects-hub/dist/hook.js`, `claude-plugin/projects-hub/dist/mcp.js` |
| `npm test` | `node --test "src/**/*.test.ts"` |
| `npm run test:ext` | extension tests in a VS Code host |
| `npm run probe` | read-only probe of the real `CLAUDE_HOME` |
| `npm run package` | `.vsix` file (`vsce package --no-dependencies --skip-license`) |

## Architecture

A pure Node core (`src/core/`) is shared by three executables: the VS Code extension (`src/extension/`), the
SessionStart hook (`src/hook/`) and the stdio MCP server (`src/mcp/`). The hook and the MCP server ship as a Claude
Code plugin (`projects-hub`) served by a local marketplace.

- Contracts: [docs/architecture.md](docs/architecture.md)
- Decisions: [docs/decisions/](docs/decisions/)
- Execution plan: [docs/plan.md](docs/plan.md)

## License

Non-commercial source-available license: see [LICENSE.md](LICENSE.md). Commercial use requires written permission
from the rights holder.
