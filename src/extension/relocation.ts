import * as vscode from "vscode";
import { updateRegistry } from "../core/registry.ts";
import { attachProject, copyAutoMemory, detachDir, dismiss, undoMerge, type MergeRecord, type ReconcileResult } from "../core/relocate.ts";
import type { Hub, Node } from "./tree.ts";

export interface Relocation { lastMerges: MergeRecord[] }

const encodeDir = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-").toLowerCase();

export function registerRelocation(hub: Hub, refresh: () => void): { state: Relocation; disposables: vscode.Disposable[] } {
  const state: Relocation = { lastMerges: [] };
  const fail = (e: unknown) => void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: {0}", (e as Error).message));
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { fail(e); } refresh(); };

  const announce = (recs: MergeRecord[]) => {
    if (!recs.length) return;
    state.lastMerges = recs;
    const msg = vscode.l10n.t("Project {0} attached to its new folder", recs.map((r) => r.keptName).join(", "));
    const undo = vscode.l10n.t("Undo");
    void vscode.window.showInformationMessage(msg, undo).then((c) => c === undo ? vscode.commands.executeCommand("claudeProjectsHub.undoMerge", recs) : undefined);
  };
  const seen = new Set<string>();
  hub.onReconcile = (r: ReconcileResult) => {
    announce(r.merges);
    const fresh = r.proposals.filter((p) => !seen.has(`${p.orphanId}>${p.candidateId}`));
    fresh.forEach((p) => seen.add(`${p.orphanId}>${p.candidateId}`));
    if (fresh.length) void vscode.window.showInformationMessage(vscode.l10n.t("Claude Hub: {0} project(s) to attach (see “To attach”).", fresh.length));
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
          if (!keptId) throw new Error(vscode.l10n.t("project not registered: open a session in it or refresh"));
          const other = await pickProject(vscode.l10n.t("Project to attach to this one"), keptId);
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
        const recs = Array.isArray(arg) ? arg : state.lastMerges;
        if (!recs.length) { void vscode.window.showInformationMessage(vscode.l10n.t("Claude Hub: no attachment to undo.")); return; }
        await undoMerge(hub.hubHome, recs);
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
            to = (await pickProject(vscode.l10n.t("Copy the auto-memory to the folder of…"), n.id))?.info.cwd;
          }
          if (!to || !from.length) return;
          const copy = vscode.l10n.t("Copy");
          const ok = preset?.confirm || await vscode.window.showWarningMessage(vscode.l10n.t("Copy the Claude auto-memory to {0}? No existing file is overwritten.", to), { modal: true }, copy) === copy;
          if (!ok) return;
          const results = [];
          for (const d of from) results.push(await copyAutoMemory(hub.claudeHome, d, to));
          const files = results.reduce((s, r) => s + r.copied.length, 0);
          void vscode.window.showInformationMessage(vscode.l10n.t("Claude Hub: {0} note(s) copied to {1}.", files, to));
          refresh();
          return results;
        } catch (e) { fail(e); }
      }),
    ],
  };
}
