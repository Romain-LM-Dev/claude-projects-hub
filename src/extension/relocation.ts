import * as vscode from "vscode";
import { updateRegistry } from "../core/registry.ts";
import { attachProject, copyAutoMemory, detachDir, dismiss, undoMerge, type MergeRecord, type ReconcileResult } from "../core/relocate.ts";
import type { Hub, Node } from "./tree.ts";

export interface Relocation { lastMerges: MergeRecord[] }

const encodeDir = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-").toLowerCase();

export function registerRelocation(hub: Hub, refresh: () => void): { state: Relocation; disposables: vscode.Disposable[] } {
  const state: Relocation = { lastMerges: [] };
  const fail = (e: unknown) => void vscode.window.showErrorMessage(`Claude Hub : ${(e as Error).message}`);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { fail(e); } refresh(); };

  const announce = (recs: MergeRecord[]) => {
    if (!recs.length) return;
    state.lastMerges = recs;
    const msg = `Projet ${recs.map((r) => r.keptName).join(", ")} rattaché à son nouveau dossier`;
    void vscode.window.showInformationMessage(msg, "Annuler").then((c) => c === "Annuler" ? vscode.commands.executeCommand("claudeProjectsHub.undoMerge", recs) : undefined);
  };
  const seen = new Set<string>();
  hub.onReconcile = (r: ReconcileResult) => {
    announce(r.merges);
    const fresh = r.proposals.filter((p) => !seen.has(`${p.orphanId}>${p.candidateId}`));
    fresh.forEach((p) => seen.add(`${p.orphanId}>${p.candidateId}`));
    if (fresh.length) void vscode.window.showInformationMessage(`Claude Hub : ${fresh.length} projet(s) à rattacher (nœud « À rattacher »).`);
  };

  const pickProject = async (title: string, except?: string) => {
    const { projects } = await hub.get();
    const items = projects.filter((p) => p.id && p.id !== except).map((p) => ({ label: p.name, description: p.info.cwd, p }));
    return (await vscode.window.showQuickPick(items, { title }))?.p;
  };
  const cmd = (id: string, fn: (...a: any[]) => unknown) => vscode.commands.registerCommand(`claudeProjectsHub.${id}`, fn);

  return {
    state,
    disposables: [
      // The node absorbs the project picked (for a proposal: its candidate); topics of the absorbed project move to the kept one.
      cmd("attachProject", (n?: Node) => run(async () => {
        if (n?.kind === "proposal") announce([await attachProject(hub.hubHome, n.pr.orphanId, n.pr.candidateId)]);
        else if (n?.kind === "project" || n?.kind === "orphan") {
          const keptId = n.kind === "orphan" ? n.id : n.p.id;
          if (!keptId) throw new Error("projet non enregistré : ouvrez-y une session ou rafraîchissez");
          const other = await pickProject("Projet à rattacher à celui-ci", keptId);
          if (other?.id) announce([await attachProject(hub.hubHome, keptId, other.id)]);
        }
      })),
      cmd("detachDir", (n?: Node) => run(async () => { if (n?.kind === "project") await detachDir(hub.hubHome, n.p.info.cwd); })),
      cmd("dismissCandidate", (n?: Node) => run(async () => { if (n?.kind === "proposal") await dismiss(hub.hubHome, n.pr.orphanId, n.pr.candidateId); })),
      cmd("dismissOrphan", (n?: Node) => run(async () => {
        if (n?.kind === "proposal") await dismiss(hub.hubHome, n.pr.orphanId);
        else if (n?.kind === "orphan") await dismiss(hub.hubHome, n.id);
      })),
      // Without argument: undoes the merges of the last pass (the next scan merges again unless the pair is dismissed: core limit, entries created in the pass are not in the .bak).
      cmd("undoMerge", (arg?: MergeRecord[]) => run(async () => {
        const recs = [...(Array.isArray(arg) ? arg : state.lastMerges)].reverse();
        if (!recs.length) { void vscode.window.showInformationMessage("Claude Hub : aucun rattachement à annuler."); return; }
        for (const r of recs) await undoMerge(hub.hubHome, r);
        state.lastMerges = [];
      })),
      cmd("refreshFingerprints", () => run(() => updateRegistry(hub.hubHome, async (reg) => { for (const e of Object.values(reg.projects)) delete e.git; }))),
      // `preset.confirm` skips the modal question (tests).
      cmd("copyAutoMemory", async (n?: Node, preset?: { confirm?: boolean }) => {
        try {
          const { reg } = await hub.get();
          let from: string[] = [];
          let to: string | undefined;
          if (n?.kind === "project" && n.p.id) {
            to = n.p.info.cwd;
            from = (reg.projects[n.p.id]?.claudeDirs ?? []).filter((d) => d.toLowerCase() !== encodeDir(to!));
          } else if (n?.kind === "proposal") {
            from = reg.projects[n.pr.orphanId]?.claudeDirs ?? [];
            to = reg.projects[n.pr.candidateId]?.paths[0];
          } else if (n?.kind === "orphan") {
            from = n.claudeDirs;
            to = (await pickProject("Copier l'auto-mémoire vers le dossier de…", n.id))?.info.cwd;
          }
          if (!to || !from.length) return;
          const ok = preset?.confirm || await vscode.window.showWarningMessage(`Copier l'auto-mémoire Claude vers ${to} ? Aucun fichier existant n'est écrasé.`, { modal: true }, "Copier") === "Copier";
          if (!ok) return;
          const results = [];
          for (const d of from) results.push(await copyAutoMemory(hub.claudeHome, d, to));
          const files = results.reduce((s, r) => s + r.copied.length, 0);
          void vscode.window.showInformationMessage(`Claude Hub : ${files} note(s) copiée(s) vers ${to}.`);
          refresh();
          return results;
        } catch (e) { fail(e); }
      }),
    ],
  };
}
