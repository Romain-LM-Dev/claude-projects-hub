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
      if (!node.p.id) { void vscode.window.showInformationMessage("Projet non enregistré : utilisez Supprimer la session…"); return; }
      ({ id, name } = node.p); claudeDirs = node.p.info.claudeDirs; live = true;
    } else return;
    try {
      const d = await hub.get();
      claudeDirs = d.reg?.projects[id]?.claudeDirs ?? claudeDirs; // the registry knows dirs absorbed from merged orphans
      const sessions = [...d.projects, ...(d.temp ?? [])].flatMap((p) => p.info.sessions).filter((s) => claudeDirs.includes(s.claudeDir));
      const f = await projectFiles(hub.claudeHome, hub.hubHome, id, sessions, { live });
      // Only the sessions really deleted count: those of a Claude folder shared with another project stay.
      for (const sid of f.sessionIds) if (await isSessionLive(hub.claudeHome, sid)) { void vscode.window.showInformationMessage(`Une session de ${name} est ouverte : fermez-la d'abord.`); return; }
      const marker = f.keptDirs.length ? `, le marqueur de ${f.keptDirs.join(", ")}` : "";
      const ok = await vscode.window.showWarningMessage(
        `Supprimer « ${name} » ? Partent à la corbeille : ${f.sessionIds.length} session(s) (${(f.bytes / 1048576).toFixed(1)} Mo), ${f.topics} topic(s), ${f.notes} note(s) d'auto-mémoire${marker}. Le hub l'oubliera. Le dossier du projet n'est pas supprimé.`,
        { modal: true }, "Continuer…");
      if (ok !== "Continuer…") return;
      const typed = await vscode.window.showInputBox({
        prompt: `Tapez le nom du projet « ${name} » pour confirmer`, ignoreFocusOut: true,
        validateInput: (v) => (v === name ? undefined : `Tapez exactement : ${name}`),
      });
      if (typed !== name) return;
      let failed = 0;
      for (const p of f.paths) {
        try { await deleter(vscode.Uri.file(p)); } catch (e) {
          failed++;
          void vscode.window.showErrorMessage(`Claude Hub : corbeille impossible pour ${p} : ${(e as Error).message}`);
        }
      }
      if (failed) void vscode.window.showErrorMessage(`Claude Hub : ${name} reste dans le hub, ${failed} élément(s) n'ont pas pu partir.`);
      else await forgetProject(hub.hubHome, id, { live });
      hub.invalidate();
      refresh();
    } catch (e) { void vscode.window.showErrorMessage(`Claude Hub : ${(e as Error).message}`); }
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
