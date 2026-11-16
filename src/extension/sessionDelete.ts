import * as vscode from "vscode";
import { forgetProject, isSessionLive, orphanFiles, sessionFiles } from "../core/sessionDelete.ts";
import type { SessionSummary } from "../core/transcript.ts";
import type { Hub, Node } from "./tree.ts";

export type Deleter = (uri: vscode.Uri) => PromiseLike<void>;
/** Never a fallback without the trash (ADR 0007). */
const toTrash: Deleter = (uri) => vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });

export function registerSessionDelete(hub: Hub, refresh: () => void, deleter: Deleter = toTrash): vscode.Disposable[] {
  return [vscode.commands.registerCommand("claudeProjectsHub.deleteOrphan", async (node?: Node) => {
    if (node?.kind !== "orphan") return;
    try {
      const d = await hub.get();
      const sessions = [...d.projects, ...(d.temp ?? [])].flatMap((p) => p.info.sessions).filter((s) => node.claudeDirs.includes(s.claudeDir));
      for (const s of sessions) if (await isSessionLive(hub.claudeHome, s.sessionId)) { void vscode.window.showInformationMessage(`Une session de ${node.name} est ouverte : fermez-la d'abord.`); return; }
      const f = await orphanFiles(hub.claudeHome, hub.hubHome, node.id, sessions);
      const ok = await vscode.window.showWarningMessage(
        `Supprimer l'orphelin « ${node.name} » ? ${sessions.length} session(s), ${f.topics} topic(s), ${f.notes} note(s) d'auto-mémoire (${(f.bytes / 1048576).toFixed(1)} Mo) partent à la corbeille et le projet disparaît du hub.`,
        { modal: true }, "Supprimer l'orphelin");
      if (ok !== "Supprimer l'orphelin") return;
      let failed = 0;
      for (const p of f.paths) {
        try { await deleter(vscode.Uri.file(p)); } catch (e) {
          failed++;
          void vscode.window.showErrorMessage(`Claude Hub : corbeille impossible pour ${p} : ${(e as Error).message}`);
        }
      }
      if (failed) void vscode.window.showErrorMessage(`Claude Hub : ${node.name} reste dans le hub, ${failed} élément(s) n'ont pas pu partir.`);
      else await forgetProject(hub.hubHome, node.id);
      hub.invalidate();
      refresh();
    } catch (e) { void vscode.window.showErrorMessage(`Claude Hub : ${(e as Error).message}`); }
  }),
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
      } catch (e) { void vscode.window.showErrorMessage(`Claude Hub : ${(e as Error).message}`); return; }
    }
    if (live.length) void vscode.window.showInformationMessage(`${live.length} session(s) ouverte(s) ignorée(s) : fermez-les d'abord.`);
    if (!targets.length) { if (!live.length) void vscode.window.showInformationMessage("Aucune session à supprimer."); return; }
    const mo = (targets.reduce((a, t) => a + t.bytes, 0) / 1048576).toFixed(1);
    const ok = await vscode.window.showWarningMessage(
      `Mettre ${targets.length} session(s) à la corbeille (${mo} Mo) ? Elles disparaîtront de Claude Code (/resume). Récupérables depuis la corbeille.`,
      { modal: true }, "Mettre à la corbeille");
    if (ok !== "Mettre à la corbeille") return;
    let failed = 0;
    for (const p of targets.flatMap((t) => t.paths)) {
      try { await deleter(vscode.Uri.file(p)); } catch (e) {
        failed++;
        void vscode.window.showErrorMessage(`Claude Hub : corbeille impossible pour ${p} : ${(e as Error).message}`);
      }
    }
    hub.invalidate();
    refresh();
    if (!failed) void vscode.window.showInformationMessage(`${targets.length} session(s) mise(s) à la corbeille.`);
  })];
}
