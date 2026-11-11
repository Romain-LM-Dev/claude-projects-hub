import * as vscode from "vscode";
import { join } from "node:path";
import { claudeHome, hubHome } from "../core/paths.ts";
import { setupDiagnostics } from "./diagnostics.ts";
import { registerResume } from "./resume.ts";
import { openSession, SCHEME, SessionDocuments } from "./sessionDocument.ts";
import { registerTopicCommands } from "./topicCommands.ts";
import { Hub, TreeProvider } from "./tree.ts";

export function activate(context: vscode.ExtensionContext) {
  const hub = new Hub(hubHome(), claudeHome());
  const projects = new TreeProvider(hub, "projects");
  const globalMemory = new TreeProvider(hub, "global");
  const refresh = () => { hub.invalidate(); projects.fire(); globalMemory.fire(); };
  const docs = new SessionDocuments(hub.claudeHome, (m) => hub.log(m));

  // Watcher events are coalesced: one refresh per 2 s window.
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => { timer ??= setTimeout(() => { timer = undefined; refresh(); }, 2000); };
  const watch = (dir: string, glob: string) => {
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), glob));
    w.onDidCreate(schedule); w.onDidChange(schedule); w.onDidDelete(schedule);
    return w;
  };

  context.subscriptions.push(
    vscode.window.createTreeView("claudeProjectsHub.projects", { treeDataProvider: projects }),
    vscode.window.createTreeView("claudeProjectsHub.globalMemory", { treeDataProvider: globalMemory }),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, docs),
    vscode.languages.registerDocumentLinkProvider({ scheme: SCHEME }, docs),
    vscode.commands.registerCommand("claudeProjectsHub.refresh", refresh),
    vscode.commands.registerCommand("claudeProjectsHub.openSession", openSession),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("claudeProjectsHub")) projects.fire(); }),
    watch(hub.hubHome, "**/*.md"),
    watch(join(hub.claudeHome, "projects"), "**/*.jsonl"),
    { dispose: () => clearTimeout(timer) },
    ...setupDiagnostics(hub),
    ...registerResume(),
    ...registerTopicCommands(hub, refresh),
  );
  return { projects, globalMemory };
}

export function deactivate(): void {}
