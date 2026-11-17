import * as vscode from "vscode";
import { forgetProject, isSessionLive, projectFiles, sessionFiles } from "../core/sessionDelete.ts";
import type { SessionSummary } from "../core/transcript.ts";
import type { Hub, Node } from "./tree.ts";

export type Deleter = (uri: vscode.Uri) => PromiseLike<void>;
/** Never a fallback without the trash (ADR 0007). */
const toTrash: Deleter = (uri) => vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });

export function registerSessionDelete(hub: Hub, refresh: () => void, deleter: Deleter = toTrash): vscode.Disposable[] {
  // One implementation for orphan and live project (ADR 0007, amendment 2): refuse if open, recap, type the name, trash, forget.
  const deleteProject = async (node?: Node) => {
    let id: string, name: string, claudeDirs: string[], live = false;
    if (node?.kind === "orphan") ({ id, name, claudeDirs } = node);
    else if (node?.kind === "project") {
      if (!node.p.id) { void vscode.window.showInformationMessage(vscode.l10n.t("Project not registered: use Delete session…")); return; }
      ({ id, name } = node.p); claudeDirs = node.p.info.claudeDirs; live = true;
    } else return;
    try {
      const d = await hub.get();
      claudeDirs = d.reg?.projects[id]?.claudeDirs ?? claudeDirs; // the registry knows dirs absorbed from merged orphans
      const sessions = [...d.projects, ...(d.temp ?? [])].flatMap((p) => p.info.sessions).filter((s) => claudeDirs.includes(s.claudeDir));
      const f = await projectFiles(hub.claudeHome, hub.hubHome, id, sessions, { live });
      // Only the sessions really deleted count: those of a Claude folder shared with another project stay.
      for (const sid of f.sessionIds) if (await isSessionLive(hub.claudeHome, sid)) { void vscode.window.showInformationMessage(vscode.l10n.t("A session of {0} is open: close it first.", name)); return; }
      const marker = f.keptDirs.length ? vscode.l10n.t(", the marker of {0}", f.keptDirs.join(", ")) : "";
      const go = vscode.l10n.t("Continue…");
      const ok = await vscode.window.showWarningMessage(
        vscode.l10n.t("Delete “{0}”? Moved to the trash: {1} session(s) ({2} MB), {3} topic(s), {4} auto-memory note(s){5}. The hub will forget it. The project folder is not deleted.",
          name, f.sessionIds.length, (f.bytes / 1048576).toFixed(1), f.topics, f.notes, marker),
        { modal: true }, go);
      if (ok !== go) return;
      const typed = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Type the project name “{0}” to confirm", name), ignoreFocusOut: true,
        validateInput: (v) => (v === name ? undefined : vscode.l10n.t("Type exactly: {0}", name)),
      });
      if (typed !== name) return;
      let failed = 0;
      for (const p of f.paths) {
        try { await deleter(vscode.Uri.file(p)); } catch (e) {
          failed++;
          void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: could not move {0} to the trash: {1}", p, (e as Error).message));
        }
      }
      if (failed) void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: {0} stays in the hub, {1} item(s) could not be moved.", name, failed));
      else await forgetProject(hub.hubHome, id, { live });
      hub.invalidate();
      refresh();
    } catch (e) { void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: {0}", (e as Error).message)); }
  };
  return [vscode.commands.registerCommand("claudeProjectsHub.deleteOrphan", deleteProject),
  vscode.commands.registerCommand("claudeProjectsHub.deleteProject", deleteProject),
  vscode.commands.registerCommand("claudeProjectsHub.deleteSessions", async (node?: Node, nodes?: Node[]) => {
    const sel = nodes?.length ? nodes : node ? [node] : [];
    const found = new Map<string, SessionSummary>();
    const add = (s: SessionSummary) => found.set(s.sessionId, s);
    for (const n of sel) {
      if (n.kind === "session") add(n.s);
      else if (n.kind === "project") n.p.info.sessions.forEach(add);
      else if (n.kind === "orphan") {
        const d = await hub.get();
        for (const p of [...d.projects, ...(d.temp ?? [])]) for (const s of p.info.sessions) if (n.claudeDirs.includes(s.claudeDir)) add(s);
      }
    }
    const live: string[] = [];
    const targets: { s: SessionSummary; paths: string[]; bytes: number }[] = [];
    for (const s of found.values()) {
      try {
        if (await isSessionLive(hub.claudeHome, s.sessionId)) { live.push(s.sessionId); continue; }
        const f = await sessionFiles(hub.claudeHome, s.claudeDir, s.sessionId);
        if (f.paths.length) targets.push({ s, ...f });
      } catch (e) { void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: {0}", (e as Error).message)); return; }
    }
    if (live.length) void vscode.window.showInformationMessage(vscode.l10n.t("{0} open session(s) skipped: close them first.", live.length));
    if (!targets.length) { if (!live.length) void vscode.window.showInformationMessage(vscode.l10n.t("No session to delete.")); return; }
    const mo = (targets.reduce((a, t) => a + t.bytes, 0) / 1048576).toFixed(1);
    const trash = vscode.l10n.t("Move to trash");
    const ok = await vscode.window.showWarningMessage(
      vscode.l10n.t("Move {0} session(s) to the trash ({1} MB)? They will disappear from Claude Code (/resume). Recoverable from the trash.", targets.length, mo),
      { modal: true }, trash);
    if (ok !== trash) return;
    let failed = 0;
    for (const p of targets.flatMap((t) => t.paths)) {
      try { await deleter(vscode.Uri.file(p)); } catch (e) {
        failed++;
        void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: could not move {0} to the trash: {1}", p, (e as Error).message));
      }
    }
    hub.invalidate();
    refresh();
    if (!failed) void vscode.window.showInformationMessage(vscode.l10n.t("{0} session(s) moved to the trash.", targets.length));
  })];
}
